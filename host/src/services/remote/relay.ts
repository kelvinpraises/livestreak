import { randomUUID } from "node:crypto";
import { hasAnyScope, type CapabilityGrant, type FunctionDescriptor } from "@livestreak/schema";
import type { HostGrantSigner } from "./grant.js";
import { grantAuthorizes } from "./grant.js";
import type { RemoteSessionStore } from "./session-store.js";
import {
  parseJson,
  requiredScopeForCall,
  type GwRegisterMsg,
  type UiCallMsg,
  type UiHelloMsg
} from "./protocol.js";

// --- Remote Bridge Console: the verifying relay (P4) ---
//
// The relay is a DUMB VERIFIER, never a signer of chain tx. It bridges leg A
// (gateway, authenticated) and leg B (UI, session-authenticated). On EVERY
// inbound UI->gateway call it enforces, in order: session liveness, grant
// authenticity (host signature), grant->session+socket binding, scope (canonical
// matcher), and replay (monotonic seq + unseen nonce). It forwards only the
// `{action,args}` envelope to the gateway and the `{result|error}` + board
// patches back. The seed never crosses either leg.

export interface RelayConn {
  readonly send: (frame: unknown) => void;
  readonly close: (code: number, reason?: string) => void;
}

export interface RemoteRelayConfig {
  /** When set, leg-A `register` must present a matching `gatewayToken`. */
  readonly gatewayToken: string | null;
  /** Base URL used to build the shareable `/remote/:session` URL in the ack. */
  readonly remoteBaseUrl: string;
}

export interface RemoteRelay {
  readonly registerGateway: (sessionId: string, conn: RelayConn, raw: unknown) => boolean;
  readonly onGatewayMessage: (sessionId: string, raw: unknown) => void;
  readonly onGatewayClose: (sessionId: string) => void;
  readonly onUiHello: (sessionId: string, connId: string, conn: RelayConn, raw: unknown) => boolean;
  readonly onUiMessage: (sessionId: string, connId: string, conn: RelayConn, raw: unknown) => void;
  readonly onUiClose: (sessionId: string, connId: string) => void;
}

interface PendingCall {
  readonly sessionId: string;
  readonly connId: string;
  readonly uiCallId: string;
}

export const createRemoteRelay = (
  store: RemoteSessionStore,
  signer: HostGrantSigner,
  config: RemoteRelayConfig
): RemoteRelay => {
  // relayCallId -> originating UI + the UI's own callId (so results route back).
  const pending = new Map<string, PendingCall>();
  // (sessionId,connId) -> grant bound at ui.hello.
  const boundGrants = new Map<string, CapabilityGrant>();
  const grantKey = (sessionId: string, connId: string): string => `${sessionId}::${connId}`;

  const filterFunctionsByGrant = (
    functions: readonly FunctionDescriptor[],
    grant: CapabilityGrant
  ): readonly FunctionDescriptor[] => functions.filter((fn) => hasAnyScope([grant], fn.scope));

  const closeSession = (
    sessionId: string,
    reason: "ttl_expired" | "revoked" | "gateway_down"
  ): void => {
    const session = store.revoke(sessionId);
    if (session === undefined) {
      return;
    }
    for (const sink of session.uiSinks.values()) {
      sink({ type: "revoked" });
    }
    if (session.gateway !== null && reason !== "gateway_down") {
      session.gateway({ type: "session_closed", sessionId, reason });
    }
  };

  const registerGateway = (sessionId: string, conn: RelayConn, raw: unknown): boolean => {
    const msg = parseJson(raw);
    if (msg === null || msg.type !== "register") {
      conn.send({ type: "error", message: "expected register" });
      conn.close(4400, "expected register");
      return false;
    }
    const register = msg as unknown as GwRegisterMsg;
    if (register.sessionId !== sessionId) {
      conn.close(4401, "session mismatch");
      return false;
    }
    // Leg-A authentication: the host must trust this socket IS the gateway.
    if (config.gatewayToken !== null && register.gatewayToken !== config.gatewayToken) {
      conn.send({ type: "error", message: "gateway authorization required" });
      conn.close(4401, "gateway auth");
      return false;
    }
    if (
      !Array.isArray(register.scopes) ||
      typeof register.passwordVerifier !== "string" ||
      typeof register.ttlMs !== "number" ||
      register.ttlMs <= 0
    ) {
      conn.close(4400, "invalid register");
      return false;
    }

    store.register({
      sessionId,
      scopes: register.scopes,
      passwordVerifier: register.passwordVerifier,
      ttlMs: register.ttlMs,
      gateway: (frame) => conn.send(frame),
      ...(Array.isArray(register.functions) ? { functions: register.functions } : {})
    });
    conn.send({ type: "ack", sessionId, remoteUrl: `${config.remoteBaseUrl}/remote/${sessionId}` });
    return true;
  };

  const onGatewayMessage = (sessionId: string, raw: unknown): void => {
    const msg = parseJson(raw);
    if (msg === null) {
      return;
    }
    if (msg.type === "call_result" && typeof msg.callId === "string") {
      const route = pending.get(msg.callId);
      pending.delete(msg.callId);
      if (route === undefined) {
        return;
      }
      const sink = store.get(route.sessionId)?.uiSinks.get(route.connId);
      sink?.({
        type: "call_result",
        callId: route.uiCallId,
        ok: msg.ok === true,
        ...(msg.result === undefined ? {} : { result: msg.result }),
        ...(msg.error === undefined ? {} : { error: msg.error })
      });
      return;
    }
    if (msg.type === "board_patch") {
      const session = store.get(sessionId);
      if (session === undefined) {
        return;
      }
      if (typeof msg.target === "string") {
        session.lastBoards[msg.target] = msg.board;
      }
      for (const sink of session.uiSinks.values()) {
        sink({
          type: "board_patch",
          ...(typeof msg.target === "string" ? { target: msg.target } : {}),
          board: msg.board
        });
      }
      return;
    }
    if (msg.type === "functions" && Array.isArray(msg.functions)) {
      const session = store.get(sessionId);
      if (session === undefined) {
        return;
      }
      // Keep the catalog current for late-joining UIs, and push the scope-filtered set to each bound UI.
      session.functions = msg.functions;
      for (const [connId, sink] of session.uiSinks.entries()) {
        const grant = boundGrants.get(grantKey(sessionId, connId));
        if (grant === undefined) {
          continue;
        }
        sink({ type: "functions", functions: filterFunctionsByGrant(msg.functions, grant) });
      }
      return;
    }
    if (msg.type === "revoke") {
      closeSession(sessionId, "revoked");
    }
  };

  const onGatewayClose = (sessionId: string): void => {
    const session = store.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.gateway = null;
    for (const sink of session.uiSinks.values()) {
      sink({ type: "error", code: -32010, message: "gateway disconnected" });
    }
  };

  const onUiHello = (
    sessionId: string,
    connId: string,
    conn: RelayConn,
    raw: unknown
  ): boolean => {
    const msg = parseJson(raw);
    if (msg === null || msg.type !== "ui.hello") {
      conn.send({ type: "error", code: -32600, message: "expected ui.hello" });
      conn.close(4400, "expected hello");
      return false;
    }
    const hello = msg as unknown as UiHelloMsg;
    const session = store.getLive(sessionId);
    if (session === undefined) {
      conn.send({ type: "error", code: -32004, message: "session not available" });
      conn.close(4404, "no session");
      return false;
    }
    const grant = hello.grant;
    // Grant authenticity + binding: host-signed, and bound to THIS session.
    if (
      grant === undefined ||
      grant === null ||
      grant.sessionId !== sessionId ||
      !signer.verifyGrant(grant) ||
      grant.revoked
    ) {
      conn.send({ type: "error", code: -32403, message: "invalid grant" });
      conn.close(4403, "invalid grant");
      return false;
    }
    store.bindUi(sessionId, connId, (frame) => conn.send(frame));
    boundGrants.set(grantKey(sessionId, connId), grant);
    // Filter the gateway-projected catalog by THIS grant's scopes server-side, so
    // the UI only ever learns about functions it is actually authorized to call.
    const functions = filterFunctionsByGrant(session.functions, grant);
    conn.send({ type: "ready", sessionId, functions });
    // Replay EVERY package's latest board (keyed by target) so a late-joining UI sees all boards, not
    // just whichever package pushed last.
    for (const [target, board] of Object.entries(session.lastBoards)) {
      conn.send({ type: "board_patch", target, board });
    }
    return true;
  };

  const onUiMessage = (
    sessionId: string,
    connId: string,
    conn: RelayConn,
    raw: unknown
  ): void => {
    const msg = parseJson(raw);
    if (msg === null || msg.type !== "call") {
      conn.send({ type: "error", code: -32600, message: "unsupported message" });
      return;
    }
    const call = msg as unknown as UiCallMsg;
    const session = store.getLive(sessionId);
    if (session === undefined) {
      conn.send({ type: "error", code: -32004, message: "session not available" });
      conn.close(4404, "no session");
      return;
    }
    const grant = boundGrants.get(grantKey(sessionId, connId));
    if (grant === undefined) {
      conn.send({ type: "error", code: -32403, message: "no grant bound" });
      conn.close(4403, "no grant");
      return;
    }
    if (
      typeof call.callId !== "string" ||
      typeof call.seq !== "number" ||
      typeof call.nonce !== "string"
    ) {
      conn.send({ type: "error", code: -32600, message: "malformed call" });
      return;
    }
    // Replay defense: monotonic seq + unseen nonce, bound to this socket.
    if (!store.checkAndRecordReplay(sessionId, connId, call.seq, call.nonce)) {
      conn.send({
        type: "call_result",
        callId: call.callId,
        ok: false,
        error: { message: "replay rejected" }
      });
      return;
    }
    // Scope check via the CANONICAL matcher — never trust the UI's claimed scope.
    const requiredScope = requiredScopeForCall(call);
    if (!grantAuthorizes(signer, grant, requiredScope)) {
      conn.send({
        type: "call_result",
        callId: call.callId,
        ok: false,
        error: { code: -32403, message: `scope denied: ${requiredScope}` }
      });
      return;
    }
    if (session.gateway === null) {
      conn.send({
        type: "call_result",
        callId: call.callId,
        ok: false,
        error: { code: -32010, message: "gateway unavailable" }
      });
      return;
    }
    // Authorized: relay the envelope to the gateway (the ONLY signer). Use a
    // host-minted relayCallId so UIs cannot collide/forge each other's calls.
    const relayCallId = `c_${randomUUID()}`;
    pending.set(relayCallId, { sessionId, connId, uiCallId: call.callId });
    session.gateway({
      type: "call",
      callId: relayCallId,
      sessionId,
      ...(typeof call.target === "string" ? { target: call.target } : {}),
      envelope: { scope: requiredScope, action: call.envelope.action, args: call.envelope.args }
    });
  };

  const onUiClose = (sessionId: string, connId: string): void => {
    store.unbindUi(sessionId, connId);
    boundGrants.delete(grantKey(sessionId, connId));
  };

  return {
    registerGateway,
    onGatewayMessage,
    onGatewayClose,
    onUiHello,
    onUiMessage,
    onUiClose
  };
};
