import type { Pool } from "pg";

export const schemaGroups = [
  "Monetization",
  "RFQ",
  "Execution",
  "Funding",
  "Canonical + Matching",
  "Simulation + Qualification",
  "Internalization + Clearing",
  "Control Plane + Ops",
  "System",
  "Other"
] as const;

export type SchemaGroup = (typeof schemaGroups)[number];

export interface SchemaMapColumn {
  name: string;
  position: number;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  constraints: string[];
}

export interface SchemaMapRelationship {
  constraintName: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
}

export interface SchemaMapTable {
  name: string;
  group: SchemaGroup;
  estimatedRows: number;
  columns: SchemaMapColumn[];
  outgoing: SchemaMapRelationship[];
  incoming: SchemaMapRelationship[];
}

export interface SchemaMapResponse {
  generatedAt: string;
  groups: Array<{
    name: SchemaGroup;
    tableCount: number;
    relationshipCount: number;
  }>;
  tables: SchemaMapTable[];
  relationships: SchemaMapRelationship[];
}

interface ColumnRow {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface ConstraintRow {
  table_name: string;
  column_name: string;
  constraint_type: "PRIMARY KEY" | "FOREIGN KEY" | "UNIQUE" | "CHECK";
}

interface ForeignKeyRow {
  constraint_name: string;
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
}

interface TableSizeRow {
  table_name: string;
  estimated_rows: string;
}

export class SchemaMapService {
  public constructor(private readonly pool: Pool) {}

  public async buildSchemaMap(generatedAt = new Date().toISOString()): Promise<SchemaMapResponse> {
    const [columnsResult, constraintsResult, foreignKeysResult, sizesResult] = await Promise.all([
      this.pool.query<ColumnRow>(
        `SELECT
            table_name,
            column_name,
            ordinal_position,
            data_type,
            udt_name,
            is_nullable,
            column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
          ORDER BY table_name ASC, ordinal_position ASC`
      ),
      this.pool.query<ConstraintRow>(
        `SELECT
            tc.table_name,
            kcu.column_name,
            tc.constraint_type
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_schema = kcu.constraint_schema
            AND tc.constraint_name = kcu.constraint_name
            AND tc.table_name = kcu.table_name
          WHERE tc.table_schema = 'public'
            AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')`
      ),
      this.pool.query<ForeignKeyRow>(
        `SELECT
            tc.constraint_name,
            kcu.table_name AS source_table,
            kcu.column_name AS source_column,
            ccu.table_name AS target_table,
            ccu.column_name AS target_column
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_schema = kcu.constraint_schema
            AND tc.constraint_name = kcu.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_schema = tc.constraint_schema
            AND ccu.constraint_name = tc.constraint_name
          WHERE tc.table_schema = 'public'
            AND tc.constraint_type = 'FOREIGN KEY'
          ORDER BY kcu.table_name ASC, kcu.column_name ASC`
      ),
      this.pool.query<TableSizeRow>(
        `SELECT
            relname AS table_name,
            reltuples::bigint::text AS estimated_rows
           FROM pg_class
          WHERE relnamespace = 'public'::regnamespace
            AND relkind IN ('r', 'p')
          ORDER BY relname ASC`
      )
    ]);

    const constraintsByColumn = new Map<string, Set<string>>();
    for (const row of constraintsResult.rows) {
      const key = `${row.table_name}.${row.column_name}`;
      const existing = constraintsByColumn.get(key) ?? new Set<string>();
      existing.add(row.constraint_type);
      constraintsByColumn.set(key, existing);
    }

    const relationships = foreignKeysResult.rows.map(mapRelationship);
    const rowEstimateByTable = new Map(sizesResult.rows.map((row) => [row.table_name, parseRowEstimate(row.estimated_rows)]));
    const columnsByTable = new Map<string, SchemaMapColumn[]>();
    for (const row of columnsResult.rows) {
      const tableColumns = columnsByTable.get(row.table_name) ?? [];
      tableColumns.push({
        name: row.column_name,
        position: row.ordinal_position,
        type: formatType(row),
        nullable: row.is_nullable === "YES",
        defaultValue: row.column_default,
        constraints: [...(constraintsByColumn.get(`${row.table_name}.${row.column_name}`) ?? new Set<string>())].sort()
      });
      columnsByTable.set(row.table_name, tableColumns);
    }

    const tables = [...columnsByTable.entries()]
      .map(([name, columns]) => ({
        name,
        group: classifyTable(name),
        estimatedRows: rowEstimateByTable.get(name) ?? 0,
        columns: columns.sort((left, right) => left.position - right.position),
        outgoing: relationships.filter((relationship) => relationship.sourceTable === name),
        incoming: relationships.filter((relationship) => relationship.targetTable === name)
      }))
      .sort((left, right) => schemaGroups.indexOf(left.group) - schemaGroups.indexOf(right.group) || left.name.localeCompare(right.name));

    return {
      generatedAt,
      groups: schemaGroups.map((group) => ({
        name: group,
        tableCount: tables.filter((table) => table.group === group).length,
        relationshipCount: relationships.filter((fk) => classifyTable(fk.sourceTable) === group || classifyTable(fk.targetTable) === group).length
      })),
      tables,
      relationships
    };
  }
}

export const classifyTable = (tableName: string): SchemaGroup => {
  if (/^(monetization_|execution_fee_|revenue_share_)/.test(tableName)) return "Monetization";
  if (/^(rfq_|lp_|combo_quote)/.test(tableName)) return "RFQ";
  if (/^(execution_|routing_|route_|trades$|trade_|sor_)/.test(tableName)) return "Execution";
  if (/(funding|withdrawal|wallet|balance)/.test(tableName)) return "Funding";
  if (/(canonical|venue_market|proposition|compatibility|resolution_profile|resolution_risk|pair_|matching)/.test(tableName)) return "Canonical + Matching";
  if (/(historical|simulation|strategy_|qualification|promotion|safety|replay)/.test(tableName)) return "Simulation + Qualification";
  if (/(combo_|internal_|clearing|exposure)/.test(tableName)) return "Internalization + Clearing";
  if (/(control_plane|planner_|bucket_|admin_|audit|ops)/.test(tableName)) return "Control Plane + Ops";
  if (tableName === "schema_migrations") return "System";
  return "Other";
};

const mapRelationship = (row: ForeignKeyRow): SchemaMapRelationship => ({
  constraintName: row.constraint_name,
  sourceTable: row.source_table,
  sourceColumn: row.source_column,
  targetTable: row.target_table,
  targetColumn: row.target_column
});

const formatType = (row: ColumnRow): string => {
  if (row.data_type === "USER-DEFINED") return row.udt_name;
  if (row.data_type === "ARRAY") return `${row.udt_name.replace(/^_/, "")}[]`;
  return row.data_type;
};

const parseRowEstimate = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};
