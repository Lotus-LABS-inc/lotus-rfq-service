import { createHash, randomUUID } from "node:crypto";

import { ExecutionControlRepository } from "../repositories/execution-control.repository.js";
import type { ExecutionControlRequest, ExecutionIdempotencyStatus } from "./execution-control-types.js";

export interface ExecutionIdempotencyResult {
    idempotencyKey: string;
    bindingHash: string;
    status: ExecutionIdempotencyStatus;
}

export class ExecutionIdempotencyService {
    public constructor(private readonly repository: ExecutionControlRepository) {}

    public async reserve(request: ExecutionControlRequest): Promise<ExecutionIdempotencyResult> {
        const bindingHash = this.buildBindingHash(request);
        const idempotencyKey = request.idempotencyKey ?? this.generateIdempotencyKey(request, bindingHash);
        const existing = await this.repository.findIdempotencyKey(idempotencyKey);

        if (!existing) {
            await this.repository.upsertIdempotencyKey({
                idempotencyKey,
                routePlanId: request.routePlanId,
                principalId: request.userWalletReference.principalId,
                walletRef: request.userWalletReference.walletRef ?? null,
                venueTargets: request.venueTargets,
                requestedAction: request.routeType,
                bindingHash,
                lastStatus: "ALLOCATED"
            });
            return { idempotencyKey, bindingHash, status: "ALLOCATED" };
        }

        if (
            existing.bindingHash !== bindingHash ||
            existing.principalId !== request.userWalletReference.principalId ||
            existing.walletRef !== (request.userWalletReference.walletRef ?? null)
        ) {
            return { idempotencyKey, bindingHash, status: "MISMATCHED" };
        }

        return { idempotencyKey, bindingHash, status: "REUSED" };
    }

    public async attachIntent(idempotencyKey: string, input: {
        executionIntentId: string;
        routePlanId?: string | null;
        principalId: string;
        walletRef?: string | null;
        venueTargets: readonly string[];
        requestedAction: string;
        bindingHash: string;
        status: ExecutionIdempotencyStatus;
    }): Promise<void> {
        await this.repository.upsertIdempotencyKey({
            idempotencyKey,
            executionIntentId: input.executionIntentId,
            routePlanId: input.routePlanId ?? null,
            principalId: input.principalId,
            walletRef: input.walletRef ?? null,
            venueTargets: input.venueTargets,
            requestedAction: input.requestedAction,
            bindingHash: input.bindingHash,
            lastStatus: input.status
        });
    }

    private generateIdempotencyKey(request: ExecutionControlRequest, bindingHash: string): string {
        const stablePrefix = createHash("sha256")
            .update(
                JSON.stringify({
                    routePlanId: request.routePlanId,
                    principalId: request.userWalletReference.principalId,
                    routeType: request.routeType,
                    venueTargets: request.venueTargets,
                    submissionKind: request.submissionKind,
                    bindingHash,
                    executionScopeBinding: request.executionScopeBinding ?? null
                })
            )
            .digest("hex")
            .slice(0, 24);
        return `${stablePrefix}-${randomUUID()}`;
    }

    private buildBindingHash(request: ExecutionControlRequest): string {
        return createHash("sha256")
            .update(
                JSON.stringify({
                    routePlanId: request.routePlanId,
                    principalId: request.userWalletReference.principalId,
                    walletRef: request.userWalletReference.walletRef ?? null,
                    venueTargets: request.venueTargets,
                    requestedSize: request.requestedSize ?? null,
                    requestedNotional: request.requestedNotional ?? null,
                    routeType: request.routeType,
                    submissionKind: request.submissionKind,
                    executionScopeBinding: request.executionScopeBinding ?? null
                })
            )
            .digest("hex");
    }
}
