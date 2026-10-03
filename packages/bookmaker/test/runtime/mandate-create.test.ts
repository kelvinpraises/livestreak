import { describe, expect, it } from "vitest";
import { createVaultOnce } from "../../src/runtime/create-vault-once.js";
import { createIdempotencyStore } from "../../src/runtime/idempotency.js";
import { buildCreateVaultIntent } from "../../src/model/write-intent.js";
import { vaultDraft } from "../helpers/fixtures.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID } from "../helpers/fake-bookmaker-chain.js";
describe("mandate creation preconditions",()=>{
 it("refuses an incomplete question-only intent without sending",async()=>{
  let writes=0;const chain=createFakeBookmakerChain(()=>{writes++;throw Error("unexpected");});
  const intent={...buildCreateVaultIntent(vaultDraft({marketId:FAKE_MARKET_ID})),mandate:undefined,operationId:undefined};
  await expect(createVaultOnce({store:createIdempotencyStore(),chain,intent,nowMs:10000})).rejects.toThrow("Complete mandate");expect(writes).toBe(0);
 });
 it("waits for durable operation preparation and fails before send on persistence error",async()=>{
  let writes=0;const chain=createFakeBookmakerChain(()=>{writes++;throw Error("unexpected");});
  const store=createIdempotencyStore({onPrepareCreation:async()=>{throw Error("disk unavailable");}});
  await expect(createVaultOnce({store,chain,intent:buildCreateVaultIntent(vaultDraft({marketId:FAKE_MARKET_ID})),nowMs:10000})).rejects.toThrow("disk unavailable");expect(writes).toBe(0);
 });
 it("rejects altered question and malformed operation identity",async()=>{
  const original=buildCreateVaultIntent(vaultDraft({marketId:FAKE_MARKET_ID}));const chain=createFakeBookmakerChain();
  for (const change of [{question:"opposite"},{operationId:`0x${"00".repeat(32)}`},{mandate:{...original.mandate!,fundingClose:2000000000000}}])
   await expect(createVaultOnce({store:createIdempotencyStore(),chain,intent:{...original,...change},nowMs:10000})).rejects.toThrow();
 });
});
