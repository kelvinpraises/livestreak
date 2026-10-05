import { createDatabase, type TestDatabaseHandle } from "../src/database/connection.js";
import { migrateSync } from "../src/database/migrations/index.js";
const databases: TestDatabaseHandle[] = [];
const metadata = () => { const handle = createDatabase(":memory:"); migrateSync(handle.sqlite); databases.push(handle); return handle.db; };
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecordingService } from "../src/features/recordings/service.js";
import { createFmp4Chunker } from "../../packages/observe/src/pipeline/publish/encoder/fmp4-boxes.js";
import { testObjectStore } from "./helpers/object-store.js";
const scope = {
  chain: "evm" as const,
  marketId: `0x${"a".repeat(64)}`,
  runId: "run#observation",
};
const video = () => {
  const bytes = execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10",
    "-t",
    "2",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "10",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "empty_moov+default_base_moof+frag_keyframe",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  const chunker = createFmp4Chunker();
  return [...chunker.push(bytes), ...chunker.flush()];
};
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(databases.splice(0).map(handle => handle.close())); });
describe("cloud recordings", () => {
  it("records real encoded fragments, survives service restart and exposes a verified HLS receipt", async () => {
    const store = testObjectStore();
    const db = metadata();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            new Uint8Array(await store.get(new URL(url).pathname.slice(1))).buffer,
          ),
      ),
    );
    const service = createRecordingService(store, "secret", db);
    const recording = await service.begin(scope);
    expect((await service.begin(scope)).id).toBe(recording.id);
    const writer = await service.open(recording.id, recording.ingestToken);
    await expect(service.open(recording.id, recording.ingestToken)).rejects.toThrow(
      "producer",
    );
    for (const chunk of video()) writer.push(chunk.kind === "init" ? 1 : 2, chunk.data);
    await writer.close(true);
    const receipt = await createRecordingService(store, "secret", db).read(scope);
    expect(receipt?.status).toBe("ready");
    expect([...store.data.keys()].every(key => key.startsWith("content/"))).toBe(true);
    expect((await db.selectFrom("recordings").selectAll().executeTakeFirstOrThrow()).lease_claimed).toBe(1);
    expect(receipt?.durationSeconds).toBeCloseTo(2);
    expect(receipt?.segments).toBe(2);
    const playlist = new TextDecoder().decode(
      await store.get(`content/${receipt!.pointer!.id}`),
    );
    expect(playlist).toContain("#EXT-X-ENDLIST");
    expect(playlist).toContain("#EXT-X-MAP");
    expect(playlist).toContain("https://storage.test/content/");
    await expect(service.begin({ ...scope, runId: "different" })).rejects.toThrow(
      "another recording run",
    );
  });
  it("does not produce a replay for an interrupted producer or permit silent producer restart", async () => {
    const store = testObjectStore();
    const db = metadata();
    const service = createRecordingService(store, "secret", db);
    const recording = await service.begin(scope);
    const writer = await service.open(recording.id, recording.ingestToken);
    for (const chunk of video()) writer.push(chunk.kind === "init" ? 1 : 2, chunk.data);
    await writer.close(false);
    expect((await service.read(scope))?.pointer).toBeUndefined();
    await expect(service.retry(recording.id)).rejects.toThrow("Incomplete");
    await expect(
      createRecordingService(store, "secret", db).open(recording.id, recording.ingestToken),
    ).rejects.toThrow("cannot be restarted");
  });
  it("requires public playback delivery and retries a sealed recording after a Host restart", async () => {
    const store = testObjectStore();
    const db = metadata();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    const service = createRecordingService(store, "secret", db);
    const recording = await service.begin(scope);
    const writer = await service.open(recording.id, recording.ingestToken);
    for (const chunk of video()) writer.push(chunk.kind === "init" ? 1 : 2, chunk.data);
    await writer.close(true);
    expect((await service.read(scope))?.status).toBe("failed");
    expect((await service.read(scope))?.pointer).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            new Uint8Array(await store.get(new URL(url).pathname.slice(1))).buffer,
          ),
      ),
    );
    expect((await createRecordingService(store, "secret", db).retry(recording.id)).status).toBe(
      "ready",
    );
  });
  it("fails closed without cloud storage and rejects a malformed capability", async () => {
    await expect(createRecordingService(null, null, metadata()).begin(scope)).rejects.toThrow(
      "not configured",
    );
    const service = createRecordingService(testObjectStore(), "secret", metadata());
    const recording = await service.begin(scope);
    await expect(service.open(recording.id, "é".repeat(64))).rejects.toThrow(
      "Invalid ingest capability",
    );
  });
});

it("a fresh Host reports stale partial recording state as failed, never as a replay", async () => {
  const store = testObjectStore();
  const db = metadata();
  const service = createRecordingService(store, "secret", db);
  const recording = await service.begin(scope);
  const row = await db.selectFrom("recordings").selectAll().where("id", "=", recording.id).executeTakeFirstOrThrow();
  const state = JSON.parse(row.body);
  state.init = "a".repeat(64);
  state.updatedAtMs = 1;
  await db.updateTable("recordings").set({body: JSON.stringify(state)}).where("id", "=", recording.id).execute();
  const receipt = await createRecordingService(store, "secret", db).read(scope);
  expect(receipt?.status).toBe("failed");
  expect(receipt?.pointer).toBeUndefined();
  await expect(createRecordingService(store, "secret", db).retry(recording.id)).rejects.toThrow(
    "Incomplete",
  );
});

it("atomically binds a market and claims the producer across Host instances", async () => {
  const store = testObjectStore(); const db = metadata();
  const a = createRecordingService(store, "secret", db); const b = createRecordingService(store, "secret", db);
  const begun = await Promise.all([a.begin(scope), b.begin(scope)]);
  expect(begun[0].id).toBe(begun[1].id);
  expect(await db.selectFrom("recordings").selectAll().execute()).toHaveLength(1);
  const writers = await Promise.allSettled([a.open(begun[0].id, begun[0].ingestToken), b.open(begun[0].id, begun[0].ingestToken)]);
  expect(writers.filter(result => result.status === "fulfilled")).toHaveLength(1);
  for (const result of writers) if (result.status === "fulfilled") await result.value.close(false);
  expect(store.data.size).toBe(0);
});


describe("recording metadata network blips", () => {
  it("retries the same metadata write and preserves the complete recording", async () => {
    const store = testObjectStore();
    const db = metadata();
    vi.stubGlobal("fetch", async (url: string) => new Response(new Uint8Array(await store.get(new URL(url).pathname.slice(1))).buffer));
    const executor = db.getExecutor();
    const execute = executor.executeQuery.bind(executor);
    let failures = 0;
    vi.spyOn(executor, "executeQuery").mockImplementation(async (query, queryId) => {
      if (query.sql.startsWith('update "recordings" set "body"') && failures < 2) {
        failures++;
        throw new TypeError("fetch failed");
      }
      return execute(query, queryId);
    });
    const service = createRecordingService(store, "secret", db);
    const recording = await service.begin(scope);
    const writer = await service.open(recording.id, recording.ingestToken);
    for (const chunk of video()) writer.push(chunk.kind === "init" ? 1 : 2, chunk.data);
    await writer.close(true);
    const receipt = await service.read(scope);
    expect(failures).toBe(2);
    expect(receipt?.status).toBe("ready");
    expect(receipt?.segments).toBe(2);
    expect(receipt?.durationSeconds).toBeCloseTo(2);
  });
});
