// Minimal STUN client (RFC 5389 binding request → XOR-MAPPED-ADDRESS). Zero dependencies.
// Used by the direct sink's reachability probe: learn the router's public (ip, port) mapping
// for a UDP socket and keep it alive. IPv4-first.

import type { Socket } from "node:dgram";

export interface StunMapping {
  readonly ip: string;
  readonly port: number;
}

const STUN_MAGIC = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const ATTR_MAPPED_ADDRESS = 0x0001;

export const buildBindingRequest = (): { readonly packet: Buffer; readonly txId: Buffer } => {
  // globalThis.crypto keeps this module import-free (the observe barrel stays browser-safe).
  const txId = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(12)));
  const packet = Buffer.alloc(20);
  packet.writeUInt16BE(BINDING_REQUEST, 0);
  packet.writeUInt16BE(0, 2); // no attributes
  packet.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(packet, 8);
  return { packet, txId };
};

export const parseBindingResponse = (message: Buffer, txId: Buffer): StunMapping | undefined => {
  if (message.length < 20) {
    return undefined;
  }
  if (message.readUInt16BE(0) !== BINDING_SUCCESS) {
    return undefined;
  }
  if (message.readUInt32BE(4) !== STUN_MAGIC) {
    return undefined;
  }
  if (!message.subarray(8, 20).equals(txId)) {
    return undefined;
  }

  const attrsLength = message.readUInt16BE(2);
  let offset = 20;
  const end = Math.min(20 + attrsLength, message.length);
  while (offset + 4 <= end) {
    const type = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    const valueStart = offset + 4;
    if (valueStart + length > message.length) {
      return undefined;
    }
    if ((type === ATTR_XOR_MAPPED_ADDRESS || type === ATTR_MAPPED_ADDRESS) && length >= 8) {
      const family = message.readUInt8(valueStart + 1);
      if (family === 0x01) {
        // IPv4
        let port = message.readUInt16BE(valueStart + 2);
        let addr = message.readUInt32BE(valueStart + 4);
        if (type === ATTR_XOR_MAPPED_ADDRESS) {
          port ^= STUN_MAGIC >>> 16;
          addr = (addr ^ STUN_MAGIC) >>> 0;
        }
        const ip = [addr >>> 24, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff].join(".");
        return { ip, port };
      }
    }
    // attributes are padded to 4 bytes
    offset = valueStart + length + ((4 - (length % 4)) % 4);
  }
  return undefined;
};

export interface StunQueryInput {
  readonly socket: Socket;
  readonly server: { readonly host: string; readonly port: number };
  readonly timeoutMs?: number;
}

/** One binding round-trip on an EXISTING socket (the mapping is per-socket — that's the point). */
export const queryStunMapping = (input: StunQueryInput): Promise<StunMapping> =>
  new Promise((resolve, reject) => {
    const { packet, txId } = buildBindingRequest();
    const timeoutMs = input.timeoutMs ?? 3_000;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`STUN query to ${input.server.host}:${input.server.port} timed out`));
    }, timeoutMs);

    const onMessage = (message: Buffer): void => {
      const mapping = parseBindingResponse(message, txId);
      if (mapping !== undefined) {
        cleanup();
        resolve(mapping);
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      input.socket.off("message", onMessage);
    };

    input.socket.on("message", onMessage);
    input.socket.send(packet, input.server.port, input.server.host, (error) => {
      if (error !== null) {
        cleanup();
        reject(error);
      }
    });
  });

export const DEFAULT_STUN_SERVERS: readonly { readonly host: string; readonly port: number }[] = [
  { host: "stun.l.google.com", port: 19302 },
  { host: "stun.cloudflare.com", port: 3478 }
];
