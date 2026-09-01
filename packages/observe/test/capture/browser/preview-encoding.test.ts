import { describe, expect, it } from "vitest";
import {
  base64FromBytes,
  dataUriFromBytes,
  previewMimeForEncoding
} from "#pipeline/capture/browser/control/preview-encoding.js";

describe("browser preview encoding", () => {
  it("base64FromBytes encodes bytes with Node Buffer", () => {
    const bytes = new TextEncoder().encode("Hello");

    expect(base64FromBytes(bytes)).toBe("SGVsbG8=");
  });

  it("dataUriFromBytes produces mime prefix and base64 body", () => {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    const dataUri = dataUriFromBytes(bytes, "image/jpeg");

    expect(dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(dataUri.slice("data:image/jpeg;base64,".length)).toBe(base64FromBytes(bytes));
  });

  it("previewMimeForEncoding maps jpeg/png encodings", () => {
    expect(previewMimeForEncoding("jpeg")).toBe("image/jpeg");
    expect(previewMimeForEncoding("png")).toBe("image/png");
  });
});
