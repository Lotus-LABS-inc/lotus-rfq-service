export type LimitlessPartnerManagedWithdrawalGateContext =
  | "OPERATOR_INTERNAL_GATE"
  | "USER_FACING_RUNTIME"
  | "EXECUTION_RUNTIME";

export type LimitlessPartnerManagedWithdrawalGateStatus = "PASSED" | "BLOCKED";

export interface LimitlessPartnerManagedWithdrawalApprovalConfig {
  enabled: boolean;
  approvalVenue: string | null;
  approvalId: string | null;
  securityReviewId: string | null;
  operatorApprovedBy: string | null;
  approvedAt: string | null;
  approvalExpiresAt: string | null;
  now: () => Date;
}

export interface LimitlessPartnerManagedWithdrawalGateResult {
  artifactSchemaVersion: 1;
  generatedAt: string;
  status: LimitlessPartnerManagedWithdrawalGateStatus;
  context: LimitlessPartnerManagedWithdrawalGateContext;
  venue: "LIMITLESS";
  withdrawalMode: "PARTNER_MANAGED_BACKEND";
  approval: {
    enabled: boolean;
    approvalVenue: string | null;
    approvalIdPresent: boolean;
    securityReviewIdPresent: boolean;
    operatorApprovedByPresent: boolean;
    approvedAt: string | null;
    approvalExpiresAt: string | null;
  };
  checks: {
    featureFlagEnabled: boolean;
    approvalScopedToLimitless: boolean;
    approvalIdPresent: boolean;
    securityReviewIdPresent: boolean;
    operatorApprovedByPresent: boolean;
    approvedAtPresent: boolean;
    approvedAtNotFutureDated: boolean;
    approvalNotExpired: boolean;
    operatorInternalContext: boolean;
  };
  blockers: string[];
  safety: {
    liveVenueWithdrawalExecutionEnabled: false;
    partnerManagedWithdrawalExecutionEnabled: false;
    portfolioWithdrawEndpointCallableFromUserPath: false;
    portfolioRedeemEndpointCallableFromUserPath: false;
    backendBroadcastedTransaction: false;
    backendSignedTransaction: false;
    custodyModelChanged: false;
  };
}

export const buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date()
): LimitlessPartnerManagedWithdrawalApprovalConfig => ({
  enabled: env.LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED === "true",
  approvalVenue: nonEmpty(env.LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE),
  approvalId: nonEmpty(env.LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID),
  securityReviewId: nonEmpty(env.LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_SECURITY_REVIEW_ID),
  operatorApprovedBy: nonEmpty(env.LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_OPERATOR_APPROVED_BY),
  approvedAt: nonEmpty(env.LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVED_AT),
  approvalExpiresAt: nonEmpty(env.LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT),
  now
});

export const validateLimitlessPartnerManagedWithdrawalApproval = (
  config: LimitlessPartnerManagedWithdrawalApprovalConfig,
  context: LimitlessPartnerManagedWithdrawalGateContext = "USER_FACING_RUNTIME"
): LimitlessPartnerManagedWithdrawalGateResult => {
  const now = config.now();
  const blockers: string[] = [];
  const approvalScopedToLimitless = config.approvalVenue === "LIMITLESS";
  const approvedAtTime = parseTime(config.approvedAt);
  const expiresAtTime = parseTime(config.approvalExpiresAt);
  const approvedAtPresent = Boolean(config.approvedAt);
  const approvedAtNotFutureDated = approvedAtTime !== null && approvedAtTime <= now.getTime();
  const approvalNotExpired = expiresAtTime !== null && expiresAtTime > now.getTime();
  const operatorInternalContext = context === "OPERATOR_INTERNAL_GATE";

  if (!config.enabled) {
    blockers.push("LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED must be true.");
  }
  if (!approvalScopedToLimitless) {
    blockers.push("Approval venue must be explicitly scoped to LIMITLESS.");
  }
  if (!config.approvalId) {
    blockers.push("LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID is required.");
  }
  if (!config.securityReviewId) {
    blockers.push("LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_SECURITY_REVIEW_ID is required.");
  }
  if (!config.operatorApprovedBy) {
    blockers.push("LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_OPERATOR_APPROVED_BY is required.");
  }
  if (!approvedAtPresent) {
    blockers.push("LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVED_AT is required.");
  } else if (!approvedAtNotFutureDated) {
    blockers.push("Limitless partner-managed withdrawal approval must not be future-dated.");
  }
  if (!config.approvalExpiresAt) {
    blockers.push("LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT is required.");
  } else if (!approvalNotExpired) {
    blockers.push("Limitless partner-managed withdrawal approval is expired or invalid.");
  }
  if (!operatorInternalContext) {
    blockers.push("Limitless partner-managed withdrawal approval can only pass in operator/internal gate context.");
  }

  const result: LimitlessPartnerManagedWithdrawalGateResult = {
    artifactSchemaVersion: 1,
    generatedAt: now.toISOString(),
    status: blockers.length === 0 ? "PASSED" : "BLOCKED",
    context,
    venue: "LIMITLESS",
    withdrawalMode: "PARTNER_MANAGED_BACKEND",
    approval: {
      enabled: config.enabled,
      approvalVenue: config.approvalVenue,
      approvalIdPresent: Boolean(config.approvalId),
      securityReviewIdPresent: Boolean(config.securityReviewId),
      operatorApprovedByPresent: Boolean(config.operatorApprovedBy),
      approvedAt: config.approvedAt,
      approvalExpiresAt: config.approvalExpiresAt
    },
    checks: {
      featureFlagEnabled: config.enabled,
      approvalScopedToLimitless,
      approvalIdPresent: Boolean(config.approvalId),
      securityReviewIdPresent: Boolean(config.securityReviewId),
      operatorApprovedByPresent: Boolean(config.operatorApprovedBy),
      approvedAtPresent,
      approvedAtNotFutureDated,
      approvalNotExpired,
      operatorInternalContext
    },
    blockers,
    safety: {
      liveVenueWithdrawalExecutionEnabled: false,
      partnerManagedWithdrawalExecutionEnabled: false,
      portfolioWithdrawEndpointCallableFromUserPath: false,
      portfolioRedeemEndpointCallableFromUserPath: false,
      backendBroadcastedTransaction: false,
      backendSignedTransaction: false,
      custodyModelChanged: false
    }
  };
  return result;
};

export const renderLimitlessPartnerManagedWithdrawalGateMarkdown = (
  result: LimitlessPartnerManagedWithdrawalGateResult
): string => [
  "# Limitless Partner-Managed Withdrawal Gate",
  "",
  `- Status: ${result.status}`,
  `- Generated at: ${result.generatedAt}`,
  `- Context: ${result.context}`,
  `- Venue: ${result.venue}`,
  `- Withdrawal mode: ${result.withdrawalMode}`,
  "",
  "## Approval",
  `- Feature flag enabled: ${result.approval.enabled}`,
  `- Approval venue: ${result.approval.approvalVenue ?? "missing"}`,
  `- Approval ID present: ${result.approval.approvalIdPresent}`,
  `- Security review ID present: ${result.approval.securityReviewIdPresent}`,
  `- Operator approved by present: ${result.approval.operatorApprovedByPresent}`,
  `- Approved at: ${result.approval.approvedAt ?? "missing"}`,
  `- Approval expires at: ${result.approval.approvalExpiresAt ?? "missing"}`,
  "",
  "## Checks",
  ...Object.entries(result.checks).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Blockers",
  ...(result.blockers.length === 0 ? ["- None"] : result.blockers.map((blocker) => `- ${blocker}`)),
  "",
  "## Safety",
  "- This gate does not implement or call Limitless partner-managed withdrawals.",
  "- User-facing paths must not call POST /portfolio/withdraw or POST /portfolio/redeem.",
  "- Backend signing, backend broadcasting, custody changes, and live venue mutation remain disabled."
].join("\n");

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const parseTime = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
