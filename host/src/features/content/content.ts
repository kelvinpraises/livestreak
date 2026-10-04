import type { ContentPersistence, PointerScheme, StorePointer } from "@livestreak/host";
import {
  digest,
  putVerified,
  type ObjectStore,
} from "../../storage/object-store.js";

export interface ContentStore {
  store(
    bytes: Uint8Array,
    contentType: string | undefined,
    options: { persistence: ContentPersistence },
  ): Promise<StorePointer>;
  resolve(scheme: PointerScheme, id: string): Promise<Uint8Array>;
}
export const createContentStore = (objects: ObjectStore | null): ContentStore => ({
  async store(bytes, contentType) {
    if (!objects) throw new Error("Cloud storage is not configured");
    if (!bytes.length || bytes.length > 12 * 1024 * 1024)
      throw new Error(
        "Content bytes must be 1..12MiB; use binary upload for larger content",
      );
    const id = digest(bytes);
    await putVerified(
      objects,
      `content/${id}`,
      bytes,
      contentType ?? "application/octet-stream",
    );
    return { scheme: "host", id, url: objects.publicUrl(`content/${id}`) };
  },
  async resolve(scheme, id) {
    if (!objects) throw new Error("Cloud storage is not configured");
    if (scheme !== "host" || !/^[a-f0-9]{64}$/.test(id))
      throw new Error("Unsupported or invalid content reference");
    const bytes = await objects.get(`content/${id}`);
    if (digest(bytes) !== id) throw new Error("Content integrity mismatch");
    return bytes;
  },
});
