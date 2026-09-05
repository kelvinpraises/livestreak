import { describe, expect, it, vi } from "vitest";
import { resolvePassword } from "../src/gateway/password.js";

describe("gateway/password — resolvePassword precedence", () => {
  it("returns the explicit flag value immediately (flag > env > prompt)", async () => {
    // Even if env is set, the flag wins.
    const original = process.env["LIVESTREAK_PASSWORD"];
    process.env["LIVESTREAK_PASSWORD"] = "env-secret";
    try {
      const pw = await resolvePassword("flag-secret");
      expect(pw).toBe("flag-secret");
    } finally {
      if (original === undefined) {
        delete process.env["LIVESTREAK_PASSWORD"];
      } else {
        process.env["LIVESTREAK_PASSWORD"] = original;
      }
    }
  });

  it("falls back to LIVESTREAK_PASSWORD env var when no flag", async () => {
    const original = process.env["LIVESTREAK_PASSWORD"];
    process.env["LIVESTREAK_PASSWORD"] = "env-secret";
    try {
      const pw = await resolvePassword(undefined);
      expect(pw).toBe("env-secret");
    } finally {
      if (original === undefined) {
        delete process.env["LIVESTREAK_PASSWORD"];
      } else {
        process.env["LIVESTREAK_PASSWORD"] = original;
      }
    }
  });

  it("throws loudly when non-interactive and neither flag nor env is set", async () => {
    const original = process.env["LIVESTREAK_PASSWORD"];
    delete process.env["LIVESTREAK_PASSWORD"];

    // Vitest runs in a non-TTY environment, so process.stdin.isTTY is falsy —
    // resolvePassword must throw instead of attempting to prompt.
    try {
      await expect(resolvePassword(undefined)).rejects.toThrow(/password required/i);
    } finally {
      if (original !== undefined) {
        process.env["LIVESTREAK_PASSWORD"] = original;
      }
    }
  });

  it("ignores an empty-string flag and falls through to env", async () => {
    const original = process.env["LIVESTREAK_PASSWORD"];
    process.env["LIVESTREAK_PASSWORD"] = "env-fallback";
    try {
      const pw = await resolvePassword("");
      expect(pw).toBe("env-fallback");
    } finally {
      if (original === undefined) {
        delete process.env["LIVESTREAK_PASSWORD"];
      } else {
        process.env["LIVESTREAK_PASSWORD"] = original;
      }
    }
  });

  it("ignores an empty-string env and falls through to error in non-interactive shell", async () => {
    const original = process.env["LIVESTREAK_PASSWORD"];
    process.env["LIVESTREAK_PASSWORD"] = "";
    try {
      // Empty env = not set → must throw in non-TTY context.
      await expect(resolvePassword(undefined)).rejects.toThrow(/password required/i);
    } finally {
      if (original === undefined) {
        delete process.env["LIVESTREAK_PASSWORD"];
      } else {
        process.env["LIVESTREAK_PASSWORD"] = original;
      }
    }
  });
});
