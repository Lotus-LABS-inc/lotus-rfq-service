export const RFQ_STATES = [
  "CREATED",
  "BROADCAST",
  "COLLECTING_QUOTES",
  "RANKING",
  "AWAITING_USER",
  "ACCEPTED",
  "EXECUTING",
  "SETTLED",
  "FAILED",
  "EXPIRED"
] as const;

export type RFQState = (typeof RFQ_STATES)[number];

const VALID_TRANSITIONS: Readonly<Record<RFQState, readonly RFQState[]>> = {
  CREATED: ["BROADCAST", "FAILED", "EXPIRED"],
  BROADCAST: ["COLLECTING_QUOTES", "FAILED", "EXPIRED"],
  COLLECTING_QUOTES: ["RANKING", "FAILED", "EXPIRED"],
  RANKING: ["AWAITING_USER", "FAILED", "EXPIRED"],
  AWAITING_USER: ["ACCEPTED", "FAILED", "EXPIRED"],
  ACCEPTED: ["EXECUTING", "FAILED", "EXPIRED"],
  EXECUTING: ["SETTLED", "FAILED"],
  SETTLED: [],
  FAILED: [],
  EXPIRED: []
};

export interface RFQStateTransitionContext {
  reason?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface RFQTransitionEvent {
  from: RFQState;
  to: RFQState;
  at: Date;
  context?: RFQStateTransitionContext;
}

export interface RFQStateMachineLogger {
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface RFQStateMachineOptions {
  initialState?: RFQState;
  logger: RFQStateMachineLogger;
  onTransition?: (event: RFQTransitionEvent) => void;
  now?: () => Date;
}

export class InvalidRFQStateTransitionError extends Error {
  public constructor(
    public readonly from: RFQState,
    public readonly to: RFQState
  ) {
    super(`Invalid RFQ transition from ${from} to ${to}.`);
    this.name = "InvalidRFQStateTransitionError";
  }
}

export class RFQStateMachine {
  private currentState: RFQState;
  private readonly logger: RFQStateMachineLogger;
  private readonly onTransition: ((event: RFQTransitionEvent) => void) | undefined;
  private readonly now: () => Date;

  public constructor(options: RFQStateMachineOptions) {
    this.currentState = options.initialState ?? "CREATED";
    this.logger = options.logger;
    this.onTransition = options.onTransition;
    this.now = options.now ?? (() => new Date());
  }

  public getState(): RFQState {
    return this.currentState;
  }

  public getAllowedTransitions(): readonly RFQState[] {
    return VALID_TRANSITIONS[this.currentState];
  }

  public canTransitionTo(nextState: RFQState): boolean {
    return VALID_TRANSITIONS[this.currentState].includes(nextState);
  }

  public transitionTo(nextState: RFQState, context?: RFQStateTransitionContext): RFQState {
    const previousState = this.currentState;

    if (!this.canTransitionTo(nextState)) {
      this.logger.error(
        {
          from: previousState,
          to: nextState,
          allowed: this.getAllowedTransitions()
        },
        "RFQ state transition rejected."
      );
      throw new InvalidRFQStateTransitionError(previousState, nextState);
    }

    const transitionedAt = this.now();
    this.currentState = nextState;

    const eventBase: Omit<RFQTransitionEvent, "context"> = {
      from: previousState,
      to: nextState,
      at: transitionedAt
    };
    const event: RFQTransitionEvent = context ? { ...eventBase, context } : eventBase;

    this.logger.info(
      {
        from: previousState,
        to: nextState,
        at: transitionedAt.toISOString(),
        context
      },
      "RFQ state transitioned."
    );

    this.onTransition?.(event);
    return this.currentState;
  }
}
