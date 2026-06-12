import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FlowSegment } from "../core/rfq-engine/flow-segmentation.js";

export const executionScopeKinds = [
  "CRYPTO_LANE",
  "SPORTS_LANE",
  "POLITICS_NOMINEE_LANE"
] as const;

export type ExecutionScopeKind = (typeof executionScopeKinds)[number];

export interface ExecutionScopeTokenScopeSnapshot {
  topicKey: string;
  laneType: string;
  venueSet: readonly string[];
  candidateSet: readonly string[];
}

export interface ExecutionScopeTokenClaims {
  version: "execution-scope-v1";
  scopeKind: ExecutionScopeKind;
  scopeId: string;
  principalId: string;
  sessionId: string;
  quoteId: string;
  canonicalMarketId: string;
  flowSegment?: FlowSegment;
  flowSegmentVersion?: string;
  flowSegmentInputHash?: string;
  singleUse: true;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  scope: ExecutionScopeTokenScopeSnapshot;
}

export interface ExecutionScopeAuthoritySnapshot {
  scopeKind: ExecutionScopeKind;
  scopeId: string;
  topicKey: string;
  laneType: string;
  venueSet: readonly string[];
  candidateSet: readonly string[];
  operatorApprovedToOffer: boolean;
  readinessDecision: string;
  authorityRef: string;
}

export interface ExecutionScopeBinding {
  scopeKind: ExecutionScopeKind;
  scopeId: string;
  topicKey: string;
  laneType: string;
  venueSet: readonly string[];
  candidateSet: readonly string[];
  canonicalMarketId: string;
}

export interface ExecutionScopeAuthority {
  getScopeSnapshot(scopeId: string): Promise<ExecutionScopeAuthoritySnapshot | null>;
}

export type ExecutionScopeAuthorityRegistry = Partial<Record<ExecutionScopeKind, ExecutionScopeAuthority>>;

export class ExecutionScopeTokenError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionScopeTokenError";
  }
}

export class ExecutionScopeAuthorityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionScopeAuthorityError";
  }
}

const base64UrlEncode = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

const base64UrlDecode = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf8");

const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeSet = (value: readonly string[]): readonly string[] =>
  [...value].map((entry) => entry.trim()).filter((entry) => entry.length > 0).sort();

const setsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify(normalizeSet(left)) === JSON.stringify(normalizeSet(right));

export class ExecutionScopeTokenService {
  public constructor(private readonly secret: string) {
    if (secret.trim().length === 0) {
      throw new ExecutionScopeTokenError("Execution scope token secret must not be empty.");
    }
  }

  public issue(input: {
    scopeKind: ExecutionScopeKind;
    scopeId: string;
    principalId: string;
    sessionId: string;
    quoteId: string;
    canonicalMarketId: string;
    flowSegment?: FlowSegment;
    flowSegmentVersion?: string;
    flowSegmentInputHash?: string;
    ttlSeconds: number;
    scope: ExecutionScopeTokenScopeSnapshot;
    now?: Date;
  }): { token: string; claims: ExecutionScopeTokenClaims } {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const claims: ExecutionScopeTokenClaims = {
      version: "execution-scope-v1",
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      principalId: input.principalId,
      sessionId: input.sessionId,
      quoteId: input.quoteId,
      canonicalMarketId: input.canonicalMarketId,
      ...(input.flowSegment ? { flowSegment: input.flowSegment } : {}),
      ...(input.flowSegmentVersion ? { flowSegmentVersion: input.flowSegmentVersion } : {}),
      ...(input.flowSegmentInputHash ? { flowSegmentInputHash: input.flowSegmentInputHash } : {}),
      singleUse: true,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      nonce: randomUUID(),
      scope: {
        topicKey: input.scope.topicKey,
        laneType: input.scope.laneType,
        venueSet: normalizeSet(input.scope.venueSet),
        candidateSet: normalizeSet(input.scope.candidateSet)
      }
    };
    return {
      token: this.serialize(claims),
      claims
    };
  }

  public verify(token: string): ExecutionScopeTokenClaims {
    const segments = token.split(".");
    if (segments.length !== 2) {
      throw new ExecutionScopeTokenError("Execution scope token format is invalid.");
    }

    const [encodedPayload, signature] = segments;
    if (!encodedPayload || !signature) {
      throw new ExecutionScopeTokenError("Execution scope token format is invalid.");
    }
    const expectedSignature = this.sign(encodedPayload);
    if (!constantTimeEquals(expectedSignature, signature)) {
      throw new ExecutionScopeTokenError("Execution scope token signature is invalid.");
    }

    let claims: ExecutionScopeTokenClaims;
    try {
      claims = JSON.parse(base64UrlDecode(encodedPayload)) as ExecutionScopeTokenClaims;
    } catch {
      throw new ExecutionScopeTokenError("Execution scope token payload is invalid.");
    }

    if (claims.version !== "execution-scope-v1") {
      throw new ExecutionScopeTokenError("Execution scope token version is not supported.");
    }

    if (!executionScopeKinds.includes(claims.scopeKind)) {
      throw new ExecutionScopeTokenError("Execution scope token kind is not supported.");
    }

    if (!claims.singleUse) {
      throw new ExecutionScopeTokenError("Execution scope token must be single-use.");
    }

    return {
      ...claims,
      scope: {
        ...claims.scope,
        venueSet: normalizeSet(claims.scope.venueSet),
        candidateSet: normalizeSet(claims.scope.candidateSet)
      }
    };
  }

  public async validate(input: {
    token: string;
    principalId: string;
    sessionId: string;
    quoteId: string;
    canonicalMarketId: string;
    actualVenueTargets?: readonly string[];
    expectedFlowSegment?: FlowSegment;
    authorities: ExecutionScopeAuthorityRegistry;
    now?: Date;
  }): Promise<{
    claims: ExecutionScopeTokenClaims;
    authority: ExecutionScopeAuthoritySnapshot;
    binding: ExecutionScopeBinding;
  }> {
    const now = input.now ?? new Date();
    const claims = this.verify(input.token);
    if (claims.principalId !== input.principalId) {
      throw new ExecutionScopeTokenError("Execution scope token principal does not match the request.");
    }
    if (claims.sessionId !== input.sessionId) {
      throw new ExecutionScopeTokenError("Execution scope token session does not match the request.");
    }
    if (claims.quoteId !== input.quoteId) {
      throw new ExecutionScopeTokenError("Execution scope token quote does not match the request.");
    }
    if (claims.canonicalMarketId !== input.canonicalMarketId) {
      throw new ExecutionScopeTokenError("Execution scope token market does not match the request.");
    }
    if (input.expectedFlowSegment && claims.flowSegment !== input.expectedFlowSegment) {
      throw new ExecutionScopeTokenError("Execution scope token flow segment does not match the request.");
    }
    if (new Date(claims.expiresAt).getTime() <= now.getTime()) {
      throw new ExecutionScopeTokenError("Execution scope token has expired.");
    }

    const authority = input.authorities[claims.scopeKind];
    if (!authority) {
      throw new ExecutionScopeAuthorityError(`No execution scope authority is configured for ${claims.scopeKind}.`);
    }

    const snapshot = await authority.getScopeSnapshot(claims.scopeId);
    if (!snapshot) {
      throw new ExecutionScopeAuthorityError(`Execution scope ${claims.scopeId} no longer exists.`);
    }
    if (!snapshot.operatorApprovedToOffer) {
      throw new ExecutionScopeAuthorityError(`Execution scope ${claims.scopeId} is not currently operator-approved.`);
    }
    if (snapshot.topicKey !== claims.scope.topicKey || snapshot.laneType !== claims.scope.laneType) {
      throw new ExecutionScopeAuthorityError(`Execution scope ${claims.scopeId} no longer matches the approved lane metadata.`);
    }
    if (!setsEqual(snapshot.venueSet, claims.scope.venueSet)) {
      throw new ExecutionScopeAuthorityError(`Execution scope ${claims.scopeId} venue set drifted since token issuance.`);
    }
    if (!setsEqual(snapshot.candidateSet, claims.scope.candidateSet)) {
      throw new ExecutionScopeAuthorityError(`Execution scope ${claims.scopeId} candidate set drifted since token issuance.`);
    }
    if (input.actualVenueTargets && !setsEqual(snapshot.venueSet, input.actualVenueTargets)) {
      throw new ExecutionScopeAuthorityError(`Execution scope ${claims.scopeId} does not match the route venue set.`);
    }

    return {
      claims,
      authority: snapshot,
      binding: {
        scopeKind: claims.scopeKind,
        scopeId: claims.scopeId,
        topicKey: snapshot.topicKey,
        laneType: snapshot.laneType,
        venueSet: normalizeSet(snapshot.venueSet),
        candidateSet: normalizeSet(snapshot.candidateSet),
        canonicalMarketId: claims.canonicalMarketId
      }
    };
  }

  private serialize(claims: ExecutionScopeTokenClaims): string {
    const payload = base64UrlEncode(JSON.stringify(claims));
    return `${payload}.${this.sign(payload)}`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }
}
