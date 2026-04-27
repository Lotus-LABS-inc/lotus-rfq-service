import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv,
  validateLimitlessPartnerManagedWithdrawalApproval
} from "../src/core/funding/limitless-partner-managed-withdrawal-gate.js";

const now = new Date("2026-04-27T00:00:00.000Z");

describe("Limitless partner-managed withdrawal approval gate", () => {
  it("blocks by default when approval fields are missing", () => {
    const result = validateLimitlessPartnerManagedWithdrawalApproval(
      buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv({} as NodeJS.ProcessEnv, () => now),
      "OPERATOR_INTERNAL_GATE"
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED must be true.");
    expect(result.blockers).toContain("LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID is required.");
    expect(result.safety.partnerManagedWithdrawalExecutionEnabled).toBe(false);
  });

  it("blocks when feature flag is disabled even if approval metadata exists", () => {
    const result = validateLimitlessPartnerManagedWithdrawalApproval(
      buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv({
        ...validEnv(),
        LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED: "false"
      } as NodeJS.ProcessEnv, () => now),
      "OPERATOR_INTERNAL_GATE"
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED must be true.");
  });

  it("blocks expired approvals", () => {
    const result = validateLimitlessPartnerManagedWithdrawalApproval(
      buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv({
        ...validEnv(),
        LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT: "2026-04-26T00:00:00.000Z"
      } as NodeJS.ProcessEnv, () => now),
      "OPERATOR_INTERNAL_GATE"
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("Limitless partner-managed withdrawal approval is expired or invalid.");
  });

  it("blocks approvals scoped to the wrong venue", () => {
    const result = validateLimitlessPartnerManagedWithdrawalApproval(
      buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv({
        ...validEnv(),
        LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE: "POLYMARKET"
      } as NodeJS.ProcessEnv, () => now),
      "OPERATOR_INTERNAL_GATE"
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("Approval venue must be explicitly scoped to LIMITLESS.");
  });

  it("blocks fully populated approvals outside operator/internal gate context", () => {
    const result = validateLimitlessPartnerManagedWithdrawalApproval(
      buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv(validEnv() as NodeJS.ProcessEnv, () => now),
      "USER_FACING_RUNTIME"
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("Limitless partner-managed withdrawal approval can only pass in operator/internal gate context.");
  });

  it("passes only for fresh Limitless-scoped operator/internal approval metadata", () => {
    const result = validateLimitlessPartnerManagedWithdrawalApproval(
      buildLimitlessPartnerManagedWithdrawalApprovalConfigFromEnv(validEnv() as NodeJS.ProcessEnv, () => now),
      "OPERATOR_INTERNAL_GATE"
    );

    expect(result.status).toBe("PASSED");
    expect(result.blockers).toEqual([]);
    expect(result.approval).toMatchObject({
      enabled: true,
      approvalVenue: "LIMITLESS",
      approvalIdPresent: true,
      securityReviewIdPresent: true,
      operatorApprovedByPresent: true
    });
    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key|hmac|secret|authorization|privateKey|seed phrase/i);
  });

  it("keeps user-facing runtime paths free of Limitless mutation endpoint wiring", async () => {
    const runtimeFiles = [
      "src/api/routes/funding.ts",
      "src/api/server.ts",
      "src/core/funding/funding-service.ts",
      "src/core/funding/limitless-withdrawal-adapter.ts",
      "src/core/funding/limitless-withdrawal-evidence-read-service.ts"
    ];

    for (const relativePath of runtimeFiles) {
      const content = await readFile(join(process.cwd(), relativePath), "utf8");
      expect(content, `${relativePath} must not wire Limitless partner-managed withdraw`).not.toContain("/portfolio/withdraw");
      expect(content, `${relativePath} must not wire Limitless partner-managed redeem`).not.toContain("/portfolio/redeem");
    }
  });
});

const validEnv = (): Record<string, string> => ({
  LIMITLESS_PARTNER_MANAGED_WITHDRAWALS_ENABLED: "true",
  LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_VENUE: "LIMITLESS",
  LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_ID: "approval-2026-04-27-limitless",
  LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_SECURITY_REVIEW_ID: "security-review-2026-04-27-limitless",
  LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_OPERATOR_APPROVED_BY: "operator@example.com",
  LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVED_AT: "2026-04-27T00:00:00.000Z",
  LIMITLESS_PARTNER_MANAGED_WITHDRAWAL_APPROVAL_EXPIRES_AT: "2026-04-28T00:00:00.000Z"
});
