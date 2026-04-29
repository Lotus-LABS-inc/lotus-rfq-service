import { describe, expect, it } from "vitest";
import { SchemaMapService, classifyTable } from "../src/api/admin/schema-map-service.js";
import type { Pool } from "pg";

class FakePool {
  public async query(sql: string): Promise<{ rows: unknown[] }> {
    if (sql.includes("information_schema.columns")) {
      return {
        rows: [
          {
            table_name: "admin_members",
            column_name: "id",
            ordinal_position: 1,
            data_type: "uuid",
            udt_name: "uuid",
            is_nullable: "NO",
            column_default: "gen_random_uuid()"
          },
          {
            table_name: "execution_fee_ledger",
            column_name: "id",
            ordinal_position: 1,
            data_type: "uuid",
            udt_name: "uuid",
            is_nullable: "NO",
            column_default: "gen_random_uuid()"
          },
          {
            table_name: "admin_auth_keys",
            column_name: "admin_member_id",
            ordinal_position: 2,
            data_type: "uuid",
            udt_name: "uuid",
            is_nullable: "NO",
            column_default: null
          }
        ]
      };
    }
    if (sql.includes("information_schema.table_constraints") && sql.includes("constraint_type = 'FOREIGN KEY'")) {
      return {
        rows: [
          {
            constraint_name: "admin_auth_keys_admin_member_id_fkey",
            source_table: "admin_auth_keys",
            source_column: "admin_member_id",
            target_table: "admin_members",
            target_column: "id"
          }
        ]
      };
    }
    if (sql.includes("information_schema.table_constraints")) {
      return {
        rows: [
          { table_name: "admin_members", column_name: "id", constraint_type: "PRIMARY KEY" },
          { table_name: "admin_auth_keys", column_name: "admin_member_id", constraint_type: "FOREIGN KEY" }
        ]
      };
    }
    return {
      rows: [
        { table_name: "admin_members", estimated_rows: "2" },
        { table_name: "admin_auth_keys", estimated_rows: "3" },
        { table_name: "execution_fee_ledger", estimated_rows: "5" }
      ]
    };
  }
}

describe("admin schema map service", () => {
  it("groups tables, columns, and relationships for frontend visualization", async () => {
    const service = new SchemaMapService(new FakePool() as unknown as Pool);
    const schemaMap = await service.buildSchemaMap("2026-04-29T00:00:00.000Z");
    expect(schemaMap.generatedAt).toBe("2026-04-29T00:00:00.000Z");
    expect(schemaMap.tables.find((table) => table.name === "execution_fee_ledger")).toMatchObject({
      group: "Monetization",
      estimatedRows: 5
    });
    expect(schemaMap.tables.find((table) => table.name === "admin_auth_keys")?.outgoing).toHaveLength(1);
    expect(schemaMap.groups.find((group) => group.name === "Control Plane + Ops")?.tableCount).toBe(2);
  });

  it("uses the visualizer classifier for admin and monetization tables", () => {
    expect(classifyTable("admin_members")).toBe("Control Plane + Ops");
    expect(classifyTable("execution_fee_ledger")).toBe("Monetization");
  });
});
