// SEAM-WEBRTC-TURN — the host IS the media relay, not a bolt-on coturn.
//
// The host already relays signaling (signal.ts); it should also relay MEDIA so a producer/viewer just
// points at the host for both. This embeds a pure-Node STUN/TURN server (node-turn) in the host process:
// no separate coturn to run. Producers/viewers behind NAT (Docker container, remote box) route their
// WebRTC media through the relay allocated here; `GET /webrtc/ice` advertises how to reach it.
//
// The relay IP must be reachable by BOTH peers — on a dev box that's the LAN IP (auto-detected), which is
// browser-reachable and container-reachable (via Docker's host routing). Override with LIVESTREAK_TURN_*.
import { networkInterfaces } from "node:os";
import Turn from "node-turn";

export interface TurnConfig {
  readonly enabled: boolean;
  readonly port: number;
  readonly username: string;
  readonly credential: string;
  readonly realm: string;
  /** The address TURN relay allocations bind to — must be reachable by every peer (LAN IP on a dev box). */
  readonly relayIp: string;
  readonly minPort: number;
  readonly maxPort: number;
}

/** First non-internal IPv4 — the LAN address both a Mac browser and a Docker container can route to. */
export const detectRelayIp = (): string => {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === "IPv4" && ni.internal === false) return ni.address;
    }
  }
  return "127.0.0.1";
};

export const readTurnConfig = (): TurnConfig => ({
  enabled: process.env.LIVESTREAK_TURN_ENABLED !== "0",
  port: Number(process.env.LIVESTREAK_TURN_PORT ?? 3478),
  username: process.env.LIVESTREAK_TURN_USER ?? "livestreak",
  credential: process.env.LIVESTREAK_TURN_PASS ?? "streampass",
  realm: process.env.LIVESTREAK_TURN_REALM ?? "livestreak",
  relayIp: process.env.LIVESTREAK_TURN_RELAY_IP ?? detectRelayIp(),
  minPort: Number(process.env.LIVESTREAK_TURN_MIN_PORT ?? 49160),
  maxPort: Number(process.env.LIVESTREAK_TURN_MAX_PORT ?? 49200)
});

export interface TurnHandle {
  readonly stop: () => void;
  readonly config: TurnConfig;
}

/** Start the embedded TURN server. Returns null when disabled (LIVESTREAK_TURN_ENABLED=0). */
export const startTurnServer = (config: TurnConfig): TurnHandle | null => {
  if (config.enabled === false) return null;
  const server = new Turn({
    authMech: "long-term",
    credentials: { [config.username]: config.credential },
    realm: config.realm,
    listeningPort: config.port,
    // Bind all interfaces so both a Mac browser (127.0.0.1/LAN) and a Docker container
    // (host.docker.internal) reach it; relay allocations bind the reachable LAN IP.
    listeningIps: ["0.0.0.0"],
    relayIps: [config.relayIp],
    externalIps: config.relayIp,
    minPort: config.minPort,
    maxPort: config.maxPort,
    debugLevel: "ERROR"
  });
  server.start();
  return { stop: () => server.stop(), config };
};

/**
 * The ICE server list to advertise to a client that reached the host at `hostname`. The client points its
 * WebRTC at the SAME host it used for signaling (on the TURN port), so this "just works" for a browser
 * (localhost/LAN) and a container (host.docker.internal) alike — each gets a TURN address it can reach.
 */
export const iceServersForHost = (
  hostname: string,
  config: TurnConfig
): { urls: string; username?: string; credential?: string }[] => [
  { urls: `stun:${hostname}:${config.port}` },
  {
    urls: `turn:${hostname}:${config.port}?transport=udp`,
    username: config.username,
    credential: config.credential
  }
];
