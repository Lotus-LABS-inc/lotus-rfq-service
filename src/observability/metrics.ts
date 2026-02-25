import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics
} from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const counterConfig = {
  registers: [registry]
};

const histogramConfig = {
  registers: [registry]
};

const gaugeConfig = {
  registers: [registry]
};

export const rfqCreatedTotal = new Counter({
  name: "rfq_created_total",
  help: "Total number of RFQs created.",
  ...counterConfig
});

export const rfqExpiredTotal = new Counter({
  name: "rfq_expired_total",
  help: "Total number of RFQs expired.",
  ...counterConfig
});

export const quoteReceivedTotal = new Counter({
  name: "quote_received_total",
  help: "Total number of quotes received.",
  ...counterConfig
});

export const executionSuccessTotal = new Counter({
  name: "execution_success_total",
  help: "Total number of successful executions.",
  ...counterConfig
});

export const executionFailureTotal = new Counter({
  name: "execution_failure_total",
  help: "Total number of failed executions.",
  ...counterConfig
});

export const quoteLatencyMs = new Histogram({
  name: "quote_latency_ms",
  help: "Quote processing latency in milliseconds.",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
  ...histogramConfig
});

export const rankingDurationMs = new Histogram({
  name: "ranking_duration_ms",
  help: "Ranking duration in milliseconds.",
  buckets: [0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500],
  ...histogramConfig
});

export const executionLatencyMs = new Histogram({
  name: "execution_latency_ms",
  help: "Execution attempt latency in milliseconds.",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  ...histogramConfig
});

export const lockWaitTimeMs = new Histogram({
  name: "lock_wait_time_ms",
  help: "Time spent waiting for execution lock acquisition in milliseconds.",
  buckets: [0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1000],
  ...histogramConfig
});

export const activeRFQSessions = new Gauge({
  name: "active_rfq_sessions",
  help: "Estimated number of active RFQ sessions.",
  ...gaugeConfig
});

export const wsConnectionsActive = new Gauge({
  name: "ws_connections_active",
  help: "Number of active WebSocket client connections.",
  ...gaugeConfig
});

export const metricsRegistry = registry;
