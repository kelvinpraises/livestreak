import { describe, expect, it } from "vitest";
import {
  LiveStreakCapabilityError,
  LiveStreakCommandError,
  LiveStreakConfigError,
  LiveStreakNotImplementedError,
  LiveStreakRegistryError,
  LiveStreakRuntimeError,
  isLiveStreakError,
  serializeLiveStreakError,
  serializeUnknownError,
  toCliError
} from "../src/errors.js";

describe("serializeLiveStreakError", () => {
  it("maps config errors", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakConfigError({ message: "Invalid pause settings" })
    );

    expect(serialized).toMatchObject({
      tag: "LiveStreakConfigError",
      shortName: "config",
      title: "Configuration error",
      message: "Invalid pause settings",
      description:
        "The request could not be accepted because configuration or input was invalid.",
      retryable: false
    });
    expect(serialized.context).toBeUndefined();
  });

  it("maps runtime errors", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakRuntimeError({ message: "Worker failed during capture pump" })
    );

    expect(serialized).toMatchObject({
      tag: "LiveStreakRuntimeError",
      shortName: "runtime",
      title: "Runtime error",
      message: "Worker failed during capture pump"
    });
    expect(serialized.context).toBeUndefined();
  });

  it("maps capability errors with requiredScope context", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakCapabilityError({
        message: "No capability grant authorizes system:pause:setPresentation",
        requiredScope: "system:pause:setPresentation"
      })
    );

    expect(serialized).toMatchObject({
      tag: "LiveStreakCapabilityError",
      shortName: "capability",
      title: "Permission denied",
      context: { requiredScope: "system:pause:setPresentation" }
    });
  });

  it("maps registry errors with registryId context", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakRegistryError({
        message: "Unknown capture driver",
        registryId: "browser"
      })
    );

    expect(serialized).toMatchObject({
      tag: "LiveStreakRegistryError",
      shortName: "registry",
      context: { registryId: "browser" }
    });
  });

  it("maps command errors with commandScope context", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakCommandError({
        message: "Command rejected",
        commandScope: "capture:browser:setCrop"
      })
    );

    expect(serialized).toMatchObject({
      tag: "LiveStreakCommandError",
      shortName: "command",
      context: { commandScope: "capture:browser:setCrop" }
    });
  });

  it("maps not-implemented errors with component context", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakNotImplementedError({
        component: "observe.gateway",
        message: "Gateway transport is not implemented"
      })
    );

    expect(serialized).toMatchObject({
      tag: "LiveStreakNotImplementedError",
      shortName: "not-implemented",
      context: { component: "observe.gateway" }
    });
  });

  it("preserves metadata details, documentationPath, and retryable", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakConfigError({
        message: "Bad input",
        metadata: {
          details: "whilePaused must be hold or slate",
          documentationPath: "/docs/pause",
          retryable: true
        }
      })
    );

    expect(serialized.details).toBe("whilePaused must be hold or slate");
    expect(serialized.documentationPath).toBe("/docs/pause");
    expect(serialized.retryable).toBe(true);
  });

  it("does not serialize metadata.cause", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakRuntimeError({
        message: "Wrapped failure",
        metadata: {
          cause: { secret: "internal" },
          details: "surface detail"
        }
      })
    );

    expect(serialized.details).toBe("surface detail");
    expect(Object.hasOwn(serialized, "cause")).toBe(false);
    expect(JSON.stringify(serialized)).not.toContain("internal");
  });

  it("does not carry metadata.cause through sanitized metadata path", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const serialized = serializeLiveStreakError(
      new LiveStreakConfigError({
        message: "metadata sanitized",
        metadata: {
          cause: circular,
          details: "visible detail"
        }
      })
    );

    expect(serialized).toMatchObject({
      message: "metadata sanitized",
      details: "visible detail"
    });
    expect(Object.hasOwn(serialized, "cause")).toBe(false);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("omits context when capability error has no requiredScope", () => {
    const serialized = serializeLiveStreakError(
      new LiveStreakCapabilityError({ message: "Permission denied" })
    );

    expect(serialized.context).toBeUndefined();
  });

  it("is JSON-safe even when metadata.cause is circular", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const serialized = serializeLiveStreakError(
      new LiveStreakConfigError({
        message: "Invalid config",
        metadata: {
          cause: circular,
          details: "still serializable"
        }
      })
    );

    expect(() => JSON.stringify(serialized)).not.toThrow();
    expect(JSON.parse(JSON.stringify(serialized))).toMatchObject({
      shortName: "config",
      details: "still serializable"
    });
  });

  it("keeps toCliError as a compatibility alias", () => {
    const error = new LiveStreakConfigError({ message: "alias check" });
    expect(toCliError(error)).toEqual(serializeLiveStreakError(error));
  });
});

describe("isLiveStreakError", () => {
  it("returns true for each LiveStreak error class", () => {
    expect(isLiveStreakError(new LiveStreakConfigError({ message: "config" }))).toBe(true);
    expect(isLiveStreakError(new LiveStreakRuntimeError({ message: "runtime" }))).toBe(true);
    expect(
      isLiveStreakError(
        new LiveStreakCapabilityError({
          message: "capability",
          requiredScope: "bridge:board:read"
        })
      )
    ).toBe(true);
    expect(
      isLiveStreakError(
        new LiveStreakRegistryError({ message: "registry", registryId: "browser" })
      )
    ).toBe(true);
    expect(
      isLiveStreakError(
        new LiveStreakCommandError({ message: "command", commandScope: "system:run:stop" })
      )
    ).toBe(true);
    expect(
      isLiveStreakError(
        new LiveStreakNotImplementedError({ component: "gateway", message: "not implemented" })
      )
    ).toBe(true);
  });

  it("returns false for primitive, null, array, plain object, and Error", () => {
    expect(isLiveStreakError(null)).toBe(false);
    expect(isLiveStreakError(undefined)).toBe(false);
    expect(isLiveStreakError("LiveStreakConfigError")).toBe(false);
    expect(isLiveStreakError(42)).toBe(false);
    expect(isLiveStreakError([])).toBe(false);
    expect(isLiveStreakError({ message: "plain" })).toBe(false);
    expect(isLiveStreakError(new Error("native"))).toBe(false);
  });

  it("returns true for cross-boundary objects with a valid _tag and message", () => {
    const value = { _tag: "LiveStreakConfigError", message: "external" };
    expect(isLiveStreakError(value)).toBe(true);
    expect(serializeLiveStreakError(value as LiveStreakConfigError)).toMatchObject({
      tag: "LiveStreakConfigError",
      shortName: "config",
      message: "external"
    });
  });

  it("returns false for objects with unknown _tag values", () => {
    expect(isLiveStreakError({ _tag: "LiveStreakMysteryError", message: "nope" })).toBe(false);
  });

  it("returns false for structurally incomplete or malformed errors", () => {
    expect(isLiveStreakError({ _tag: "LiveStreakConfigError" })).toBe(false);
    expect(isLiveStreakError({ _tag: "LiveStreakCommandError", message: "x" })).toBe(false);
    expect(
      isLiveStreakError({ _tag: "LiveStreakCommandError", message: "x", commandScope: 123 })
    ).toBe(false);
    expect(isLiveStreakError({ _tag: "LiveStreakNotImplementedError", message: "x" })).toBe(false);
    expect(
      isLiveStreakError({ _tag: "LiveStreakCapabilityError", message: "x", requiredScope: 123 })
    ).toBe(false);
    expect(
      isLiveStreakError({ _tag: "LiveStreakRegistryError", message: "x", registryId: 123 })
    ).toBe(false);
    expect(
      isLiveStreakError({ _tag: "LiveStreakConfigError", message: "x", metadata: [] })
    ).toBe(false);
    expect(
      isLiveStreakError({
        _tag: "LiveStreakConfigError",
        message: "x",
        metadata: { retryable: "yes" }
      })
    ).toBe(false);
  });
});

describe("serializeLiveStreakError defensive behavior", () => {
  it("does not emit undefined message or malformed context for bad casts", () => {
    const command = serializeLiveStreakError({
      _tag: "LiveStreakCommandError"
    } as LiveStreakCommandError);

    expect(command.message).toBe("LiveStreak failed");
    expect(command.context).toBeUndefined();
    expect(JSON.stringify(command)).not.toContain("undefined");

    const notImplemented = serializeLiveStreakError({
      _tag: "LiveStreakNotImplementedError",
      message: "missing component"
    } as LiveStreakNotImplementedError);

    expect(notImplemented.message).toBe("missing component");
    expect(notImplemented.context).toBeUndefined();
    expect(JSON.stringify(notImplemented)).not.toContain("undefined");
  });

  it("ignores malformed metadata fields without throwing", () => {
    const serialized = serializeLiveStreakError({
      _tag: "LiveStreakConfigError",
      message: "bad metadata cast",
      metadata: { details: 123, retryable: "yes" }
    } as unknown as LiveStreakConfigError);

    expect(serialized.message).toBe("bad metadata cast");
    expect(serialized.details).toBeUndefined();
    expect(serialized.retryable).toBe(false);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("trims bad-cast LiveStreak messages and falls back on whitespace-only values", () => {
    expect(
      serializeLiveStreakError({
        _tag: "LiveStreakConfigError",
        message: "  bad  "
      } as LiveStreakConfigError).message
    ).toBe("bad");

    expect(
      serializeLiveStreakError({
        _tag: "LiveStreakConfigError",
        message: "   "
      } as LiveStreakConfigError).message
    ).toBe("LiveStreak failed");
  });
});

describe("serializeUnknownError", () => {
  it("delegates LiveStreak errors to serializeLiveStreakError", () => {
    const error = new LiveStreakConfigError({ message: "Invalid config" });
    expect(serializeUnknownError(error)).toEqual(serializeLiveStreakError(error));
  });

  it("serializes native Error values without stack traces", () => {
    const error = new Error("boom");
    error.stack = "secret stack trace";

    const serialized = serializeUnknownError(error);

    expect(serialized).toEqual({
      tag: "UnknownError",
      shortName: "unknown",
      title: "Unknown error",
      message: "boom",
      description: "An unexpected error occurred.",
      retryable: false
    });
    expect(JSON.stringify(serialized)).not.toContain("stack");
    expect(JSON.stringify(serialized)).not.toContain("secret");
  });

  it("serializes string errors", () => {
    expect(serializeUnknownError("network timeout")).toMatchObject({
      tag: "UnknownError",
      message: "network timeout"
    });
    expect(serializeUnknownError(" timeout ").message).toBe("timeout");
    expect(serializeUnknownError("   ").message).toBe("Unknown error");
  });

  it("trims native Error messages and falls back on whitespace-only values", () => {
    expect(serializeUnknownError(new Error(" boom ")).message).toBe("boom");
    expect(serializeUnknownError(new Error("   ")).message).toBe("Unknown error");
  });

  it("falls back for null, undefined, and plain objects", () => {
    expect(serializeUnknownError(null).message).toBe("Unknown error");
    expect(serializeUnknownError(undefined).message).toBe("Unknown error");
    expect(serializeUnknownError({ secret: "value" }).message).toBe("Unknown error");
    expect(JSON.stringify(serializeUnknownError({ secret: "value" }))).not.toContain("secret");
  });

  it("does not serialize cause fields from native errors", () => {
    const error = new Error("wrapped", { cause: { secret: "internal" } });
    const serialized = serializeUnknownError(error);

    expect(serialized.message).toBe("wrapped");
    expect(JSON.stringify(serialized)).not.toContain("internal");
    expect(Object.hasOwn(serialized, "cause")).toBe(false);
  });
});
