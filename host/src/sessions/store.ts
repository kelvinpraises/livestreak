import type { HostSessionDraft, HostSessionSummary } from "@livestreak/host";

// --- exports ---

export interface SessionStore {
  readonly create: (draft: HostSessionDraft, summary: HostSessionSummary) => boolean;
  readonly get: (sessionId: string) => HostSessionDraft | undefined;
  readonly getSummary: (sessionId: string) => HostSessionSummary | undefined;
}

export const createSessionStore = (): SessionStore => {
  const drafts = new Map<string, HostSessionDraft>();
  const summaries = new Map<string, HostSessionSummary>();

  return {
    create(draft, summary) {
      if (drafts.has(draft.sessionId)) {
        return false;
      }

      drafts.set(draft.sessionId, draft);
      summaries.set(summary.sessionId, summary);
      return true;
    },
    get(sessionId) {
      const draft = drafts.get(sessionId);
      return draft === undefined ? undefined : copySessionDraft(draft);
    },
    getSummary(sessionId) {
      const summary = summaries.get(sessionId);
      return summary === undefined ? undefined : { ...summary };
    }
  };
};

// --- helpers ---

const copySessionDraft = (draft: HostSessionDraft): HostSessionDraft => ({
  ...draft,
  endpoints: draft.endpoints.map((endpoint) => ({ ...endpoint })),
  manifestDraft: {
    ...draft.manifestDraft,
    endpoints: draft.manifestDraft.endpoints.map((endpoint) => ({ ...endpoint })),
    cacheReceiptRefs: [...draft.manifestDraft.cacheReceiptRefs]
  },
  policy: draft.policy
});
