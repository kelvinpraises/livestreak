import { describe, expect, it } from "vitest";
import { mapStreamState } from "../src/chains/evm/decode.js";
import { mapStorageScheme as solana } from "../src/chains/solana/decode.js";
import { mapStorageScheme as sui } from "../src/chains/sui/decode.js";
describe("Host storage pointer parity",()=>{
 it("decodes slot 4 identically on every chain and rejects unknown slots",()=>{
  expect(mapStreamState({status:2,scheme:4,id:"a".repeat(64),updatedAt:2n,endedAt:1n})).toMatchObject({status:"ended",scheme:"host",endedAtMs:1000});
  expect(solana(4)).toBe("host");expect(sui(4)).toBe("host");expect(()=>solana(5)).toThrow();expect(()=>sui(5)).toThrow();
 });
});
