import type { HostSessionDraft, HostSessionSummary } from "@livestreak/host";

// --- exports ---

export interface SessionStore {
  readonly create: (draft: HostSessionDraft, summary: HostSessionSummary) => boolean;
  readonly get: (sessionId: string) => HostSessionDraft | undefined;
  readonly getSummary: (sessionId: string) => HostSessionSummary | undefined;
}

export const createSessionStore = (): SessionStore => {
  const sessions = new Map<string, { draft: HostSessionDraft; summary: HostSessionSummary }>();

  return {
    create(draft, summary) {
      if (sessions.has(draft.sessionId)) {
        return false;
      }

      if (summary.sessionId !== draft.sessionId) throw new Error("Session summary ID must match draft");
      sessions.set(draft.sessionId, { draft: copySessionDraft(draft), summary: { ...summary } });
      return true;
    },
    get(sessionId) {
      const draft = sessions.get(sessionId)?.draft;
      return draft === undefined ? undefined : copySessionDraft(draft);
    },
    getSummary(sessionId) {
      const summary = sessions.get(sessionId)?.summary;
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
