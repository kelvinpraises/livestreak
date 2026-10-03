import { describe, expect, it } from "vitest";
import { canonicalMandateBytes, mandateCommitment } from "@livestreak/schema";
import { createMandateClient } from "../src/mandates.js";
import { fixtureMandate } from "../../schema/test/helpers/mandate.js";
describe("independent mandate client",()=>{
 it("publishes only canonical bytes and reads back the committed body",async()=>{
  const mandate=fixtureMandate();const hash=await mandateCommitment(canonicalMandateBytes(mandate));let writes=0;
  const client=createMandateClient("http://host",async(url,init)=>{
   if(init?.method==="POST"){writes++;expect(String(init.body)).toBe(new TextDecoder().decode(canonicalMandateBytes(mandate)));return Response.json({commitment:hash},{status:201});}
   expect(String(url)).toContain(hash);return Response.json(mandate);
  });
  expect(await client.publish(mandate)).toBe(hash);expect(writes).toBe(1);
  expect(await client.readVerified({...mandate,vaultId:"v",commitment:hash})).toEqual(mandate);
 });
 it("rejects a Host returning different bytes or missing body",async()=>{
  const mandate=fixtureMandate();const hash=await mandateCommitment(canonicalMandateBytes(mandate));const terms={...mandate,vaultId:"v",commitment:hash};
  const changed=createMandateClient("http://host",async()=>Response.json({...mandate,noMeaning:"changed"}));
  await expect(changed.readVerified(terms)).rejects.toThrow("mismatch");
  const missing=createMandateClient("http://host",async()=>new Response("missing",{status:404}));
  await expect(missing.readVerified(terms)).rejects.toThrow("unavailable");
 });
 it("rejects malformed publication before any network call",async()=>{
  let calls=0;const client=createMandateClient("http://host",async()=>{calls++;throw Error("unexpected");});
  await expect(client.publish({question:"not enough"})).rejects.toThrow();expect(calls).toBe(0);
 });
});
