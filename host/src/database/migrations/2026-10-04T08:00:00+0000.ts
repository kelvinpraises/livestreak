import { sql, type Kysely } from "kysely";

/** Complete Host schema, shared by production migration and isolated test fixtures. */
export const RECORDINGS_DDL = `
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  market_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  body TEXT NOT NULL,
  lease_claimed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (chain, market_id)
);
`;

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS markets (
  id            TEXT NOT NULL,
  chain         TEXT NOT NULL,
  route_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  stream_id     TEXT NOT NULL DEFAULT '',
  stream_scheme TEXT NOT NULL DEFAULT '',
  ended_at_ms   INTEGER,
  status        TEXT NOT NULL DEFAULT 'none',
  is_live       INTEGER NOT NULL DEFAULT 0,
  watch_url     TEXT,
  active_vaults INTEGER NOT NULL DEFAULT 0,
  total_pooled  REAL NOT NULL DEFAULT 0,
  from_ms       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, id)
);

CREATE TABLE IF NOT EXISTS vaults (
  id               TEXT NOT NULL,
  market_id        TEXT NOT NULL,
  chain            TEXT NOT NULL,
  question         TEXT NOT NULL,
  side             TEXT,
  status           TEXT NOT NULL,
  resolved_outcome TEXT,
  yes_pool         TEXT NOT NULL DEFAULT '0',
  no_pool          TEXT NOT NULL DEFAULT '0',
  live_yes_pool    TEXT NOT NULL DEFAULT '0',
  live_no_pool     TEXT NOT NULL DEFAULT '0',
  expires_at_ms    INTEGER NOT NULL DEFAULT 0,
  resolved_at_ms   INTEGER,
  updated_at       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, id)
);

CREATE INDEX IF NOT EXISTS idx_vaults_market ON vaults (market_id);

CREATE TABLE IF NOT EXISTS resolutions (
  vault_id    TEXT NOT NULL,
  market_id   TEXT NOT NULL,
  chain       TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  yes_total   TEXT NOT NULL DEFAULT '0',
  no_total    TEXT NOT NULL DEFAULT '0',
  resolved_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, vault_id)
);

CREATE TABLE IF NOT EXISTS steward_memory (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  market_id        TEXT,
  vault_id         TEXT,
  finding_ids      TEXT NOT NULL DEFAULT '[]',
  decision_actions TEXT NOT NULL DEFAULT '[]',
  evidence_refs    TEXT,
  at_ms            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_steward_memory_subject ON steward_memory (subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS forum_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  market_id    TEXT,
  vault_id     TEXT,
  steward_id   TEXT,
  finding_id   TEXT,
  title        TEXT,
  message      TEXT,
  at_ms        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_forum_messages_subject ON forum_messages (subject_kind, subject_id);

${RECORDINGS_DDL}
CREATE TABLE IF NOT EXISTS vault_mandates (digest TEXT PRIMARY KEY, body BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS resolution_records (digest TEXT PRIMARY KEY, chain_id TEXT NOT NULL, vault_id TEXT NOT NULL, body BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS resolution_scope ON resolution_records(chain_id, vault_id);
`;

export async function up<Schema>(db: Kysely<Schema>): Promise<void> {
  for (const statement of SCHEMA_DDL.split(";").map(value => value.trim()).filter(Boolean)) {
    await sql.raw(statement).execute(db);
  }
  const markets = (await sql<{ name: string; pk: number }>`PRAGMA table_info(markets)`.execute(db)).rows;
  const vaults = (await sql<{ name: string }>`PRAGMA table_info(vaults)`.execute(db)).rows;
  for (const statement of upgradeStatements(markets, vaults)) await sql.raw(statement).execute(db);
}

export async function down(): Promise<void> {
  throw new Error("Host baseline cannot be rolled back without losing indexed data and immutable documents");
}

export function upgradeStatements(
  markets: readonly { name: string; pk: number }[],
  vaults: readonly { name: string }[],
): readonly string[] {
  if (!markets.some(column => column.name === "chain" && column.pk > 0)) {
    return catalogUpgradeStatements(markets.map(column => column.name), vaults.map(column => column.name));
  }
  const statements: string[] = [];
  if (!markets.some(column => column.name === "stream_scheme")) statements.push("ALTER TABLE markets ADD COLUMN stream_scheme TEXT NOT NULL DEFAULT ''");
  if (!markets.some(column => column.name === "ended_at_ms")) statements.push("ALTER TABLE markets ADD COLUMN ended_at_ms INTEGER");
  for (const name of ["live_yes_pool", "live_no_pool"]) {
    if (!vaults.some(column => column.name === name)) statements.push(`ALTER TABLE vaults ADD COLUMN ${name} TEXT NOT NULL DEFAULT '0'`);
  }
  return statements;
}

const catalogUpgradeStatements = (
  marketColumns: readonly string[],
  vaultColumns: readonly string[],
): readonly string[] => {
  const tables = ["markets", "vaults", "resolutions"];
  const statements: string[] = tables.map(
    (table) => `ALTER TABLE ${table} RENAME TO ${table}_legacy`,
  );
  // The old index name follows the renamed table. Drop it before creating the new index.
  statements.push("DROP INDEX IF EXISTS idx_vaults_market");
  statements.push(
    ...SCHEMA_DDL.split(";")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const extra = marketColumns.includes("stream_scheme") ? "" : ", '' AS stream_scheme";
  const ending = marketColumns.includes("ended_at_ms") ? "" : ", NULL AS ended_at_ms";
  const columns = [
    ...marketColumns,
    ...(!marketColumns.includes("stream_scheme") ? ["stream_scheme"] : []),
    ...(!marketColumns.includes("ended_at_ms") ? ["ended_at_ms"] : []),
  ];
  statements.push(
    `INSERT INTO markets (${columns.join(",")}) SELECT *${extra}${ending} FROM markets_legacy`,
  );
  const vaultFields = [
    "id",
    "market_id",
    "chain",
    "question",
    "side",
    "status",
    "resolved_outcome",
    "yes_pool",
    "no_pool",
    "live_yes_pool",
    "live_no_pool",
    "expires_at_ms",
    "resolved_at_ms",
    "updated_at",
  ];
  const vaultSelect = vaultFields.map((field) =>
    vaultColumns.includes(field)
      ? field
      : field === "live_yes_pool" || field === "live_no_pool"
        ? "'0'"
        : (() => {
            throw new Error(`Missing legacy vault column: ${field}`);
          })(),
  );
  statements.push(
    `INSERT INTO vaults (${vaultFields.join(",")}) SELECT ${vaultSelect.join(",")} FROM vaults_legacy`,
  );
  statements.push(
    "INSERT INTO resolutions (vault_id,market_id,chain,outcome,yes_total,no_total,resolved_at) SELECT vault_id,market_id,chain,outcome,yes_total,no_total,resolved_at FROM resolutions_legacy",
  );
  // Old replay/category/aggregate conventions must be re-observed, not presented as current.
  statements.push("UPDATE markets SET updated_at = 0");
  statements.push(...tables.reverse().map((table) => `DROP TABLE ${table}_legacy`));
  return statements;
};
