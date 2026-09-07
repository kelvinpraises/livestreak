// `cli stream --video` edge [issue 10]: stream a REAL local file to the UI over WebRTC, no transforms
// (file → WebRTC). The CLI does NOT own WebRTC: the sink lives in @livestreak/observe (SEAM-WEBRTC,
// agent-4) and the cross-process SDP exchange lives in the host relay (SEAM-WEBRTC, agent-2). This
// adapter only: (1) drives observe's file→WebRTC entry, handing it a host-mediated signaling channel,
// and (2) triggers the host local metadata mock so the stream shows a title/category in the UI.
//
// ⚠️ DEPENDENCY FLAG: as of this lane, neither agent-4's observe entry nor agent-2's host relay /
// metadata routes are merged (their replies are empty). We code to the AGREED shapes below; the entry
// is feature-detected at runtime so the CLI build stays green and the command fails with a clear
// "seam not merged" message rather than a compile error. Reconcile the exact names on merge.

import type { LivestreakInitDoc } from "../prefs/init-doc.js";

// ── Agreed SEAM-WEBRTC signaling shape (agent-2 host relay) ──────────────────
// Host relay endpoint: POST `${host}/webrtc/signal` keyed by marketId.
//   publish offer  → { role: "offer",  marketId, sdp }
//   poll  answer   → { role: "answer", marketId } → 200 { sdp } | 404 until the browser answers
export interface FileWebRtcSignaling {
  postOffer(input: { readonly marketId: string; readonly sdp: string }): Promise<void>;
  waitForAnswer(input: { readonly marketId: string }): Promise<{ readonly sdp: string }>;
}

const HOST_SIGNAL_PATH = "/webrtc/signal";
const HOST_METADATA_PATH = "/content/metadata";

export const createHostSignaling = (
  hostBaseUrl: string,
  options: { readonly fetchImpl?: typeof fetch; readonly pollMs?: number; readonly timeoutMs?: number } = {}
): FileWebRtcSignaling => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = hostBaseUrl.replace(/\/$/, "");
  const pollMs = options.pollMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    postOffer: async ({ marketId, sdp }) => {
      const res = await fetchImpl(`${base}${HOST_SIGNAL_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "offer", marketId, sdp })
      });
      if (!res.ok) {
        throw new Error(`host ${HOST_SIGNAL_PATH} offer failed (${res.status})`);
      }
    },
    waitForAnswer: async ({ marketId }) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const res = await fetchImpl(`${base}${HOST_SIGNAL_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "answer", marketId })
        });
        if (res.ok) {
          const body = (await res.json()) as { sdp?: string };
          if (typeof body.sdp === "string" && body.sdp.length > 0) {
            return { sdp: body.sdp };
          }
        }
        if (Date.now() >= deadline) {
          throw new Error("timed out waiting for the browser WebRTC answer");
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  };
};

// ── Agreed local metadata mock (agent-2) ─────────────────────────────────────
// Gives the stream a title/category the UI resolves locally with no new infra.
export const triggerStreamMetadata = async (
  doc: LivestreakInitDoc,
  input: { readonly marketId: string; readonly title: string; readonly category: string },
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  const base = doc.host.url.replace(/\/$/, "");
  const res = await fetchImpl(`${base}${HOST_METADATA_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      marketId: input.marketId,
      title: input.title,
      category: input.category,
      feed: { kind: "webrtc", marketId: input.marketId }
    })
  });
  if (!res.ok) {
    throw new Error(`host ${HOST_METADATA_PATH} failed (${res.status})`);
  }
};

// ── Agreed SEAM-WEBRTC observe entry (agent-4) ───────────────────────────────
export interface StreamFileToWebRtcInput {
  readonly videoPath: string;
  readonly marketId: string;
  readonly signaling: FileWebRtcSignaling;
}

export interface StreamFileHandle {
  /** Resolves when the file has been fully delivered to the peer (or the peer closes). */
  readonly done: Promise<void>;
  stop(): Promise<void>;
}

export type StreamFileToWebRtcEntry = (input: StreamFileToWebRtcInput) => Promise<StreamFileHandle>;

// Candidate export names for the observe file→WebRTC entry; reconcile to the single published name
// once agent-4 merges. Feature-detected so this lane compiles + runs without the seam.
const CANDIDATE_ENTRY_EXPORTS = ["streamFileToWebRtc", "createFileWebRtcStream", "fileToWebRtc"] as const;

export const resolveStreamFileEntry = async (): Promise<StreamFileToWebRtcEntry> => {
  const observe = (await import("@livestreak/observe")) as Record<string, unknown>;
  for (const name of CANDIDATE_ENTRY_EXPORTS) {
    const candidate = observe[name];
    if (typeof candidate === "function") {
      return candidate as StreamFileToWebRtcEntry;
    }
  }
  throw new Error(
    "SEAM-WEBRTC not merged: @livestreak/observe does not yet export a file→WebRTC entry " +
      `(looked for: ${CANDIDATE_ENTRY_EXPORTS.join(", ")}). ` +
      "Blocked on agent-4 (observe sink entry) + agent-2 (host /webrtc/signal relay)."
  );
};
