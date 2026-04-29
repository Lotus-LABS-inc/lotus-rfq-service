import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";

loadDotenv();

const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL, DATABASE_URL, or TEST_DATABASE_URL is required to generate the DB schema visualizer.");
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

interface SchemaColumn {
  name: string;
  position: number;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  constraints: Set<string>;
}

interface SchemaTable {
  name: string;
  group: SchemaGroup;
  estimatedRows: number;
  columns: SchemaColumn[];
  outgoing: ForeignKeyRow[];
  incoming: ForeignKeyRow[];
}

const schemaGroups = [
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

type SchemaGroup = (typeof schemaGroups)[number];

const classifyTable = (tableName: string): SchemaGroup => {
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

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const formatType = (row: ColumnRow): string => {
  if (row.data_type === "USER-DEFINED") return row.udt_name;
  if (row.data_type === "ARRAY") return `${row.udt_name.replace(/^_/, "")}[]`;
  return row.data_type;
};

const parseRowEstimate = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

const formatNumber = (value: number): string => new Intl.NumberFormat("en-US").format(value);

const pool = new Pool({ connectionString: databaseUrl });

try {
  const [columnsResult, constraintsResult, foreignKeysResult, sizesResult] = await Promise.all([
    pool.query<ColumnRow>(
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
    pool.query<ConstraintRow>(
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
    pool.query<ForeignKeyRow>(
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
    pool.query<TableSizeRow>(
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

  const rowEstimateByTable = new Map(sizesResult.rows.map((row) => [row.table_name, parseRowEstimate(row.estimated_rows)]));
  const columnsByTable = new Map<string, SchemaColumn[]>();
  for (const row of columnsResult.rows) {
    const tableColumns = columnsByTable.get(row.table_name) ?? [];
    tableColumns.push({
      name: row.column_name,
      position: row.ordinal_position,
      type: formatType(row),
      nullable: row.is_nullable === "YES",
      defaultValue: row.column_default,
      constraints: constraintsByColumn.get(`${row.table_name}.${row.column_name}`) ?? new Set<string>()
    });
    columnsByTable.set(row.table_name, tableColumns);
  }

  const tables: SchemaTable[] = [...columnsByTable.entries()]
    .map(([name, columns]) => ({
      name,
      group: classifyTable(name),
      estimatedRows: rowEstimateByTable.get(name) ?? 0,
      columns: columns.sort((left, right) => left.position - right.position),
      outgoing: foreignKeysResult.rows.filter((fk) => fk.source_table === name),
      incoming: foreignKeysResult.rows.filter((fk) => fk.target_table === name)
    }))
    .sort((left, right) => schemaGroups.indexOf(left.group) - schemaGroups.indexOf(right.group) || left.name.localeCompare(right.name));

  const tablesByGroup = new Map<SchemaGroup, SchemaTable[]>();
  for (const group of schemaGroups) {
    tablesByGroup.set(group, tables.filter((table) => table.group === group));
  }

  const groupSummaries = schemaGroups
    .map((group) => {
      const groupTables = tablesByGroup.get(group) ?? [];
      const relationshipCount = foreignKeysResult.rows.filter((fk) => classifyTable(fk.source_table) === group || classifyTable(fk.target_table) === group).length;
      return `<button class="group-pill" data-group="${escapeHtml(group)}">
        <span>${escapeHtml(group)}</span>
        <strong>${groupTables.length}</strong>
        <small>${relationshipCount} links</small>
      </button>`;
    })
    .join("\n");

  const relationshipRows = foreignKeysResult.rows
    .map((fk) => `<tr>
      <td><code>${escapeHtml(fk.source_table)}.${escapeHtml(fk.source_column)}</code></td>
      <td>to</td>
      <td><code>${escapeHtml(fk.target_table)}.${escapeHtml(fk.target_column)}</code></td>
    </tr>`)
    .join("\n");

  const tableCards = schemaGroups
    .map((group) => {
      const groupTables = tablesByGroup.get(group) ?? [];
      if (groupTables.length === 0) return "";

      const cards = groupTables
        .map((table) => {
          const columnRows = table.columns
            .map((column) => {
              const badges = [
                column.constraints.has("PRIMARY KEY") ? "<span class=\"badge badge-pk\">PK</span>" : "",
                column.constraints.has("FOREIGN KEY") ? "<span class=\"badge badge-fk\">FK</span>" : "",
                column.constraints.has("UNIQUE") ? "<span class=\"badge badge-unique\">UQ</span>" : "",
                !column.nullable ? "<span class=\"badge\">NN</span>" : ""
              ]
                .filter(Boolean)
                .join("");
              return `<li>
                <span class="column-name">${escapeHtml(column.name)}</span>
                <span class="column-type">${escapeHtml(column.type)}</span>
                <span class="column-badges">${badges}</span>
              </li>`;
            })
            .join("\n");

          const outgoing = table.outgoing
            .map((fk) => `<li><code>${escapeHtml(fk.source_column)}</code> to <code>${escapeHtml(fk.target_table)}.${escapeHtml(fk.target_column)}</code></li>`)
            .join("\n");
          const incoming = table.incoming
            .slice(0, 8)
            .map((fk) => `<li><code>${escapeHtml(fk.source_table)}.${escapeHtml(fk.source_column)}</code></li>`)
            .join("\n");
          const incomingOverflow = table.incoming.length > 8 ? `<li class="muted">+${table.incoming.length - 8} more inbound links</li>` : "";

          return `<article class="table-card" data-group="${escapeHtml(group)}" data-table="${escapeHtml(table.name)}">
            <header>
              <div>
                <h3>${escapeHtml(table.name)}</h3>
                <p>${escapeHtml(group)}</p>
              </div>
              <span class="row-estimate">${formatNumber(table.estimatedRows)} rows</span>
            </header>
            <ul class="columns">${columnRows}</ul>
            <div class="relationship-panels">
              <section>
                <h4>References</h4>
                <ul>${outgoing || "<li class=\"muted\">none</li>"}</ul>
              </section>
              <section>
                <h4>Referenced by</h4>
                <ul>${incoming || "<li class=\"muted\">none</li>"}${incomingOverflow}</ul>
              </section>
            </div>
          </article>`;
        })
        .join("\n");

      return `<section class="group-section" data-group-section="${escapeHtml(group)}">
        <div class="section-heading">
          <h2>${escapeHtml(group)}</h2>
          <span>${groupTables.length} tables</span>
        </div>
        <div class="table-grid">${cards}</div>
      </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lotus DB Schema Map</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-border: #d9dee8;
      --text: #172033;
      --muted: #667085;
      --accent: #0f766e;
      --accent-soft: #d8f3ef;
      --pk: #7c3aed;
      --fk: #2563eb;
      --uq: #b45309;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    main {
      width: min(1680px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 24px 0 48px;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(247, 248, 251, 0.94);
      border-bottom: 1px solid var(--panel-border);
      backdrop-filter: blur(8px);
      padding: 18px 0;
    }
    .topbar-inner {
      width: min(1680px, calc(100vw - 32px));
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(280px, 1fr) minmax(260px, 420px);
      gap: 20px;
      align-items: end;
    }
    h1, h2, h3, h4, p { margin: 0; }
    h1 { font-size: 24px; line-height: 1.1; letter-spacing: 0; }
    .subtitle { color: var(--muted); margin-top: 6px; }
    .search-box {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    input {
      width: 100%;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
      padding: 10px 12px;
      outline: none;
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.14);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(120px, 1fr));
      gap: 12px;
      margin: 18px 0;
    }
    .stat, .relationships {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .stat { padding: 14px; }
    .stat span { color: var(--muted); display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .stat strong { display: block; font-size: 24px; margin-top: 4px; }
    .group-pills {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin: 18px 0 26px;
    }
    .group-pill {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      border-radius: 8px;
      box-shadow: var(--shadow);
      color: var(--text);
      cursor: pointer;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2px 10px;
      min-height: 64px;
      padding: 12px;
      text-align: left;
    }
    .group-pill strong { color: var(--accent); font-size: 20px; }
    .group-pill small { color: var(--muted); grid-column: 1 / -1; }
    .group-pill.active {
      background: var(--accent-soft);
      border-color: var(--accent);
    }
    .section-heading {
      align-items: baseline;
      display: flex;
      justify-content: space-between;
      margin: 26px 0 12px;
    }
    .section-heading h2 { font-size: 18px; }
    .section-heading span { color: var(--muted); }
    .table-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .table-card {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 8px;
      box-shadow: var(--shadow);
      min-width: 0;
      overflow: hidden;
    }
    .table-card header {
      align-items: start;
      border-bottom: 1px solid var(--panel-border);
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 12px 14px;
    }
    .table-card h3 {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .table-card header p, .row-estimate, .muted { color: var(--muted); }
    .row-estimate {
      flex: 0 0 auto;
      font-size: 12px;
      padding-top: 1px;
    }
    .columns {
      list-style: none;
      margin: 0;
      max-height: 320px;
      overflow: auto;
      padding: 8px 0;
    }
    .columns li {
      align-items: center;
      display: grid;
      grid-template-columns: minmax(120px, 1fr) minmax(82px, auto) auto;
      gap: 8px;
      min-height: 28px;
      padding: 4px 14px;
    }
    .columns li:nth-child(even) { background: #f9fafc; }
    .column-name, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      overflow-wrap: anywhere;
    }
    .column-type { color: var(--muted); font-size: 12px; text-align: right; }
    .column-badges {
      display: flex;
      gap: 4px;
      justify-content: end;
      min-width: 56px;
    }
    .badge {
      background: #eef2f7;
      border-radius: 999px;
      color: #344054;
      display: inline-flex;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      padding: 4px 5px;
    }
    .badge-pk { background: #ede9fe; color: var(--pk); }
    .badge-fk { background: #dbeafe; color: var(--fk); }
    .badge-unique { background: #fef3c7; color: var(--uq); }
    .relationship-panels {
      border-top: 1px solid var(--panel-border);
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .relationship-panels section {
      min-width: 0;
      padding: 10px 14px 12px;
    }
    .relationship-panels section + section { border-left: 1px solid var(--panel-border); }
    .relationship-panels h4 { font-size: 12px; margin-bottom: 6px; text-transform: uppercase; color: var(--muted); }
    .relationship-panels ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .relationship-panels li {
      font-size: 12px;
      margin-top: 5px;
      overflow-wrap: anywhere;
    }
    .relationships {
      margin-top: 28px;
      overflow: hidden;
    }
    .relationships header {
      border-bottom: 1px solid var(--panel-border);
      padding: 14px;
    }
    .relationships table {
      border-collapse: collapse;
      width: 100%;
    }
    .relationships td {
      border-bottom: 1px solid #edf0f5;
      padding: 8px 14px;
      vertical-align: top;
    }
    .relationships tr:last-child td { border-bottom: 0; }
    .hidden { display: none !important; }
    @media (max-width: 760px) {
      main, .topbar-inner { width: min(100vw - 20px, 1680px); }
      .topbar-inner, .stats, .relationship-panels { grid-template-columns: 1fr; }
      .relationship-panels section + section { border-left: 0; border-top: 1px solid var(--panel-border); }
      .table-grid { grid-template-columns: 1fr; }
      .columns li { grid-template-columns: 1fr; }
      .column-type { text-align: left; }
      .column-badges { justify-content: start; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-inner">
      <div>
        <h1>Lotus DB Schema Map</h1>
        <p class="subtitle">Grouped operational view of public Postgres tables. No secrets or connection strings are embedded.</p>
      </div>
      <div class="search-box">
        <label for="search">Filter tables or columns</label>
        <input id="search" type="search" placeholder="Try monetization, rfq, execution_id, settlement...">
      </div>
    </div>
  </div>
  <main>
    <section class="stats">
      <div class="stat"><span>Tables</span><strong>${formatNumber(tables.length)}</strong></div>
      <div class="stat"><span>Columns</span><strong>${formatNumber(columnsResult.rows.length)}</strong></div>
      <div class="stat"><span>Foreign keys</span><strong>${formatNumber(foreignKeysResult.rows.length)}</strong></div>
      <div class="stat"><span>Generated</span><strong>${escapeHtml(new Date().toISOString().slice(0, 10))}</strong></div>
    </section>
    <nav class="group-pills" aria-label="Schema groups">
      <button class="group-pill active" data-group="ALL"><span>All groups</span><strong>${formatNumber(tables.length)}</strong><small>${formatNumber(foreignKeysResult.rows.length)} links</small></button>
      ${groupSummaries}
    </nav>
    ${tableCards}
    <section class="relationships">
      <header>
        <h2>Foreign Key Links</h2>
        <p class="subtitle">${formatNumber(foreignKeysResult.rows.length)} explicit relationships discovered from Postgres constraints.</p>
      </header>
      <table>${relationshipRows || "<tr><td>No foreign key constraints found.</td></tr>"}</table>
    </section>
  </main>
  <script>
    const search = document.querySelector("#search");
    const groupButtons = Array.from(document.querySelectorAll("[data-group]"));
    let activeGroup = "ALL";

    const applyFilters = () => {
      const query = search.value.trim().toLowerCase();
      const cards = Array.from(document.querySelectorAll(".table-card"));
      const sections = Array.from(document.querySelectorAll(".group-section"));

      for (const card of cards) {
        const groupMatches = activeGroup === "ALL" || card.dataset.group === activeGroup;
        const textMatches = !query || card.textContent.toLowerCase().includes(query);
        card.classList.toggle("hidden", !(groupMatches && textMatches));
      }

      for (const section of sections) {
        const visibleCards = section.querySelectorAll(".table-card:not(.hidden)").length;
        section.classList.toggle("hidden", visibleCards === 0);
      }
    };

    for (const button of groupButtons) {
      button.addEventListener("click", () => {
        activeGroup = button.dataset.group;
        for (const candidate of groupButtons) {
          candidate.classList.toggle("active", candidate === button);
        }
        applyFilters();
      });
    }

    search.addEventListener("input", applyFilters);
  </script>
</body>
</html>`;

  const artifactDir = join(process.cwd(), "artifacts", "db");
  await mkdir(artifactDir, { recursive: true });
  const outputPath = join(artifactDir, "schema-visualizer.html");
  await writeFile(outputPath, html, "utf8");
  console.log(`[report:db:schema-visualizer] wrote ${outputPath}`);
  console.log(`[report:db:schema-visualizer] tables=${tables.length} columns=${columnsResult.rows.length} foreignKeys=${foreignKeysResult.rows.length}`);
} finally {
  await pool.end();
}
