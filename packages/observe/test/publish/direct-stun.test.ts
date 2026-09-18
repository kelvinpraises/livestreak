import { describe, expect, it } from "vitest";
import {
  buildBindingRequest,
  parseBindingResponse
} from "#pipeline/publish/sinks/direct/stun.js";

const STUN_MAGIC = 0x2112a442;

// Synthesize a binding success response carrying XOR-MAPPED-ADDRESS for (ip, port).
const makeResponse = (txId: Buffer, ip: string, port: number, xor = true): Buffer => {
  const attrType = xor ? 0x0020 : 0x0001;
  const attr = Buffer.alloc(12);
  attr.writeUInt16BE(attrType, 0);
  attr.writeUInt16BE(8, 2);
  attr.writeUInt8(0x01, 5); // IPv4 family
  const parts = ip.split(".").map(Number);
  let addr = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  let wirePort = port;
  if (xor) {
    wirePort ^= STUN_MAGIC >>> 16;
    addr = (addr ^ STUN_MAGIC) >>> 0;
  }
  attr.writeUInt16BE(wirePort, 6);
  attr.writeUInt32BE(addr, 8);

  const header = Buffer.alloc(20);
  header.writeUInt16BE(0x0101, 0); // binding success
  header.writeUInt16BE(attr.length, 2);
  header.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(header, 8);
  return Buffer.concat([header, attr]);
};

describe("STUN binding codec", () => {
  it("builds a well-formed binding request", () => {
    const { packet, txId } = buildBindingRequest();
    expect(packet.length).toBe(20);
    expect(packet.readUInt16BE(0)).toBe(0x0001);
    expect(packet.readUInt16BE(2)).toBe(0);
    expect(packet.readUInt32BE(4)).toBe(STUN_MAGIC);
    expect(txId.length).toBe(12);
    expect(packet.subarray(8, 20).equals(txId)).toBe(true);
  });

  it("parses XOR-MAPPED-ADDRESS back to the public (ip, port)", () => {
    const { txId } = buildBindingRequest();
    const mapping = parseBindingResponse(makeResponse(txId, "84.12.9.3", 41822), txId);
    expect(mapping).toEqual({ ip: "84.12.9.3", port: 41822 });
  });

  it("parses plain MAPPED-ADDRESS too", () => {
    const { txId } = buildBindingRequest();
    const mapping = parseBindingResponse(makeResponse(txId, "10.1.2.3", 5000, false), txId);
    expect(mapping).toEqual({ ip: "10.1.2.3", port: 5000 });
  });

  it("rejects a response with a foreign transaction id", () => {
    const { txId } = buildBindingRequest();
    const other = buildBindingRequest().txId;
    expect(parseBindingResponse(makeResponse(other, "84.12.9.3", 41822), txId)).toBeUndefined();
  });

  it("rejects truncated and non-success messages", () => {
    const { txId } = buildBindingRequest();
    expect(parseBindingResponse(Buffer.alloc(4), txId)).toBeUndefined();
    const errorResponse = makeResponse(txId, "84.12.9.3", 41822);
    errorResponse.writeUInt16BE(0x0111, 0); // binding error class
    expect(parseBindingResponse(errorResponse, txId)).toBeUndefined();
  });
});
