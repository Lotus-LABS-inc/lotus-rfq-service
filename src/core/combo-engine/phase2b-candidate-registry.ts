import { z } from "zod";

import type { RedisClient } from "../../db/redis.js";
import type { ResidualVector } from "./types.js";

const phase2bCandidateSnapshotSchema = z.object({
  entityId: z.string().min(1),
  userId: z.string().min(1),
  compatibilityBucket: z.string().min(1),
  vector: z.record(z.string(), z.string()),
  legCount: z.number().int().positive(),
  grossAbsSize: z.string().min(1),
  registeredAt: z.string().datetime()
});

interface Phase2BRegistryRedisClient
  extends Pick<Required<RedisClient>, "set" | "get" | "del" | "zadd" | "zrem" | "zrange"> {}

export interface Phase2BCandidateSnapshot extends ResidualVector {
  registeredAt: string;
}

export interface Phase2BCandidateListPage {
  entityIds: readonly string[];
  nextCursor: string | null;
}

export interface UnregisterPhase2BCandidateResult {
  entityId: string;
  bucketId: string;
  removed: boolean;
}

export interface IPhase2BCandidateRegistry {
  registerEntity(vector: ResidualVector): Promise<Phase2BCandidateSnapshot>;
  unregisterEntity(entityId: string, bucketId: string): Promise<UnregisterPhase2BCandidateResult>;
  listBucketEntities(bucketId: string, limit: number, cursor?: string): Promise<Phase2BCandidateListPage>;
  getEntitySnapshot(entityId: string): Promise<Phase2BCandidateSnapshot | null>;
}

export class Phase2BCandidateRegistry implements IPhase2BCandidateRegistry {
  public constructor(private readonly redis: Phase2BRegistryRedisClient) {}

  public async registerEntity(vector: ResidualVector): Promise<Phase2BCandidateSnapshot> {
    const snapshot: Phase2BCandidateSnapshot = {
      ...this.parseVector(vector),
      registeredAt: new Date().toISOString()
    };

    await this.redis.set(this.entityKey(snapshot.entityId), JSON.stringify(snapshot), "PX", 24 * 60 * 60 * 1000);
    await this.redis.zadd(this.bucketKey(snapshot.compatibilityBucket), this.scoreForSnapshot(snapshot), snapshot.entityId);

    return snapshot;
  }

  public async unregisterEntity(
    entityId: string,
    bucketId: string
  ): Promise<UnregisterPhase2BCandidateResult> {
    if (entityId.trim().length === 0) {
      throw new Error("entityId is required.");
    }

    if (bucketId.trim().length === 0) {
      throw new Error("bucketId is required.");
    }

    const [removedFromBucket, removedSnapshot] = await Promise.all([
      this.redis.zrem(this.bucketKey(bucketId), entityId),
      this.redis.del(this.entityKey(entityId))
    ]);

    return {
      entityId,
      bucketId,
      removed: removedFromBucket > 0 || removedSnapshot > 0
    };
  }

  public async listBucketEntities(
    bucketId: string,
    limit: number,
    cursor?: string
  ): Promise<Phase2BCandidateListPage> {
    if (bucketId.trim().length === 0) {
      throw new Error("bucketId is required.");
    }

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const start = cursor ? this.decodeCursor(cursor).offset : 0;
    const stop = start + safeLimit - 1;
    const members = await this.redis.zrange(this.bucketKey(bucketId), start, stop);
    const nextCursor = members.length === safeLimit ? this.encodeCursor(start + members.length) : null;

    return {
      entityIds: members,
      nextCursor
    };
  }

  public async getEntitySnapshot(entityId: string): Promise<Phase2BCandidateSnapshot | null> {
    if (entityId.trim().length === 0) {
      throw new Error("entityId is required.");
    }

    const raw = await this.redis.get(this.entityKey(entityId));
    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("malformed_entity_snapshot");
    }

    try {
      return phase2bCandidateSnapshotSchema.parse(parsed);
    } catch {
      throw new Error("malformed_entity_snapshot");
    }
  }

  public bucketKey(bucketId: string): string {
    return `clearing:bucket:${bucketId}`;
  }

  public entityKey(entityId: string): string {
    return `clearing:entity:${entityId}`;
  }

  private parseVector(vector: ResidualVector): ResidualVector {
    if (vector.entityId.trim().length === 0) {
      throw new Error("entityId is required.");
    }

    if (vector.userId.trim().length === 0) {
      throw new Error("userId is required.");
    }

    if (vector.compatibilityBucket.trim().length === 0) {
      throw new Error("compatibilityBucket is required.");
    }

    if (vector.legCount <= 0) {
      throw new Error("legCount must be positive.");
    }

    if (Object.keys(vector.vector).length === 0) {
      throw new Error("vector must contain at least one signed residual entry.");
    }

    return vector;
  }

  private scoreForSnapshot(snapshot: Phase2BCandidateSnapshot): number {
    return new Date(snapshot.registeredAt).getTime();
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64");
  }

  private decodeCursor(cursor: string): { offset: number } {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { offset?: unknown };
      if (typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
        throw new Error("invalid_bucket_cursor");
      }
      return { offset: parsed.offset };
    } catch {
      throw new Error("invalid_bucket_cursor");
    }
  }
}
