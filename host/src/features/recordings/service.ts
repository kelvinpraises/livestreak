import type { Kysely } from "kysely";
import { deploymentScopeWhere, type DB, type DeploymentScopes } from "../../database/schema.js";
import type { RecordingReceipt, RecordingScope } from "@livestreak/host";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  digest,
  putVerified,
  type ObjectStore,
} from "../../storage/object-store.js";
import { readFragmentTime, readVideoClock, type VideoClock } from "./mp4.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface State extends Mutable<RecordingReceipt> {
  init?: string;
  parts: { id: string; duration: number; start: number }[];
  sealed?: boolean;
  updatedAtMs: number;
}
export interface RecordingWriter {
  push(tag: number, bytes: Uint8Array): void;
  close(clean: boolean): Promise<void>;
}
export interface RecordingService {
  begin(scope: RecordingScope): Promise<RecordingReceipt & { ingestToken: string }>;
  read(scope: RecordingScope): Promise<RecordingReceipt | null>;
  byId(id: string): Promise<RecordingReceipt | null>;
  forMarket(chain: string, marketId: string): Promise<RecordingReceipt | null>;
  open(id: string, token: string): Promise<RecordingWriter>;
  retry(id: string): Promise<RecordingReceipt>;
}
const encoder = new TextEncoder();
const validScope = (s: RecordingScope): void => {
  if (
    !s ||
    typeof s !== "object" ||
    typeof s.runId !== "string" ||
    !["evm", "solana", "sui"].includes(s.chain) ||
    !/^0x[a-fA-F0-9]{64}$/.test(s.marketId) ||
    !s.runId ||
    s.runId.length > 256
  )
    throw new Error("Invalid recording scope");
};
const scopeId = (s: RecordingScope, deploymentScope = ''): string => {
  validScope(s);
  return digest(
    encoder.encode(JSON.stringify([...(deploymentScope ? [deploymentScope] : []), s.chain, s.marketId.toLowerCase(), s.runId])),
  );
};
const validateId = (id: string): void => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid recording id");
};
const receipt = (s: State): RecordingReceipt => ({
  chain: s.chain,
  marketId: s.marketId,
  runId: s.runId,
  id: s.id,
  status: s.status,
  segments: s.segments,
  bytes: s.bytes,
  durationSeconds: s.durationSeconds,
  ...(s.error ? { error: s.error } : {}),
  ...(s.pointer ? { pointer: s.pointer } : {}),
});
// Recording metadata writes replace the same body, so a lost response can be
// retried safely. Keep retries bounded and leave integrity/validation failures fatal.
const retryTransient = async <T>(action: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try { return await action(); }
    catch (error) {
      if (attempt === 2 || !(error instanceof Error) || !/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network error/i.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
};
const readPublic = async (url: string, maxBytes: number): Promise<Uint8Array> => {
  const response = await retryTransient(() => fetch(url, { signal: AbortSignal.timeout(15000) }));
  if (!response.ok || !response.body)
    throw new Error("Public recording delivery failed verification");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error("Public recording exceeds expected size");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};
export const createRecordingService = (
  objects: ObjectStore | null,
  accessToken: string | null,
  db: Kysely<DB>,
  deploymentScopes: DeploymentScopes = {},
): RecordingService => {
  const active = new Set<string>();
  const scoped = deploymentScopeWhere(deploymentScopes);
  const deploymentScope = (chain: string) => deploymentScopes[chain as keyof DeploymentScopes] ?? '';
  const recordingId = (scope: RecordingScope) => scopeId(scope, deploymentScope(scope.chain));
  const store = (): ObjectStore => {
    if (!objects || !accessToken) throw new Error("Host cloud recording is not configured");
    return objects;
  };
  const load = async (id: string): Promise<State | null> => {
    validateId(id);
    const row = await db.selectFrom("recordings").selectAll().where(scoped).where("id", "=", id).executeTakeFirst();
    if (!row) return null;
    const state = JSON.parse(row.body) as State;
      if (
        recordingId(state) !== id ||
        state.id !== id ||
        !Array.isArray(state.parts) ||
        !["recording", "processing", "ready", "failed"].includes(state.status)
      )
        throw new Error("Invalid stored recording state");
      if (
        state.status === "recording" &&
        !active.has(id) &&
        (state.init || state.parts.length > 0) &&
        Date.now() - state.updatedAtMs > 120000
      ) {
        state.status = "failed";
        delete state.pointer;
        state.error =
          "Recording interrupted before completion; partial media cannot become replay";
        await save(state);
      }
      return state;
  };
  const save = async (s: State): Promise<void> => {
    s.updatedAtMs = Date.now();
    const body = JSON.stringify(s);
    const result = await retryTransient(() => db.updateTable("recordings").set({ body }).where(scoped).where("id", "=", s.id).executeTakeFirst());
    if (result.numUpdatedRows !== 1n) throw new Error("Recording metadata unavailable");
  };
  const token = (id: string): string =>
    createHmac("sha256", accessToken ?? "")
      .update(`recording:${id}`)
      .digest("hex");
  const finish = async (s: State): Promise<RecordingReceipt> => {
    if (!s.sealed || !s.init || !s.parts.length)
      throw new Error("Incomplete recording cannot become replay");
    s.status = "processing";
    delete s.error;
    await save(s);
    try {
      // Reverify every media object on retry; metadata alone never makes a replay ready.
      for (const id of [s.init, ...s.parts.map((p) => p.id)]) {
        if (!/^[a-f0-9]{64}$/.test(id) || digest(await store().get(`content/${id}`)) !== id)
          throw new Error("Recording object integrity mismatch");
        if (
          digest(await readPublic(store().publicUrl(`content/${id}`), 8 * 1024 * 1024)) !==
          id
        )
          throw new Error("Public recording media failed verification");
      }
      const target = Math.ceil(Math.max(...s.parts.map((p) => p.duration)));
      const playlist = [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        `#EXT-X-TARGETDURATION:${target}`,
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        `#EXT-X-MAP:URI="${store().publicUrl(`content/${s.init}`)}"`,
        ...s.parts.flatMap((p) => [
          `#EXTINF:${p.duration.toFixed(6)},`,
          store().publicUrl(`content/${p.id}`),
        ]),
        "#EXT-X-ENDLIST",
        "",
      ].join("\n");
      const bytes = encoder.encode(playlist);
      const id = digest(bytes);
      await putVerified(store(), `content/${id}`, bytes, "application/vnd.apple.mpegurl");
      // Public delivery is independently required, rather than assuming authenticated S3 reads imply playback.
      if (digest(await readPublic(store().publicUrl(`content/${id}`), bytes.length)) !== id)
        throw new Error("Public replay delivery failed verification");
      s.pointer = { scheme: "host", id, url: store().publicUrl(`content/${id}`) };
      s.status = "ready";
      await save(s);
      return receipt(s);
    } catch (e) {
      s.status = "failed";
      delete s.pointer;
      s.error = e instanceof Error ? e.message : "Archive verification failed";
      await save(s);
      throw e;
    }
  };
  return {
    async begin(scope) {
      store();
      const id = recordingId(scope);
      const existing = await load(id);
      if (existing) return { ...receipt(existing), ingestToken: token(id) };
      const state: State = {
        ...scope,
        marketId: scope.marketId.toLowerCase(),
        id,
        status: "recording",
        segments: 0,
        bytes: 0,
        durationSeconds: 0,
        parts: [],
        updatedAtMs: Date.now(),
      };
      await db.insertInto("recordings").values({ deployment_scope: deploymentScope(state.chain), id, chain: state.chain, market_id: state.marketId, run_id: state.runId, body: JSON.stringify(state), lease_claimed: 0 }).onConflict(oc => oc.doNothing()).execute();
      const bound = await db.selectFrom("recordings").selectAll().where(scoped).where("chain", "=", scope.chain).where("market_id", "=", state.marketId).executeTakeFirstOrThrow();
      if (bound.id !== id) throw new Error("This market already belongs to another recording run");
      const present = await load(id);
      if (!present) throw new Error("Recording state unavailable");
      return { ...receipt(present), ingestToken: token(id) };

    },
    async read(scope) {
      const state = await load(recordingId(scope));
      return state ? receipt(state) : null;
    },
    async forMarket(chain, marketId) {
      if (!["evm", "solana", "sui"].includes(chain) || !/^0x[a-f0-9]{64}$/i.test(marketId))
        throw new Error("Invalid recording market");
      const binding = await db.selectFrom("recordings").select("id").where(scoped).where("chain", "=", chain).where("market_id", "=", marketId.toLowerCase()).executeTakeFirst();
      const state = binding ? await load(binding.id) : null;
      return state ? receipt(state) : null;
    },
    async byId(id) {
      const state = await load(id);
      return state ? receipt(state) : null;
    },
    async retry(id) {
      if (active.has(id)) throw new Error("Producer is still active");
      const s = await load(id);
      if (!s) throw new Error("Recording not found");
      if (s.status === "ready") return receipt(s);
      return finish(s);
    },
    async open(id, capability) {
      const expected = token(id);
      if (
        Buffer.byteLength(capability) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(capability), Buffer.from(expected))
      )
        throw new Error("Invalid ingest capability");
      if (active.has(id)) throw new Error("Recording already has a producer");
      active.add(id);
      try {
        const s = await load(id);
        if (!s || s.status !== "recording" || s.parts.length || s.init)
          throw new Error("Recording cannot be restarted; use a new observation");
        const claimed = await db.updateTable("recordings").set({ lease_claimed: 1 }).where(scoped).where("id", "=", id).where("lease_claimed", "=", 0).executeTakeFirst();
        if (claimed.numUpdatedRows !== 1n) throw new Error("Recording producer lease already claimed; interrupted streams cannot restart silently");
        let clock: VideoClock | undefined;
        let queue = Promise.resolve();
        let buffered = 0;
        let failure: unknown;
        let ended = false;
        let lastEnd: number | undefined;
        const enqueue = (action: () => Promise<void>, size: number): void => {
          if (failure || ended) return;
          if (size > 8 * 1024 * 1024 || buffered + size > 32 * 1024 * 1024) {
            failure = new Error("Recording upload queue exceeded 32MiB");
            return;
          }
          buffered += size;
          queue = queue
            .then(async () => {
              if (!failure) await action();
            })
            .catch((e) => {
              failure = e;
            })
            .finally(() => {
              buffered -= size;
            });
        };
        return {
          push(tag, bytes) {
            if (tag === 1)
              enqueue(async () => {
                if (clock)
                  throw new Error("Repeated init would replace the recorded epoch");
                clock = readVideoClock(bytes);
                s.init = digest(bytes);
                await putVerified(store(), `content/${s.init}`, bytes, "video/mp4");
                s.bytes += bytes.length;
                await save(s);
              }, bytes.length);
            else if (tag === 2)
              enqueue(async () => {
                if (!clock) throw new Error("Fragment before initialization");
                if (s.parts.length >= 21600)
                  throw new Error("Recording exceeds six-hour segment limit");
                const time = readFragmentTime(bytes, clock);
                if (s.durationSeconds + time.duration > 21600)
                  throw new Error("Recording exceeds six hours");
                if (
                  lastEnd !== undefined &&
                  Math.abs(time.start - lastEnd) > 1 / clock.timescale
                )
                  throw new Error("Recording timeline is discontinuous");
                lastEnd = time.start + time.duration;
                const id = digest(bytes);
                await putVerified(store(), `content/${id}`, bytes, "video/iso.segment");
                s.parts.push({ id, ...time });
                s.segments = s.parts.length;
                s.bytes += bytes.length;
                s.durationSeconds += time.duration;
                await save(s);
              }, bytes.length);
          },
          async close(clean) {
            if (ended) return;
            ended = true;
            try {
              await queue;
              if (failure) throw failure;
              if (!clean)
                throw new Error("Producer disconnected before completing the recording");
              s.sealed = true;
              s.status = "processing";
              await save(s);
              await finish(s);
            } catch (e) {
              s.status = "failed";
              delete s.pointer;
              s.error = e instanceof Error ? e.message : "Recording failed";
              await save(s);
            } finally {
              active.delete(id);
            }
          },
        };
      } catch (e) {
        active.delete(id);
        throw e;
      }
    },
  };
};
