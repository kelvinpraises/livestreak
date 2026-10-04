import { sql, type Kysely } from "kysely";
import { catalogUpgradeStatements } from "../catalog-upgrade.js";
export const up = async (db: Kysely<unknown>): Promise<void> => {
  const columns = (
    await sql<{ name: string; pk: number }>`PRAGMA table_info(markets)`.execute(db)
  ).rows;
  if (columns.some((column) => column.name === "chain" && column.pk > 0)) return;
  const vaultColumns = (await sql<{ name: string }>`PRAGMA table_info(vaults)`.execute(db))
    .rows;
  for (const statement of catalogUpgradeStatements(
    columns.map((column) => column.name),
    vaultColumns.map((column) => column.name),
  ))
    await sql.raw(statement).execute(db);
};
export const down = async (): Promise<void> => {
  throw new Error(
    "Catalog integrity migration cannot downgrade without losing chain-qualified identities.",
  );
};
