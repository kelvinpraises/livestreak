import type { Request, Response } from "express";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { param } from "../../http/respond.js";
import { verifyPassword } from "./session-store.js";

// --- exports ---

// HTTP surface of the Remote Bridge Console (the WSS legs are upgraded on the
// shared http.Server in features/remote/transport.ts). Mounted under the "remote"
// module gate in server.ts.
export const createRemoteRouter = (deps: Pick<HostRouteDeps, "config" | "remote">): Router => {
  const router = Router();
  const handlers = createRemoteHandlers(deps);

  router.post("/remote/:session/join", (req, res) => handlers.join(req, res));
  router.get("/remote/:session", (req, res) => handlers.serveSpa(req, res));

  return router;
};


// --- Remote Bridge Console: admission handshake + SPA entry (P4) ---
//
// `GET /remote/:session`        -> 302-redirects to the app origin's UI route
//                                  (the app owns routes/remote/$session; the host
//                                  only needs the origin). If no app origin is
//                                  configured the host returns a tiny bootstrap page.
// `POST /remote/:session/join`  -> password -> a host-SIGNED, scoped, expiring
//                                  CapabilityGrant the UI then presents on leg B.
//                                  Only succeeds AFTER the gateway registered the
//                                  session (the host never invents scopes).

export const createRemoteHandlers = (deps: Pick<HostRouteDeps, "config" | "remote">) => ({
  serveSpa: (req: Request, res: Response): void => {
    const sessionId = param(req.params.session);
    const origin = deps.config.remoteAppOrigin;
    if (origin !== null) {
      res.redirect(302, `${origin}/remote/${encodeURIComponent(sessionId)}`);
      return;
    }
    res
      .status(200)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>LiveStreak Remote</title>` +
          `<body><p>Remote session <code>${escapeHtml(sessionId)}</code>.</p>` +
          `<p>Set <code>LIVESTREAK_APP_ORIGIN</code> on the host to serve the console UI.</p></body>`
      );
  },

  join: (req: Request, res: Response): void => {
    const sessionId = param(req.params.session);
    const body = (req.body ?? {}) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";

    const session = deps.remote.store.get(sessionId);
    if (session === undefined) {
      res.status(404).json({ error: { message: "session not found", retryable: false } });
      return;
    }
    if (session.revoked) {
      res.status(410).json({ error: { message: "session revoked", retryable: false } });
      return;
    }
    if (session.expiresAt <= Date.now()) {
      res.status(410).json({ error: { message: "session expired", retryable: false } });
      return;
    }
    if (password.length === 0 || !verifyPassword(session.passwordVerifier, password)) {
      res.status(401).json({ error: { message: "invalid password", retryable: false } });
      return;
    }

    const grant = deps.remote.signer.issueGrant({
      sessionId,
      holder: `ui:${randomHolder()}`,
      scopes: session.scopes,
      expiresAt: session.expiresAt
    });

    res.status(200).json({ grant, wsPath: `/remote/${sessionId}/ui` });
  }
});

// --- helpers ---

const randomHolder = (): string => Math.random().toString(36).slice(2, 12);

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
