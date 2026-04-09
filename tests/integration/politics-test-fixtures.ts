import type { CompatibilityDecision } from "../../src/canonical/compatibility-decision.js";
import { PoliticsMatchingPipeline } from "../../src/matching/politics/politics-matching-pipeline.js";
import { buildPoliticsNomineeLivePassArtifacts, type PoliticsNomineeLivePassArtifacts } from "../../src/matching/politics/politics-nominee-live-pass.js";
import { buildPoliticsInventoryGroundedArtifactsFromResult, type PoliticsInventoryGroundedArtifacts } from "../../src/reports/politics-inventory-grounded-pass.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairEdgeRecord,
  StructuralFingerprint
} from "../../src/matching/matching-types.js";
import type { MatchingVersionRecord } from "../../src/matching/matching-versioning.js";
import { buildMatchingMarket } from "./matching-test-fixtures.js";

export class InMemoryPoliticsRepository {
  public readonly versions: MatchingVersionRecord[] = [];
  public readonly classifications = new Map<string, ContractFamilyClassification>();
  public readonly fingerprints = new Map<string, StructuralFingerprint>();
  public readonly edges = new Map<string, PairEdgeRecord>();

  public constructor(
    private readonly markets: readonly MatchingMarketRecord[],
    private readonly compatibilityDecisions: readonly CompatibilityDecision[] = []
  ) {}

  public async upsertMatchingVersion(record: MatchingVersionRecord): Promise<void> {
    this.versions.push(record);
  }

  public async listMatchingMarkets(): Promise<readonly MatchingMarketRecord[]> {
    return this.markets;
  }

  public async listCompatibilityDecisions(): Promise<readonly CompatibilityDecision[]> {
    return this.compatibilityDecisions;
  }

  public async upsertMarketClassification(classification: ContractFamilyClassification): Promise<void> {
    this.classifications.set(classification.interpretedContractId, classification);
  }

  public async upsertStructuralFingerprint(fingerprint: StructuralFingerprint): Promise<void> {
    this.fingerprints.set(fingerprint.interpretedContractId, fingerprint);
  }

  public async upsertPairEdge(edge: PairEdgeRecord): Promise<void> {
    this.edges.set(edge.id, edge);
  }
}

export const buildPoliticsMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  title: string;
  rulesText?: string | null;
  marketClass?: MatchingMarketRecord["marketClass"];
  outcomes?: readonly { label: string }[];
  historicalRowCount?: number;
  sourceMetadataVersion?: string;
}): MatchingMarketRecord => ({
  ...buildMatchingMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    venueMarketId: input.interpretedContractId,
    title: input.title,
    rulesText: input.rulesText ?? input.title,
    category: "POLITICS",
    marketClass: input.marketClass ?? "BINARY",
    ...(input.sourceMetadataVersion ? { sourceMetadataVersion: input.sourceMetadataVersion } : {}),
    ...(input.historicalRowCount !== undefined ? { historicalRowCount: input.historicalRowCount } : {})
  }),
  outcomes: input.outcomes ?? [{ label: "Yes" }, { label: "No" }],
  outcomeSchema: { outcomeLabels: (input.outcomes ?? [{ label: "Yes" }, { label: "No" }]).map((value) => value.label) }
});

export const buildLiveNomineeMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  title?: string;
  rulesText?: string;
  outcomes?: readonly { label: string }[];
  sourceMetadataVersion?: string;
  historicalRowCount?: number;
}): MatchingMarketRecord => {
  const baseInput: Parameters<typeof buildPoliticsMarket>[0] = {
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: input.title ?? "Who will be the 2028 Democratic nominee for U.S. President?",
    rulesText: input.rulesText ?? "Resolves to the candidate who becomes the 2028 Democratic nominee for President of the United States.",
    outcomes: input.outcomes ?? [{ label: "Gavin Newsom" }, { label: "Pete Buttigieg" }, { label: "Other" }]
  };
  if (input.historicalRowCount !== undefined) {
    baseInput.historicalRowCount = input.historicalRowCount;
  }
  if (input.sourceMetadataVersion !== undefined) {
    baseInput.sourceMetadataVersion = input.sourceMetadataVersion;
  }
  return buildPoliticsMarket(baseInput);
};

export const buildOfficeWinnerMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  candidate?: string;
  year?: string;
  title?: string;
  rulesText?: string;
}): MatchingMarketRecord => {
  const candidate = input.candidate ?? "Gavin Newsom";
  const year = input.year ?? "2028";
  return buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: input.title ?? `Will ${candidate} win the ${year} U.S. presidential election?`,
    rulesText: input.rulesText ?? `Resolves yes if ${candidate} wins the ${year} United States presidential election.`
  });
};

export const buildNomineeWinnerMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  candidate?: string;
  year?: string;
}): MatchingMarketRecord =>
  buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: `Will ${(input.candidate ?? "Gavin Newsom")} win the ${(input.year ?? "2028")} Democratic nomination?`,
    rulesText: "Resolves yes if the named candidate becomes the Democratic nominee."
  });

export const buildPartyControlMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
  year?: string;
}): MatchingMarketRecord =>
  buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: `Will Republicans control the U.S. Senate after the ${(input.year ?? "2026")} election?`,
    rulesText: "Resolves yes if Republicans control the United States Senate after the election."
  });

export const buildThresholdByDateMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
}): MatchingMarketRecord =>
  buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: "Will Donald Trump receive at least 300 electoral votes by Nov 5 2028?",
    rulesText: "Resolves yes if Donald Trump receives at least 300 electoral votes by November 5, 2028."
  });

export const buildGeopoliticalMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
}): MatchingMarketRecord =>
  buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: "Will there be a ceasefire in Gaza by Dec 31 2026?",
    rulesText: "Resolves yes if a ceasefire is in effect in Gaza by Dec 31 2026."
  });

export const buildConfirmationMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
}): MatchingMarketRecord =>
  buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: "Will the U.S. Senate confirm the next Supreme Court nominee in 2027?",
    rulesText: "Resolves yes if the Senate confirms the next Supreme Court nominee in 2027."
  });

export const buildOfficeExitMarket = (input: {
  interpretedContractId: string;
  venue: MatchingMarketRecord["venue"];
}): MatchingMarketRecord =>
  buildPoliticsMarket({
    interpretedContractId: input.interpretedContractId,
    venue: input.venue,
    title: "Will Emmanuel Macron leave office by Dec 31 2026?",
    rulesText: "Resolves yes if Emmanuel Macron leaves office by Dec 31 2026."
  });

export const runPoliticsArtifacts = async (markets: readonly MatchingMarketRecord[]): Promise<PoliticsInventoryGroundedArtifacts> => {
  const repository = new InMemoryPoliticsRepository(markets);
  const result = await new PoliticsMatchingPipeline(repository).run();
  return buildPoliticsInventoryGroundedArtifactsFromResult(result);
};

export const runPoliticsNomineeArtifacts = (markets: readonly MatchingMarketRecord[]): PoliticsNomineeLivePassArtifacts =>
  buildPoliticsNomineeLivePassArtifacts(markets, {
    priorNomineeRows: 1,
    priorEligibility: "BASIS_FRAGMENTED"
  });
