import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "pino";
import { calculateExposureDelta } from "./risk-utils.js";
import type { InternalOrder, RedisBookOrder, Trade } from "./types.js";
import type { OrderBook } from "./order-book.js";
import type { OrderLocker } from "./locker.js";
import { withSpan } from "../../observability/tracing.js";
import type { IResolutionRiskEligibilityService } from "../rfq-engine/resolution-risk-eligibility-service.js";
import type { IReplayDecisionCaptureService } from "../replay/replay-decision-capture-service.js";
import type { ReplayCaptureConfig, ReplayEnvelope } from "../replay/replay.types.js";
import { InternalCrossSnapshotBuilder } from "../replay/builders/internal-cross-snapshot-builder.js";
import type {
    IQualificationRuntimeHook,
    QualificationDomainHookConfig
} from "../qualification/runtime-qualification-hook.js";
import type { InternalCrossDecisionOutput } from "../qualification/shadow-qualification-evaluator.js";

type DecimalValue = InstanceType<typeof Decimal>;

interface MatchResult {
    trade: Trade | null;
    matchSize: DecimalValue;
    newMakerRemaining: DecimalValue;
    newMakerStatus: "PARTIAL" | "FILLED";
    makerOrderId: string;
}

interface MakerOrderRow {
    id: string;
    user_id: string;
    market_id: string;
    side: "buy" | "sell";
    price: string;
    remaining_size: string;
    status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";
    created_at: Date;
}

export interface InternalCrossPreviewResult {
    fillableSize: number;
    remainingSize: number;
    matchedOrderIds: readonly string[];
    wouldSelfTrade: boolean;
}

export class InternalCrossingEngine {
    private readonly replaySnapshotBuilder = new InternalCrossSnapshotBuilder();

    constructor(
        private readonly pool: Pool,
        private readonly orderBook: OrderBook,
        private readonly orderLocker: OrderLocker,
        private readonly logger: Logger,
        private readonly resolutionRiskEligibilityService?: IResolutionRiskEligibilityService,
        private readonly replayDecisionCaptureService?: IReplayDecisionCaptureService,
        private readonly replayCaptureConfig?: ReplayCaptureConfig,
        private readonly qualificationHook?: IQualificationRuntimeHook,
        private readonly qualificationConfig?: QualificationDomainHookConfig
    ) { }

    /**
     * Attempts to match an incoming order against the resting order book.
     * Atomic, concurrency-safe, and follows price-time priority.
     */
    async attemptCross(incomingOrder: InternalOrder): Promise<{
        filledSize: number;
        remainingSize: number;
        trades: Trade[];
    }> {
        return withSpan(
            "internal_cross.attempt",
            {
                market_id: incomingOrder.market_id,
                incoming_order_id: incomingOrder.id,
                state: "ATTEMPTING"
            },
            async () => {
                const shadowPreview =
                    this.qualificationHook && this.qualificationConfig?.enabled && this.qualificationConfig.shadowEnabled
                        ? await this.previewCross(incomingOrder)
                        : null;
                let remainingTakerSize = new Decimal(incomingOrder.remaining_size);
                let filledTakerSize = new Decimal(0);
                const trades: Trade[] = [];
                let lastReplayEnvelopeId: string | null = null;

                this.logger.info({
                    orderId: incomingOrder.id,
                    marketId: incomingOrder.market_id,
                    side: incomingOrder.side,
                    size: remainingTakerSize.toString()
                }, "Starting internal cross attempt.");

                while (remainingTakerSize.gt(0)) {
                    const candidates = await this.orderBook.getBestOppositeOrders(
                        incomingOrder.market_id,
                        incomingOrder.side,
                        incomingOrder.price,
                        10
                    );

                    if (candidates.length === 0) {
                        this.logger.info({ orderId: incomingOrder.id }, "No more compatible resting orders found.");
                        break;
                    }

                    let progressedInBatch = false;
                    for (const makerEntry of candidates) {
                        if (remainingTakerSize.lte(0)) {
                            break;
                        }
                        if (makerEntry.userId === incomingOrder.user_id) {
                            this.logger.warn({
                                takerId: incomingOrder.user_id,
                                makerOrderId: makerEntry.orderId
                            }, "Self-trade detected (CANCEL_NEWEST). Cancelling incoming order.");

                            remainingTakerSize = new Decimal(0);
                            break;
                        }

                        if (!(await this.isMakerResolutionEligible(incomingOrder, makerEntry))) {
                            this.logger.warn({
                                takerOrderId: incomingOrder.id,
                                makerOrderId: makerEntry.orderId,
                                takerResolutionProfileId: incomingOrder.resolution_profile_id ?? null,
                                makerResolutionProfileId: makerEntry.resolutionProfileId ?? null
                            }, "Skipping internal crossing candidate due to non-safe resolution profile equivalence.");
                            continue;
                        }

                        const plannedMatchSize = Decimal.min(remainingTakerSize, new Decimal(makerEntry.remaining));
                        const plannedRemainingSize = remainingTakerSize.minus(plannedMatchSize);
                        const lockOrder = [incomingOrder.id, makerEntry.orderId].sort((left, right) => left.localeCompare(right));

                        const replayEnvelope = await this.captureReplayDecision({
                            incomingOrder,
                            orderedCandidates: candidates,
                            makerEntry,
                            resolutionAllowed: true,
                            lockOrder,
                            plannedMatchSize,
                            plannedRemainingSize,
                            filledSoFar: filledTakerSize
                        });
                        lastReplayEnvelopeId = replayEnvelope?.id ?? lastReplayEnvelopeId;

                        const lockHandle = await withSpan(
                            "internal_cross.lock_pair",
                            {
                                incoming_order_id: incomingOrder.id,
                                maker_order_id: makerEntry.orderId,
                                market_id: incomingOrder.market_id
                            },
                            async () => this.orderLocker.acquireDualOrderLocks(incomingOrder.id, makerEntry.orderId)
                        );
                        try {
                            const result = await withSpan(
                                "internal_cross.match_transaction",
                                {
                                    incoming_order_id: incomingOrder.id,
                                    maker_order_id: makerEntry.orderId,
                                    market_id: incomingOrder.market_id
                                },
                                async () => this.matchMakerOrder(incomingOrder, makerEntry, remainingTakerSize)
                            );
                            if (result === null) {
                                continue;
                            }

                            progressedInBatch = true;
                            remainingTakerSize = remainingTakerSize.minus(result.matchSize);
                            filledTakerSize = filledTakerSize.plus(result.matchSize);
                            if (result.trade !== null) {
                                trades.push(result.trade);
                            }

                            await this.syncRedisBook(result.makerOrderId, result.newMakerRemaining, result.newMakerStatus);
                        } finally {
                            await this.orderLocker.releaseLocks(lockHandle);
                        }
                    }

                    if (!progressedInBatch) {
                        this.logger.warn({ orderId: incomingOrder.id }, "No progress made against compatible candidates; stopping to avoid retry loop.");
                        break;
                    }
                }

                const result = {
                    filledSize: Number(filledTakerSize.toString()),
                    remainingSize: Number(remainingTakerSize.toString()),
                    trades
                };

                await this.emitQualificationEvaluation(
                    incomingOrder,
                    result,
                    shadowPreview,
                    lastReplayEnvelopeId
                );

                return result;
            }
        );
    }

    async previewCross(incomingOrder: InternalOrder): Promise<InternalCrossPreviewResult> {
        return withSpan(
            "internal_cross.shadow_evaluate",
            {
                market_id: incomingOrder.market_id,
                incoming_order_id: incomingOrder.id,
                shadow_mode: true
            },
            async () => {
                let remainingTakerSize = new Decimal(incomingOrder.remaining_size);
                let fillableSize = new Decimal(0);
                const matchedOrderIds: string[] = [];

                const candidates = await this.orderBook.getBestOppositeOrders(
                    incomingOrder.market_id,
                    incomingOrder.side,
                    incomingOrder.price,
                    10
                );

                for (const makerEntry of candidates) {
                    if (remainingTakerSize.lte(0)) {
                        break;
                    }
                    if (makerEntry.userId === incomingOrder.user_id) {
                        return {
                            fillableSize: Number(fillableSize.toString()),
                            remainingSize: Number(remainingTakerSize.toString()),
                            matchedOrderIds,
                            wouldSelfTrade: true
                        };
                    }

                    if (!(await this.isMakerResolutionEligible(incomingOrder, makerEntry))) {
                        continue;
                    }

                    const makerRemaining = new Decimal(makerEntry.remaining);
                    const matched = Decimal.min(remainingTakerSize, makerRemaining);
                    if (matched.lte(0)) {
                        continue;
                    }

                    fillableSize = fillableSize.plus(matched);
                    remainingTakerSize = remainingTakerSize.minus(matched);
                    matchedOrderIds.push(makerEntry.orderId);
                }

                return {
                    fillableSize: Number(fillableSize.toString()),
                    remainingSize: Number(remainingTakerSize.toString()),
                    matchedOrderIds,
                    wouldSelfTrade: false
                };
            }
        );
    }

    private async matchMakerOrder(
        incomingOrder: InternalOrder,
        makerEntry: RedisBookOrder,
        remainingTakerSize: DecimalValue
    ): Promise<MatchResult | null> {
        const client = await this.pool.connect();
        let clientConnectionErrored = false;
        const onClientError = (error: Error): void => {
            clientConnectionErrored = true;
            this.logger.error(
                { err: error, takerId: incomingOrder.id, makerId: makerEntry.orderId },
                "Checked-out Postgres client emitted an error during internal crossing."
            );
        };
        if ("on" in client && typeof client.on === "function") {
            client.on("error", onClientError);
        }
        try {
            await client.query("BEGIN");

            const maker = await this.loadMakerForUpdate(client, makerEntry.orderId);
            if (maker === null) {
                await client.query("ROLLBACK");
                await this.safeRemoveStaleMaker(makerEntry.orderId);
                return null;
            }

            const matchSize = Decimal.min(remainingTakerSize, new Decimal(maker.remaining_size));
            const trade = await this.insertTradeIfNeeded(client, incomingOrder, maker, matchSize);
            if (trade === null) {
                await client.query("ROLLBACK");
                await this.syncRedisBook(maker.id, new Decimal(maker.remaining_size), maker.status === "FILLED" ? "FILLED" : "PARTIAL");
                return null;
            }

            const newMakerRemaining = new Decimal(maker.remaining_size).minus(matchSize);
            const newMakerStatus: "PARTIAL" | "FILLED" = newMakerRemaining.eq(0) ? "FILLED" : "PARTIAL";
            await this.updateMakerState(client, maker.id, newMakerRemaining, newMakerStatus);
            await this.atomicUpdateExposure(client, incomingOrder.user_id, incomingOrder.market_id, incomingOrder.side, trade.id, trade.price, trade.size, incomingOrder.id, maker.id);
            await this.atomicUpdateExposure(client, maker.user_id, incomingOrder.market_id, maker.side, trade.id, trade.price, trade.size, incomingOrder.id, maker.id);

            await client.query("COMMIT");

            this.logger.info({
                tradeId: trade.id,
                takerOrderId: incomingOrder.id,
                makerOrderId: maker.id,
                matchSize: trade.size,
                matchPrice: trade.price
            }, "Match successful.");

            return {
                trade,
                matchSize,
                newMakerRemaining,
                newMakerStatus,
                makerOrderId: maker.id
            };
        } catch (error) {
            await this.safeRollback(client);
            this.logger.error({ err: error, takerId: incomingOrder.id, makerId: makerEntry.orderId }, "Transaction failed during matching.");
            throw error;
        } finally {
            if ("off" in client && typeof client.off === "function") {
                client.off("error", onClientError);
            }
            client.release(clientConnectionErrored);
        }
    }

    private async loadMakerForUpdate(client: PoolClient, makerOrderId: string): Promise<MakerOrderRow | null> {
        const makerRes = await client.query<MakerOrderRow>(
            `SELECT id, user_id, market_id, side, price::text, remaining_size::text, status, created_at
             FROM internal_orders
             WHERE id = $1
             FOR UPDATE`,
            [makerOrderId]
        );
        const maker = makerRes.rows[0] ?? null;
        if (
            maker === null ||
            (maker.status !== "OPEN" && maker.status !== "PARTIAL") ||
            new Decimal(maker.remaining_size).lte(0)
        ) {
            this.logger.info({ makerOrderId }, "Maker order no longer available or open. Removing stale book entry.");
            return null;
        }

        return maker;
    }

    private async insertTradeIfNeeded(
        client: PoolClient,
        incomingOrder: InternalOrder,
        maker: MakerOrderRow,
        matchSize: DecimalValue
    ): Promise<Trade | null> {
        const tradeId = randomUUID();
        const buyOrderId = incomingOrder.side === "buy" ? incomingOrder.id : maker.id;
        const sellOrderId = incomingOrder.side === "sell" ? incomingOrder.id : maker.id;
        const tradeResult = await client.query<{ id: string; created_at: Date }>(
            `INSERT INTO trades (id, market_id, buy_order_id, sell_order_id, price, size)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT ON CONSTRAINT uq_trades_match DO NOTHING
             RETURNING id, created_at`,
            [tradeId, incomingOrder.market_id, buyOrderId, sellOrderId, maker.price, matchSize.toString()]
        );

        if (tradeResult.rows.length === 0) {
            this.logger.warn({ buyOrderId, sellOrderId }, "Skipping duplicate internal trade replay.");
            return null;
        }

        return {
            id: tradeResult.rows[0]?.id ?? tradeId,
            market_id: incomingOrder.market_id,
            buy_order_id: buyOrderId,
            sell_order_id: sellOrderId,
            price: maker.price,
            size: matchSize.toString(),
            created_at: tradeResult.rows[0]?.created_at ?? new Date()
        };
    }

    private async updateMakerState(
        client: PoolClient,
        makerOrderId: string,
        remaining: DecimalValue,
        status: "PARTIAL" | "FILLED"
    ): Promise<void> {
        await client.query(
            `UPDATE internal_orders
             SET remaining_size = $1, status = $2, updated_at = NOW()
             WHERE id = $3`,
            [remaining.toString(), status, makerOrderId]
        );
    }

    private async atomicUpdateExposure(
        client: PoolClient,
        userId: string,
        marketId: string,
        side: "buy" | "sell",
        tradeId: string,
        price: string,
        size: string,
        takerOrderId: string,
        makerOrderId: string
    ): Promise<void> {
        const { grossDelta, netDelta, payload } = this.buildExposureDeltaPayload(side, price, size, takerOrderId, makerOrderId);
        const expRes = await client.query<{ id: string; gross_notional: string; net_notional: string }>(
            `SELECT id, gross_notional::text, net_notional::text 
             FROM exposure 
             WHERE user_id = $1 AND canonical_market_id = $2 AND side = $3
             FOR UPDATE`,
            [userId, marketId, side]
        );

        const exposure = expRes.rows[0];
        const prevGross = exposure ? new Decimal(exposure.gross_notional) : new Decimal(0);
        const prevNet = exposure ? new Decimal(exposure.net_notional) : new Decimal(0);
        const newGross = prevGross.plus(grossDelta);
        const newNet = prevNet.plus(netDelta);

        let exposureId: string;

        if (!exposure) {
            const createRes = await client.query(
                `INSERT INTO exposure (user_id, canonical_market_id, side, gross_notional, net_notional)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id`,
                [userId, marketId, side, newGross.toString(), newNet.toString()]
            );
            exposureId = createRes.rows[0]?.id ?? "";
        } else {
            exposureId = exposure.id;
            await client.query(
                `UPDATE exposure 
                 SET gross_notional = $1, net_notional = $2, last_updated = NOW(), version = version + 1
                 WHERE id = $3`,
                [newGross.toString(), newNet.toString(), exposureId]
            );
        }

        await client.query(
            `INSERT INTO exposure_journal (exposure_id, change, prev_gross, prev_net, new_gross, new_net, source, reference_id, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
            [
                exposureId,
                netDelta.toString(),
                prevGross.toString(),
                prevNet.toString(),
                newGross.toString(),
                newNet.toString(),
                "internal-match",
                tradeId,
                JSON.stringify(payload)
            ]
        );
    }

    private buildExposureDeltaPayload(
        side: "buy" | "sell",
        price: string,
        size: string,
        takerOrderId: string,
        makerOrderId: string
    ): {
        grossDelta: DecimalValue;
        netDelta: DecimalValue;
        payload: Record<string, string>;
    } {
        const delta = calculateExposureDelta(side, price, size);
        const grossDelta = new Decimal(delta.maxLossDelta);
        const netDelta = new Decimal(delta.maxGainDelta).minus(delta.maxLossDelta);

        return {
            grossDelta,
            netDelta,
            payload: {
                price,
                size,
                maxLossDelta: delta.maxLossDelta,
                maxGainDelta: delta.maxGainDelta,
                takerOrderId,
                makerOrderId,
                side
            }
        };
    }

    private async syncRedisBook(
        makerOrderId: string,
        newMakerRemaining: DecimalValue,
        newMakerStatus: "PARTIAL" | "FILLED"
    ): Promise<void> {
        await withSpan(
            "internal_cross.redis_sync",
            {
                maker_order_id: makerOrderId,
                remaining_size: newMakerRemaining.toString(),
                state: newMakerStatus
            },
            async () => {
                try {
                    if (newMakerStatus === "FILLED") {
                        await this.orderBook.removeOrder(makerOrderId);
                        return;
                    }

                    await this.orderBook.updateRemaining(makerOrderId, newMakerRemaining.toString());
                } catch (error) {
                    this.logger.error({ err: error, makerOrderId, newMakerStatus }, "Failed to synchronize Redis order book after committed internal trade.");
                }
            }
        );
    }

    private async safeRemoveStaleMaker(makerOrderId: string): Promise<void> {
        try {
            await this.orderBook.removeOrder(makerOrderId);
        } catch (error) {
            this.logger.error({ err: error, makerOrderId }, "Failed to remove stale maker order from Redis book.");
        }
    }

    private async safeRollback(client: PoolClient): Promise<void> {
        try {
            await client.query("ROLLBACK");
        } catch (error) {
            this.logger.warn({ err: error }, "Rollback failed on internal crossing transaction.");
        }
    }

    private async isMakerResolutionEligible(
        incomingOrder: InternalOrder,
        makerEntry: RedisBookOrder
    ): Promise<boolean> {
        const takerProfileId = incomingOrder.resolution_profile_id ?? null;
        const makerProfileId = makerEntry.resolutionProfileId ?? null;

        if (!takerProfileId || !makerProfileId || takerProfileId === makerProfileId) {
            return true;
        }

        if (!this.resolutionRiskEligibilityService) {
            return false;
        }

        return this.resolutionRiskEligibilityService.isSafeForInternalPooling(takerProfileId, makerProfileId, {
            stableKey: incomingOrder.id
        });
    }

    private async captureReplayDecision(input: {
        incomingOrder: InternalOrder;
        orderedCandidates: readonly RedisBookOrder[];
        makerEntry: RedisBookOrder;
        resolutionAllowed: boolean;
        lockOrder: readonly string[];
        plannedMatchSize: DecimalValue;
        plannedRemainingSize: DecimalValue;
        filledSoFar: DecimalValue;
    }): Promise<ReplayEnvelope | null> {
        if (!this.replayDecisionCaptureService || !this.replayCaptureConfig) {
            return null;
        }

        return this.replayDecisionCaptureService.capture({
            config: this.replayCaptureConfig,
            buildEnvelope: (metadata) =>
                this.replaySnapshotBuilder.build({
                    ...metadata,
                    correlationId: input.incomingOrder.id,
                    incomingOrderId: input.incomingOrder.id,
                    incomingOrder: input.incomingOrder as unknown as Record<string, unknown>,
                    orderedCandidates: input.orderedCandidates as unknown as readonly Record<string, unknown>[],
                    selfTradeChecks: [
                        {
                            incomingUserId: input.incomingOrder.user_id,
                            makerOrderId: input.makerEntry.orderId,
                            makerUserId: input.makerEntry.userId,
                            wouldSelfTrade: false
                        }
                    ],
                    resolutionEligibilityDecisions: [
                        {
                            leftProfileId: input.incomingOrder.resolution_profile_id ?? null,
                            rightProfileId: input.makerEntry.resolutionProfileId ?? null,
                            allowed: input.resolutionAllowed,
                            reason: input.resolutionAllowed ? "safe_for_internal_pooling" : "resolution_profile_not_safe",
                            stableKey: input.incomingOrder.id
                        }
                    ],
                    makerIterationOrder: input.orderedCandidates.map((candidate) => candidate.orderId),
                    lockOrder: input.lockOrder,
                    matchDecisions: [
                        {
                            makerOrderId: input.makerEntry.orderId,
                            makerRemaining: input.makerEntry.remaining,
                            plannedMatchSize: input.plannedMatchSize.toString()
                        }
                    ],
                    result: {
                        filledSize: input.filledSoFar.plus(input.plannedMatchSize).toString(),
                        remainingSize: input.plannedRemainingSize.toString(),
                        matchedOrderIds: [input.makerEntry.orderId]
                    }
                })
        });
    }

    private async emitQualificationEvaluation(
        incomingOrder: InternalOrder,
        result: {
            filledSize: number;
            remainingSize: number;
            trades: Trade[];
        },
        shadowPreview: InternalCrossPreviewResult | null,
        replayEnvelopeId: string | null
    ): Promise<void> {
        if (!this.qualificationHook || !this.qualificationConfig?.enabled) {
            return;
        }

        const liveDecision = this.toInternalCrossDecisionOutput(result);
        const shadowDecision = shadowPreview ? this.toPreviewDecisionOutput(shadowPreview) : liveDecision;

        await this.qualificationHook.emitEvaluation({
            strategyKey: this.qualificationConfig.strategyKey,
            scopeType: "MARKET",
            scopeId: incomingOrder.market_id,
            decisionType: "PHASE1_INTERNAL_CROSS_CHANGE",
            entityId: incomingOrder.id,
            replayEnvelopeId,
            mode: shadowPreview ? "shadow_compare" : "live_only",
            ...(this.qualificationConfig.failMode ? { failMode: this.qualificationConfig.failMode } : {}),
            liveDecision: () => liveDecision,
            shadowDecision: () => shadowDecision,
            metadata: {
                market: incomingOrder.market_id
            }
        });
    }

    private toInternalCrossDecisionOutput(result: {
        filledSize: number;
        remainingSize: number;
        trades: Trade[];
    }): InternalCrossDecisionOutput {
        const matchedOrderIds = result.trades.flatMap((trade) => [trade.buy_order_id, trade.sell_order_id]).sort((left, right) => left.localeCompare(right));
        return {
            filledSize: result.filledSize.toString(),
            matchedOrderIds,
            remainingSize: result.remainingSize.toString()
        };
    }

    private toPreviewDecisionOutput(preview: InternalCrossPreviewResult): InternalCrossDecisionOutput {
        return {
            filledSize: preview.fillableSize.toString(),
            matchedOrderIds: [...preview.matchedOrderIds].sort((left, right) => left.localeCompare(right)),
            remainingSize: preview.remainingSize.toString()
        };
    }
}
