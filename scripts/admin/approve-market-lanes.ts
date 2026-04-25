import "dotenv/config";

import { Pool } from "pg";

import { CryptoAdminService } from "../../src/api/admin/crypto-admin-service.js";
import { PoliticsGeopoliticalAdminService } from "../../src/api/admin/politics-geopolitical-admin-service.js";
import { PoliticsNomineeAdminService } from "../../src/api/admin/politics-nominee-admin-service.js";
import { PoliticsOfficeExitAdminService } from "../../src/api/admin/politics-office-exit-admin-service.js";
import { PoliticsOfficeWinnerAdminService } from "../../src/api/admin/politics-office-winner-admin-service.js";
import { PoliticsPartyControlAdminService } from "../../src/api/admin/politics-party-control-admin-service.js";
import { SportsAdminService } from "../../src/api/admin/sports-admin-service.js";

/**
 * Dev/bootstrap-only helper for the current operator-review backfill pass.
 *
 * Production approvals should go through the audited admin UI/API endpoints:
 * POST /admin/*-lanes/:laneId/operator-approval-intent
 *
 * This script exists only to seed local/staging review events while the frontend
 * approval surface is not available. It intentionally refuses non-local DB hosts
 * unless --allow-non-local is passed for an explicit, audited bootstrap run.
 */

type ApprovalScope = "all" | "politics" | "sports" | "crypto";

interface LaneLike {
  laneId: string;
  readinessDecision: string;
}

interface AuthorityStateLike {
  operatorApprovedToOffer: boolean;
  latestActionKind: string | null;
}

interface ApprovalService {
  listLanes(): Promise<readonly LaneLike[]>;
  getLaneAuthorityState(laneId: string): Promise<AuthorityStateLike>;
  recordOperatorApprovalIntent(laneId: string, createdBy: string, reason?: string | null): Promise<unknown>;
}

interface CliOptions {
  scope: ApprovalScope;
  dryRun: boolean;
  allowNonLocal: boolean;
  actor: string;
  reason: string;
}

const operatorReviewPendingReadinessDecisions = new Set([
  "READY_FOR_LIMITED_PROD_PENDING_OPERATOR_ACTION",
  "READY_FOR_CANARY_ONLY",
  "READY_BUT_MISSING_OPERATOR_REVIEW"
]);

const parseArgs = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = {
    scope: "all",
    dryRun: false,
    allowNonLocal: process.env.ALLOW_NON_LOCAL_OPERATOR_APPROVALS === "true",
    actor: process.env.OPERATOR_APPROVAL_ACTOR ?? "dev-bootstrap-operator-review",
    reason: process.env.OPERATOR_APPROVAL_REASON ?? "dev/bootstrap-only market lane approval backfill"
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--allow-non-local") {
      options.allowNonLocal = true;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      const scope = arg.slice("--scope=".length);
      if (!["all", "politics", "sports", "crypto"].includes(scope)) {
        throw new Error(`Invalid --scope=${scope}. Expected all, politics, sports, or crypto.`);
      }
      options.scope = scope as ApprovalScope;
      continue;
    }
    if (arg.startsWith("--actor=")) {
      options.actor = arg.slice("--actor=".length).trim();
      continue;
    }
    if (arg.startsWith("--reason=")) {
      options.reason = arg.slice("--reason=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.actor) {
    throw new Error("Operator approval actor must not be empty.");
  }
  if (!options.reason) {
    throw new Error("Operator approval reason must not be empty.");
  }

  return options;
};

const assertSafeDatabaseTarget = (databaseUrl: string, allowNonLocal: boolean): URL => {
  const parsed = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname) && !allowNonLocal) {
    throw new Error(
      `Refusing approval mutations for non-local database host ${parsed.hostname}. ` +
      "Pass --allow-non-local only when this is intentional."
    );
  }
  return parsed;
};

const serviceEntries = (pool: Pool, repoRoot: string, scope: ApprovalScope): readonly { name: string; service: ApprovalService }[] => {
  const politics = [
    { name: "politics:nominee", service: new PoliticsNomineeAdminService({ pool, repoRoot }) as ApprovalService },
    { name: "politics:office-winner", service: new PoliticsOfficeWinnerAdminService({ pool, repoRoot }) as ApprovalService },
    { name: "politics:party-control", service: new PoliticsPartyControlAdminService({ pool, repoRoot }) as ApprovalService },
    { name: "politics:office-exit", service: new PoliticsOfficeExitAdminService({ pool, repoRoot }) as ApprovalService },
    { name: "politics:geopolitical", service: new PoliticsGeopoliticalAdminService({ pool, repoRoot }) as ApprovalService }
  ];
  const sports = [
    { name: "sports", service: new SportsAdminService({ pool, repoRoot }) as ApprovalService }
  ];
  const crypto = [
    { name: "crypto", service: new CryptoAdminService({ pool, repoRoot }) as ApprovalService }
  ];

  if (scope === "politics") return politics;
  if (scope === "sports") return sports;
  if (scope === "crypto") return crypto;
  return [...politics, ...sports, ...crypto];
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  console.warn(
    "[approve-market-lanes] DEV/BOOTSTRAP-ONLY helper. " +
    "Use the admin UI/API for production operator approvals."
  );
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Configure .env or export DATABASE_URL.");
  }

  const parsedDatabaseUrl = assertSafeDatabaseTarget(databaseUrl, options.allowNonLocal);
  const pool = new Pool({ connectionString: databaseUrl });
  const results: Record<string, {
    approved: string[];
    alreadyApproved: string[];
    dryRunWouldApprove: string[];
    skipped: string[];
    failed: { laneId: string; message: string }[];
  }> = {};

  try {
    for (const { name, service } of serviceEntries(pool, process.cwd(), options.scope)) {
      results[name] = {
        approved: [],
        alreadyApproved: [],
        dryRunWouldApprove: [],
        skipped: [],
        failed: []
      };

      for (const lane of await service.listLanes()) {
        try {
          const authority = await service.getLaneAuthorityState(lane.laneId);
          if (authority.operatorApprovedToOffer) {
            results[name]!.alreadyApproved.push(lane.laneId);
            continue;
          }
          if (!operatorReviewPendingReadinessDecisions.has(lane.readinessDecision)) {
            results[name]!.skipped.push(`${lane.laneId} (${lane.readinessDecision})`);
            continue;
          }
          if (options.dryRun) {
            results[name]!.dryRunWouldApprove.push(lane.laneId);
            continue;
          }

          await service.recordOperatorApprovalIntent(lane.laneId, options.actor, options.reason);
          const after = await service.getLaneAuthorityState(lane.laneId);
          if (!after.operatorApprovedToOffer) {
            throw new Error(
              `Approval event recorded but authority gate is still closed; latestActionKind=${after.latestActionKind ?? "null"}`
            );
          }
          results[name]!.approved.push(lane.laneId);
        } catch (error) {
          results[name]!.failed.push({
            laneId: lane.laneId,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({
    database: {
      host: parsedDatabaseUrl.hostname,
      port: parsedDatabaseUrl.port,
      name: parsedDatabaseUrl.pathname.replace(/^\//, "")
    },
    scope: options.scope,
    dryRun: options.dryRun,
    actor: options.actor,
    results
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
