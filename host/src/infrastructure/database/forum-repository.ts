import type { Kysely } from "kysely";
import type { ForumMessageDto, ForumMessageInput } from "@livestreak/host";
import type { DB } from "./schema.js";

// Forum repository: post appends, list reads oldest-first by (kind, id) — a readable thread.

export interface ForumListFilter {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly limit?: number;
}

export interface ForumRepository {
  post(message: ForumMessageInput): Promise<ForumMessageDto>;
  list(filter: ForumListFilter): Promise<readonly ForumMessageDto[]>;
}

const DEFAULT_LIST_LIMIT = 200;

export const createForumRepository = (db: Kysely<DB>): ForumRepository => ({
  post: async (message) => {
    const inserted = await db
      .insertInto("forum_messages")
      .values({
        kind: message.kind,
        subject_kind: message.subjectKind,
        subject_id: message.subjectId,
        market_id: message.marketId ?? null,
        vault_id: message.vaultId ?? null,
        steward_id: message.stewardId ?? null,
        finding_id: message.findingId ?? null,
        title: message.title ?? null,
        message: message.message ?? null,
        at_ms: message.atMs
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return { id: Number(inserted.id), ...message };
  },

  list: async (filter) => {
    const rows = await db
      .selectFrom("forum_messages")
      .selectAll()
      .where("subject_kind", "=", filter.subjectKind)
      .where("subject_id", "=", filter.subjectId)
      .orderBy("at_ms", "asc")
      .limit(filter.limit ?? DEFAULT_LIST_LIMIT)
      .execute();
    return rows.map((row) => ({
      id: Number(row.id),
      kind: row.kind as ForumMessageDto["kind"],
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      ...(row.market_id === null ? {} : { marketId: row.market_id }),
      ...(row.vault_id === null ? {} : { vaultId: row.vault_id }),
      ...(row.steward_id === null ? {} : { stewardId: row.steward_id }),
      ...(row.finding_id === null ? {} : { findingId: row.finding_id }),
      ...(row.title === null ? {} : { title: row.title }),
      ...(row.message === null ? {} : { message: row.message }),
      atMs: row.at_ms
    }));
  }
});
