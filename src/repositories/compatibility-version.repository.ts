import type { Pool } from "pg";
import type { CompatibilityVersionDescriptor, CompatibilityVersionRecord } from "../canonical/compatibility-versioning.js";

interface CompatibilityVersionRow {
    id: string;
    scoring_version: string;
    ruleset_version: string;
    model_version: string;
    override_version: string | null;
    created_at: Date;
}

export class CompatibilityVersionRepository {
    public constructor(private readonly pool: Pool) {}

    public async upsert(input: CompatibilityVersionDescriptor): Promise<CompatibilityVersionRecord> {
        const existing = await this.pool.query<CompatibilityVersionRow>(
            `SELECT id, scoring_version, ruleset_version, model_version, override_version, created_at
               FROM compatibility_versions
              WHERE scoring_version = $1
                AND ruleset_version = $2
                AND model_version = $3
                AND COALESCE(override_version, '') = COALESCE($4, '')
              LIMIT 1`,
            [
                input.scoringVersion,
                input.rulesetVersion,
                input.modelVersion,
                input.overrideVersion ?? null
            ]
        );
        if (existing.rows[0]) {
            return mapCompatibilityVersionRow(existing.rows[0]);
        }

        const result = await this.pool.query<CompatibilityVersionRow>(
            `INSERT INTO compatibility_versions (
                scoring_version,
                ruleset_version,
                model_version,
                override_version
            ) VALUES ($1, $2, $3, $4)
            RETURNING id, scoring_version, ruleset_version, model_version, override_version, created_at`,
            [
                input.scoringVersion,
                input.rulesetVersion,
                input.modelVersion,
                input.overrideVersion ?? null
            ]
        );

        return mapCompatibilityVersionRow(result.rows[0]!);
    }
}

const mapCompatibilityVersionRow = (row: CompatibilityVersionRow): CompatibilityVersionRecord => ({
    id: row.id,
    scoringVersion: row.scoring_version,
    rulesetVersion: row.ruleset_version,
    modelVersion: row.model_version,
    overrideVersion: row.override_version,
    createdAt: new Date(row.created_at)
});
