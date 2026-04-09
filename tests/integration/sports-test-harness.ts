import type { CompatibilityDecision } from "../../src/canonical/compatibility-decision.js";
import type {
  ContractFamilyClassification,
  MatchingMarketRecord,
  PairEdgeRecord,
  StructuralFingerprint
} from "../../src/matching/matching-types.js";
import type { MatchingVersionRecord } from "../../src/matching/matching-versioning.js";

export class InMemorySportsRepository {
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
