// Reachability ladder for the direct sink: can viewers dial this broadcaster on IPv4?
//   1. UPnP/NAT-PMP mapping (deterministic knowable door)
//   2. STUN-observed mapping (cone-NAT one-sided punch — needs the QUIC stack to share the
//      socket; recorded as "punch" grade so goLive can gate until that lane lands)
// The final word is the injected verifier — the host's signaling echo dials the advertised
// address from OUTSIDE and reports the truth. Eligibility: only a verified broadcaster goes live.

import {
  addPortMapping,
  discoverGatewayLocation,
  externalIp,
  resolveGateway,
  type UpnpGateway
} from "./upnp.js";
import { DEFAULT_STUN_SERVERS, queryStunMapping, type StunMapping } from "./stun.js";

export type ReachabilityGrade = "upnp" | "punch" | "unreachable";

export interface ReachabilityResult {
  readonly grade: ReachabilityGrade;
  /** Publicly dialable address when grade !== "unreachable". */
  readonly publicIp?: string;
  readonly publicPort?: number;
  /** Verified from outside by the injected echo (host signaling). */
  readonly verified: boolean;
  readonly detail: string;
  /** Cleanup for whatever the ladder opened (port mapping lease, keepalive socket). */
  readonly close: () => Promise<void>;
}

export interface ProbeInput {
  readonly port: number;
  /** Which door to open: TCP for the v1 WS serve lane, UDP for the QUIC lane. Defaults to UDP. */
  readonly protocol?: "UDP" | "TCP";
  /** Dial the address from OUTSIDE (host echo endpoint); resolves true when reachable. */
  readonly verify?: (publicIp: string, publicPort: number) => Promise<boolean>;
  readonly stunServers?: readonly { readonly host: string; readonly port: number }[];
  readonly mappingDescription?: string;
}

const UPNP_LEASE_SECONDS = 7_200;

export const probeReachability = async (input: ProbeInput): Promise<ReachabilityResult> => {
  const noop = async (): Promise<void> => {};
  const protocol = input.protocol ?? "UDP";

  // --- rung 1: UPnP mapping ---
  try {
    const location = await discoverGatewayLocation();
    const gateway = await resolveGateway(location);
    const mapping = {
      gateway,
      externalPort: input.port,
      internalPort: input.port,
      protocol,
      description: input.mappingDescription ?? "livestreak-direct",
      ttlSeconds: UPNP_LEASE_SECONDS
    };
    await addPortMapping(mapping);
    // Renew at half-lease so a stream longer than the lease never loses its public door
    // (AddPortMapping with identical parameters refreshes the lease in place).
    const renew = setInterval(() => {
      void addPortMapping(mapping).catch(() => {});
    }, (UPNP_LEASE_SECONDS / 2) * 1_000);
    renew.unref?.();
    const ip = await externalIp(gateway);
    const verified = input.verify === undefined ? false : await failFalse(input.verify(ip, input.port));
    return {
      grade: "upnp",
      publicIp: ip,
      publicPort: input.port,
      verified,
      detail: `UPnP mapping ${ip}:${input.port} (${protocol.toLowerCase()})`,
      close: () => {
        clearInterval(renew);
        return releaseMapping(gateway, input.port, protocol);
      }
    };
  } catch {
    // fall through to STUN observation
  }

  // --- rung 2: STUN observation (cone-NAT punch candidate; a UDP-only concept) ---
  const stun = protocol === "UDP" ? await observeStunMapping(input) : undefined;
  if (stun !== undefined) {
    const verified =
      input.verify === undefined
        ? false
        : await failFalse(input.verify(stun.mapping.ip, stun.mapping.port));
    return {
      grade: "punch",
      publicIp: stun.mapping.ip,
      publicPort: stun.mapping.port,
      verified,
      detail: `STUN mapping ${stun.mapping.ip}:${stun.mapping.port} (cone-NAT candidate)`,
      close: stun.close
    };
  }

  return {
    grade: "unreachable",
    verified: false,
    detail:
      protocol === "UDP"
        ? "No UPnP gateway and no STUN mapping — CGNAT/symmetric NAT or UDP blocked"
        : "No UPnP gateway answered — enable UPnP on the router or serve from a reachable box",
    close: noop
  };
};

// --- helpers ---

const failFalse = (work: Promise<boolean>): Promise<boolean> => work.catch(() => false);

const releaseMapping = async (
  gateway: UpnpGateway,
  port: number,
  protocol: "UDP" | "TCP"
): Promise<void> => {
  const { deletePortMapping } = await import("./upnp.js");
  await deletePortMapping(gateway, port, protocol).catch(() => {});
};

const observeStunMapping = async (
  input: ProbeInput
): Promise<{ readonly mapping: StunMapping; readonly close: () => Promise<void> } | undefined> => {
  // Lazy node:dgram keeps the observe barrel browser-safe (same posture as upnp.ts / the ffmpeg adapter).
  const { createSocket } = (await import(/* @vite-ignore */ "node:dgram")) as typeof import("node:dgram");
  const socket = createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(input.port, () => resolve());
  }).catch(() => undefined);

  for (const server of input.stunServers ?? DEFAULT_STUN_SERVERS) {
    try {
      const mapping = await queryStunMapping({ socket, server });
      // Keepalive holds the mapping open (typical UDP NAT timeout ~30-120s).
      const timer = setInterval(() => {
        void queryStunMapping({ socket, server }).catch(() => {});
      }, 25_000);
      timer.unref?.();
      return {
        mapping,
        close: async () => {
          clearInterval(timer);
          socket.close();
        }
      };
    } catch {
      // try the next server
    }
  }
  socket.close();
  return undefined;
};
