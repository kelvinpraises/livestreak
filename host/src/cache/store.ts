import type { HostCacheReceipt, HostCacheReceiptSubmission } from "@livestreak/host";

// --- exports ---

export interface CacheStore {
  readonly save: (receipt: HostCacheReceipt) => void;
  readonly getBySessionId: (sessionId: string) => readonly HostCacheReceipt[];
  readonly getQuotaRemainingBytes: () => number;
  readonly setQuotaRemainingBytes: (bytes: number) => void;
  readonly recordSubmission: (submission: HostCacheReceiptSubmission) => void;
  readonly listSubmissions: () => readonly HostCacheReceiptSubmission[];
}

export const createCacheStore = (initialQuotaBytes: number): CacheStore => {
  const receipts = new Map<string, HostCacheReceipt[]>();
  const submissions: HostCacheReceiptSubmission[] = [];
  let quotaRemainingBytes = initialQuotaBytes;

  return {
    save(receipt) {
      const existing = receipts.get(receipt.sessionId) ?? [];
      receipts.set(receipt.sessionId, [...existing, receipt]);
    },
    getBySessionId(sessionId) {
      const stored = receipts.get(sessionId) ?? [];
      return stored.map((receipt) => ({ ...receipt, evidence: { ...receipt.evidence } }));
    },
    getQuotaRemainingBytes() {
      return quotaRemainingBytes;
    },
    setQuotaRemainingBytes(bytes) {
      quotaRemainingBytes = bytes;
    },
    recordSubmission(submission) {
      submissions.push(submission);
    },
    listSubmissions() {
      return submissions.map((submission) => ({
        ...submission,
        receipt:
          submission.receipt === null
            ? null
            : {
                ...submission.receipt,
                evidence: { ...submission.receipt.evidence }
              }
      }));
    }
  };
};
