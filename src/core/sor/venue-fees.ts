import Decimal from "decimal.js";

export type VenueFeeModel =
  | "POLYMARKET_PROTOCOL"
  | "LIMITLESS_CLOB_CURVE"
  | "LIMITLESS_AMM_FLAT"
  | "OPINION_TAKER_CURVE"
  | "PREDICT_MARKET_STATS"
  | "MYRIAD_QUOTE_API"
  | "STATIC_APPROVED";

export type VenueFeeSource = "VENUE_API" | "DOC_RULESET" | "OPERATOR_STATIC";
export type VenueFeeConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface VenueFeeQuote {
  feeModel: VenueFeeModel;
  feeSource: VenueFeeSource;
  feeAmount: string;
  effectiveFeeBps: number;
  confidence: VenueFeeConfidence;
  appliesTo: "taker";
  paidIn: "USDC" | "OUTCOME_TOKENS" | "ECONOMIC_EQUIVALENT_USDC";
  metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface FeeCalculationInput {
  venue: string;
  side: "buy" | "sell";
  quantity: number | string | InstanceType<typeof Decimal>;
  price: number | string | InstanceType<typeof Decimal>;
  staticFeeBps?: number | undefined;
  venueFeeBps?: number | undefined;
  venueFeeModel?: VenueFeeModel | undefined;
  polymarketFeeRate?: number | undefined;
  polymarketCategory?: string | undefined;
  opinionTopicRate?: number | undefined;
  limitlessMarketType?: "amm" | "clob" | undefined;
}

export const calculateVenueFeeQuote = (input: FeeCalculationInput): VenueFeeQuote | null => {
  const venue = input.venue.toUpperCase();
  const quantity = new Decimal(input.quantity);
  const price = new Decimal(input.price);
  const notional = quantity.times(price);
  if (quantity.lte(0) || price.lte(0) || notional.lte(0)) {
    return null;
  }

  if (input.staticFeeBps !== undefined) {
    return quoteFromBps({
      feeBps: input.staticFeeBps,
      notional,
      model: "STATIC_APPROVED",
      source: "OPERATOR_STATIC",
      confidence: "MEDIUM",
      paidIn: "ECONOMIC_EQUIVALENT_USDC"
    });
  }

  if (input.venueFeeBps !== undefined && input.venueFeeModel !== undefined) {
    return quoteFromBps({
      feeBps: input.venueFeeBps,
      notional,
      model: input.venueFeeModel,
      source: "VENUE_API",
      confidence: "HIGH",
      paidIn: "ECONOMIC_EQUIVALENT_USDC"
    });
  }

  if (venue === "POLYMARKET") {
    const feeRate = input.polymarketFeeRate ?? defaultPolymarketFeeRate(input);
    if (feeRate === null) {
      return null;
    }
    const feeAmount = quantity.times(feeRate).times(price).times(new Decimal(1).minus(price));
    return {
      feeModel: "POLYMARKET_PROTOCOL",
      feeSource: input.polymarketFeeRate !== undefined ? "VENUE_API" : "DOC_RULESET",
      feeAmount: roundDecimal(feeAmount),
      effectiveFeeBps: roundNumber(feeAmount.div(notional).times(10_000)),
      confidence: input.polymarketFeeRate !== undefined ? "HIGH" : "MEDIUM",
      appliesTo: "taker",
      paidIn: "USDC",
      metadata: {
        feeRate,
        formula: "shares * feeRate * price * (1 - price)"
      }
    };
  }

  if (venue === "LIMITLESS") {
    const marketType = input.limitlessMarketType ?? "clob";
    if (marketType === "amm") {
      return quoteFromBps({
        feeBps: 40,
        notional,
        model: "LIMITLESS_AMM_FLAT",
        source: "DOC_RULESET",
        confidence: "MEDIUM",
        paidIn: "USDC"
      });
    }
    const feeBps = input.side === "buy"
      ? interpolateLimitlessFeeBps(price, LIMITLESS_BUY_FEE_CURVE)
      : interpolateLimitlessFeeBps(price, LIMITLESS_SELL_FEE_CURVE);
    return quoteFromBps({
      feeBps,
      notional,
      model: "LIMITLESS_CLOB_CURVE",
      source: "DOC_RULESET",
      confidence: "MEDIUM",
      paidIn: input.side === "buy" ? "OUTCOME_TOKENS" : "USDC"
    });
  }

  if (venue === "OPINION" && input.opinionTopicRate !== undefined) {
    const curveRate = new Decimal(input.opinionTopicRate).times(price).times(new Decimal(1).minus(price));
    const curveFee = notional.times(curveRate);
    const feeAmount = Decimal.max(curveFee, 0.25);
    return {
      feeModel: "OPINION_TAKER_CURVE",
      feeSource: "DOC_RULESET",
      feeAmount: roundDecimal(feeAmount),
      effectiveFeeBps: roundNumber(feeAmount.div(notional).times(10_000)),
      confidence: "MEDIUM",
      appliesTo: "taker",
      paidIn: "USDC",
      metadata: {
        topicRate: input.opinionTopicRate,
        formula: "max(notional * topic_rate * price * (1 - price), 0.25)"
      }
    };
  }

  return null;
};

const defaultPolymarketFeeRate = (input: FeeCalculationInput): number | null => {
  const category = input.polymarketCategory?.trim().toUpperCase();
  if (!category) {
    return null;
  }
  if (category === "CRYPTO") return 0.072;
  if (category === "SPORTS") return 0.03;
  if (["FINANCE", "POLITICS", "MENTIONS", "TECH"].includes(category)) return 0.04;
  if (["ECONOMICS", "CULTURE", "WEATHER", "OTHER", "GENERAL"].includes(category)) return 0.05;
  if (["GEOPOLITICS", "WORLD", "WORLD_EVENTS"].includes(category)) return 0;
  return 0.05;
};

const quoteFromBps = (input: {
  feeBps: number;
  notional: InstanceType<typeof Decimal>;
  model: VenueFeeModel;
  source: VenueFeeSource;
  confidence: VenueFeeConfidence;
  paidIn: VenueFeeQuote["paidIn"];
}): VenueFeeQuote => {
  const feeAmount = input.notional.times(input.feeBps).div(10_000);
  return {
    feeModel: input.model,
    feeSource: input.source,
    feeAmount: roundDecimal(feeAmount),
    effectiveFeeBps: roundNumber(new Decimal(input.feeBps)),
    confidence: input.confidence,
    appliesTo: "taker",
    paidIn: input.paidIn
  };
};

const LIMITLESS_BUY_FEE_CURVE: readonly [number, number][] = [
  [0.01, 300],
  [0.5, 300],
  [0.55, 252],
  [0.6, 213],
  [0.65, 180],
  [0.7, 151],
  [0.75, 126],
  [0.8, 105],
  [0.85, 85],
  [0.9, 68],
  [0.95, 53],
  [0.99, 42],
  [0.999, 40]
];

const LIMITLESS_SELL_FEE_CURVE: readonly [number, number][] = [
  [0.01, 42],
  [0.05, 60],
  [0.1, 78],
  [0.2, 111],
  [0.3, 132],
  [0.4, 144],
  [0.5, 150],
  [0.6, 144],
  [0.7, 132],
  [0.8, 111],
  [0.9, 78],
  [0.95, 60],
  [0.99, 45],
  [0.999, 42]
];

const interpolateLimitlessFeeBps = (
  price: InstanceType<typeof Decimal>,
  curve: readonly [number, number][]
): number => {
  const p = Number(Decimal.max(0.01, Decimal.min(0.999, price)).toString());
  for (let index = 1; index < curve.length; index += 1) {
    const [leftPrice, leftBps] = curve[index - 1]!;
    const [rightPrice, rightBps] = curve[index]!;
    if (p <= rightPrice) {
      const span = rightPrice - leftPrice;
      const ratio = span <= 0 ? 0 : (p - leftPrice) / span;
      return roundNumber(new Decimal(leftBps).plus(new Decimal(rightBps - leftBps).times(ratio)));
    }
  }
  return curve[curve.length - 1]![1];
};

const roundDecimal = (value: InstanceType<typeof Decimal>): string =>
  value.toDecimalPlaces(12).toString();

const roundNumber = (value: InstanceType<typeof Decimal>): number =>
  Number(value.toDecimalPlaces(12).toString());
