import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "./helpers/database.js";
import { createMandateStore } from "../src/features/content/mandates.js";
import { fixtureMandate } from "../../packages/schema/test/helpers/mandate.js";
const dirs:string[]=[];
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
it("durably preserves canonical judging terms across restart and rejects corruption",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"livestreak-mandates-"));dirs.push(dir);const file=join(dir,"state.db");
 let db=createTestDatabase(file);let store=createMandateStore(db.db);const mandate=fixtureMandate();
 const first=await store.put(mandate);expect(await store.put(mandate)).toEqual(first);await db.close();
 db=createTestDatabase(file);store=createMandateStore(db.db);
 try {
  expect(await store.get(first.commitment)).toEqual(mandate);
  const changed=await store.put({...mandate,question:"Different question"});expect(changed.commitment).not.toBe(first.commitment);
  expect(await store.get(first.commitment)).toEqual(mandate);
  db.sqlite.prepare("UPDATE vault_mandates SET body=? WHERE digest=?").run(Buffer.from("{}"),first.commitment);
  await expect(store.get(first.commitment)).rejects.toThrow("Corrupted");
  await expect(store.put(mandate)).rejects.toThrow("collision");
 } finally {await db.close();}
});
