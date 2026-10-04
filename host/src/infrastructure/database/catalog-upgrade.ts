import { SCHEMA_DDL } from "./ddl.js";

export const catalogUpgradeStatements = (
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
