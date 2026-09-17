import type { Kysely } from "kysely";
import type { MemoryRecordDto, MemoryRecordInput } from "@livestreak/host";
import type { DB } from "./schema.js";

// Steward memory repository: remember appends, recall reads newest-first by (kind, id).

export interface MemoryRecallFilter {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly limit?: number;
}

export interface MemoryRepository {
  remember(record: MemoryRecordInput): Promise<MemoryRecordDto>;
  recall(filter: MemoryRecallFilter): Promise<readonly MemoryRecordDto[]>;
}

const DEFAULT_RECALL_LIMIT = 100;

export const createMemoryRepository = (db: Kysely<DB>): MemoryRepository => ({
  remember: async (record) => {
    const inserted = await db
      .insertInto("steward_memory")
      .values({
        subject_kind: record.subjectKind,
        subject_id: record.subjectId,
        market_id: record.marketId ?? null,
        vault_id: record.vaultId ?? null,
        finding_ids: JSON.stringify(record.findingIds),
        decision_actions: JSON.stringify(record.decisionActions),
        evidence_refs: record.evidenceRefs === undefined ? null : JSON.stringify(record.evidenceRefs),
        at_ms: record.atMs
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { id: Number(inserted.id), ...record };
  },

  recall: async (filter) => {
    const rows = await db
      .selectFrom("steward_memory")
      .selectAll()
      .where("subject_kind", "=", filter.subjectKind)
      .where("subject_id", "=", filter.subjectId)
      .orderBy("at_ms", "desc")
      .limit(filter.limit ?? DEFAULT_RECALL_LIMIT)
      .execute();
    return rows.map((row) => ({
      id: Number(row.id),
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      ...(row.market_id === null ? {} : { marketId: row.market_id }),
      ...(row.vault_id === null ? {} : { vaultId: row.vault_id }),
      findingIds: parseJsonArray(row.finding_ids),
      decisionActions: parseJsonArray(row.decision_actions),
      ...(row.evidence_refs === null ? {} : { evidenceRefs: parseJsonArray(row.evidence_refs) }),
      atMs: row.at_ms
    }));
  }
});

const parseJsonArray = (raw: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};
