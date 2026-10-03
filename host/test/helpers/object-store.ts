// Test double only. There is no local/in-memory production storage fallback.
import { Readable } from "node:stream";
import type { ObjectStore } from "../../src/infrastructure/storage/object-store.js";
export const testObjectStore = (): ObjectStore & { data: Map<string, Uint8Array> } => {
  const data = new Map<string, Uint8Array>();
  const get = async (key: string) => {
    const bytes = data.get(key);
    if (!bytes) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    return bytes.slice();
  };
  return {
    data,
    get,
    async create(k, b) {
      if (data.has(k)) return false;
      data.set(k, b.slice());
      return true;
    },
    async put(k, b) {
      data.set(k, b.slice());
    },
    async open(k) {
      return Readable.from(await get(k));
    },
    async upload(k, body) {
      const chunks: Buffer[] = [];
      for await (const b of body) chunks.push(b);
      data.set(k, Buffer.concat(chunks));
    },
    async promote(from, to) {
      data.set(to, await get(from));
    },
    async remove(k) {
      data.delete(k);
    },
    publicUrl(k) {
      return `https://storage.test/${k}`;
    },
  };
};
