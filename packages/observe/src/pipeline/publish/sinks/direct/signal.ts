// Host signaling for the direct sink — the ONLY things the host does for a direct stream:
//   echo    POST /reachability/echo        dial the broadcaster from OUTSIDE (the eligibility truth)
//   announce POST/DELETE /live/direct/:id  publish the broadcaster's watch URL so viewers can find it
// No media byte ever touches the host on this lane.
//
// Announce ownership: the first announce mints a key (the announcer's receipt); heartbeat re-announces
// and the final withdraw carry it. "conflict" means another broadcaster owns the stream's announce —
// the driver treats that as a go-live gate failure; network errors stay fail-open.

export type AnnounceResult =
  | { readonly status: "ok"; readonly key?: string }
  | { readonly status: "conflict" }
  | { readonly status: "unavailable" };

export interface DirectSignalClient {
  /** True when the host dialed the advertised port back successfully (TCP handshake from outside). */
  readonly verifyReachable: (port: number) => Promise<boolean>;
  readonly announce: (streamId: string, watchUrl: string, key?: string) => Promise<AnnounceResult>;
  readonly withdraw: (streamId: string, key?: string) => Promise<void>;
}

export const createDirectSignalClient = (hostBaseUrl: string): DirectSignalClient => {
  const base = hostBaseUrl.replace(/\/+$/, "");
  return {
    verifyReachable: async (port) => {
      try {
        const response = await fetch(`${base}/reachability/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ port })
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { reachable?: unknown };
        return body.reachable === true;
      } catch {
        return false;
      }
    },
    announce: async (streamId, watchUrl, key) => {
      try {
        const response = await fetch(`${base}/live/direct/${encodeURIComponent(streamId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ watchUrl, ...(key === undefined ? {} : { key }) })
        });
        if (response.status === 409) return { status: "conflict" };
        if (!response.ok) return { status: "unavailable" };
        const body = (await response.json()) as { key?: unknown };
        return { status: "ok", ...(typeof body.key === "string" ? { key: body.key } : {}) };
      } catch {
        return { status: "unavailable" };
      }
    },
    withdraw: async (streamId, key) => {
      await fetch(`${base}/live/direct/${encodeURIComponent(streamId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(key === undefined ? {} : { key })
      }).catch(() => undefined);
    }
  };
};
