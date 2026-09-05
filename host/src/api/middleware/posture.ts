import { LiveStreakConfigError, serializeLiveStreakError } from "@livestreak/core";
import type { RequestHandler } from "express";
import type { HostServerConfig } from "../../config/host.js";

// --- exports ---

// Part C hardening: CORS allowlist, security headers, a lightweight per-IP rate
// limit on the money/auth routes, and typed 503s for disabled modules. These are
// intentionally dependency-free (single-process dev host); swap in a shared
// store / library if the host is ever run multi-instance.

/**
 * CORS with an explicit allowlist (never `*`). The browser app calls `/aa/*`,
 * `/content/*`, etc. from a different origin; only the configured app origin and
 * loopback origins are allowed so credentialed calls are not world-open.
 */
export const createCorsMiddleware = (config: HostServerConfig): RequestHandler => {
  const allowed = buildAllowedOrigins(config);

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
};

/** Conservative security headers applied to every response. */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
};

export interface RateLimitOptions {
  /** Max requests per window per IP. */
  readonly capacity: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

/**
 * Token-bucket rate limit keyed by client IP. Guards the drain/brute-force
 * surfaces (AA + content routes). In-memory; resets on restart.
 */
export const createRateLimit = (options: RateLimitOptions): RequestHandler => {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  const refillPerMs = options.capacity / options.windowMs;

  return (req, res, next) => {
    const key = clientIp(req);
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: options.capacity, updatedAt: now };

    const elapsed = now - bucket.updatedAt;
    bucket.tokens = Math.min(options.capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      const error = new LiveStreakConfigError({
        message: "Too many requests",
        metadata: { retryable: true }
      });
      res.status(429).json({ error: serializeLiveStreakError(error) });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
};

/**
 * Stub mounted at a disabled module's path prefix so callers get a typed
 * `503 module_disabled` instead of an ambiguous silent 404 (cannot tell "off"
 * from "missing").
 */
export const createModuleDisabledHandler = (moduleToken: string): RequestHandler => (
  _req,
  res
) => {
  const error = new LiveStreakConfigError({
    message: `Module disabled: ${moduleToken}`,
    metadata: { retryable: false }
  });
  res.status(503).json({ error: serializeLiveStreakError(error) });
};

// --- helpers ---

const buildAllowedOrigins = (config: HostServerConfig): ReadonlySet<string> => {
  const origins = new Set<string>();

  const appOrigin = process.env.LIVESTREAK_APP_ORIGIN;
  if (appOrigin !== undefined && appOrigin.length > 0) {
    for (const value of appOrigin.split(",")) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        origins.add(trimmed);
      }
    }
  }

  // Always allow loopback dev origins.
  const port = config.bindPort;
  origins.add(`http://localhost:${port}`);
  origins.add(`http://127.0.0.1:${port}`);
  origins.add("http://localhost:3000");
  origins.add("http://localhost:5173");

  return origins;
};

const clientIp = (req: { ip?: string; socket?: { remoteAddress?: string } }): string =>
  req.ip ?? req.socket?.remoteAddress ?? "unknown";
