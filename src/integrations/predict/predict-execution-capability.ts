export interface PredictExecutionCapability {
  venue: "PREDICT";
  liveTradingEnabled: false;
  eoaAuthSupported: true;
  predictAccountSupported: false;
  custodyRequired: false;
  notes: readonly string[];
}

export const predictExecutionCapability: PredictExecutionCapability = Object.freeze({
  venue: "PREDICT",
  liveTradingEnabled: false,
  eoaAuthSupported: true,
  predictAccountSupported: false,
  custodyRequired: false,
  notes: [
    "EOA-compatible JWT acquisition is prepared for future execution wiring.",
    "Predict Account or smart-wallet flows are intentionally deferred.",
    "Production order submission and cancellation stay disabled in this phase."
  ]
});
