import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";

let tracingSdk: NodeSDK | undefined;
let initialized = false;

export const initializeTracing = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  tracingSdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "lotus-rfq-service"
  });
  await tracingSdk.start();
  initialized = true;
};

export const shutdownTracing = async (): Promise<void> => {
  if (!initialized || !tracingSdk) {
    return;
  }

  await tracingSdk.shutdown();
  tracingSdk = undefined;
  initialized = false;
};

export const withSpan = async <T>(
  spanName: string,
  attributes: Attributes,
  callback: () => Promise<T> | T
): Promise<T> => {
  const tracer = trace.getTracer("lotus-rfq-service");

  return tracer.startActiveSpan(spanName, async (span) => {
    span.setAttributes(attributes);
    try {
      const result = await callback();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown_error"
      });
      throw error;
    } finally {
      span.end();
    }
  });
};

export const withSpanSync = <T>(
  spanName: string,
  attributes: Attributes,
  callback: () => T
): T => {
  const tracer = trace.getTracer("lotus-rfq-service");

  return tracer.startActiveSpan(spanName, (span) => {
    span.setAttributes(attributes);
    try {
      const result = callback();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "unknown_error"
      });
      throw error;
    } finally {
      span.end();
    }
  });
};
