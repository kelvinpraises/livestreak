import type { ForumMessage, ForumThread, ForumThreadRecord } from "@livestreak/host";

// --- exports ---

export interface ForumStore {
  readonly createThread: (thread: ForumThread, messages: readonly ForumMessage[]) => ForumThreadRecord;
  readonly getThread: (threadId: string) => ForumThreadRecord | undefined;
  readonly appendMessage: (message: ForumMessage) => ForumThreadRecord | undefined;
}

export const createForumStore = (): ForumStore => {
  const threads = new Map<string, ForumThreadRecord>();

  return {
    createThread(thread, messages) {
      const record = { thread, messages: [...messages] };
      threads.set(thread.threadId, record);
      return record;
    },
    getThread(threadId) {
      return threads.get(threadId);
    },
    appendMessage(message) {
      const existing = threads.get(message.threadId);
      if (existing === undefined) {
        return undefined;
      }

      const updated = {
        thread: {
          ...existing.thread,
          updatedAtMs: message.createdAtMs
        },
        messages: [...existing.messages, message]
      };
      threads.set(message.threadId, updated);
      return updated;
    }
  };
};
