import { describe, expect, it } from "vitest";
import {
  builtInObserveRegistry,
  getBuiltInCaptureDriver,
  getRegistryDescriptor
} from "#index.js";

describe("observe registry", () => {
  it("registers file capture, browser capture, and file sink builtins", () => {
    const fileCapture = getRegistryDescriptor(builtInObserveRegistry, "capture", "file");
    const browserCapture = getRegistryDescriptor(builtInObserveRegistry, "capture", "browser");
    const sink = getRegistryDescriptor(builtInObserveRegistry, "publish", "file");

    expect(fileCapture?.id).toBe("file");
    expect(browserCapture?.id).toBe("browser");
    expect(sink?.id).toBe("file");
    expect(browserCapture?.sourceType).toBe("browser");
  });

  it("does not expose browser through getBuiltInCaptureDriver", () => {
    expect(() => getBuiltInCaptureDriver("browser" as unknown as "file")).toThrow(
      /Unknown built-in capture driver: browser/
    );
  });

  it("models file export as product-facing output", () => {
    const file = getRegistryDescriptor(builtInObserveRegistry, "publish", "file");

    expect(file?.mode).toBe("file");
    expect(file?.requiresHost).toBe(false);
    expect(file?.debugOnly).toBe(false);
  });
});
