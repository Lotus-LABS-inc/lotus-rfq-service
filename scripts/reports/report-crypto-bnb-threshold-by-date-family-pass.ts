#!/usr/bin/env tsx
import { runCryptoBnbThresholdByDateFamilyPass } from "../../src/reports/crypto-bnb-threshold-by-date-family-pass.js";
const main = async (): Promise<void> => { const repoRoot = process.cwd(); const result = await runCryptoBnbThresholdByDateFamilyPass({ repoRoot }); console.log(JSON.stringify({ rowsFetchedByVenue: result.fetchSummary.rowsFetchedByVenue, rowsAdmittedByVenue: result.fetchSummary.rowsAdmittedByVenue, sharedCandidateTopicKeys: result.finalDecision.sharedCandidateTopicKeys, matcherFollowUpJustified: result.finalDecision.matcherFollowUpJustified }, null, 2)); };
main().catch((error) => { console.error("Failed to run crypto BNB threshold by date family pass."); console.error(error); process.exit(1); });
