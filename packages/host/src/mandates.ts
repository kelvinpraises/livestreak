import { canonicalMandateBytes, mandateCommitment, verifyMandate, type BoundVaultTerms, type VaultMandate } from "@livestreak/schema";
export const createMandateClient = (baseUrl: string, fetcher: typeof fetch = fetch) => {
  const base = baseUrl.replace(/\/$/, "");
  const read = async (commitment: string): Promise<unknown> => {
    if (!/^0x[0-9a-f]{64}$/.test(commitment)) throw new Error("Invalid mandate commitment");
    const r = await fetcher(`${base}/content/mandates/${commitment}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("Vault mandate unavailable — funding disabled");
    if (!r.body) throw new Error("Empty mandate response");
    const reader = r.body.getReader();const chunks: Uint8Array[] = [];let size=0;
    try {
      while (true) {
        const part=await reader.read();if(part.done) break;
        size+=part.value.byteLength;if(size>32768) { await reader.cancel();throw new Error("Mandate response too large"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  };
  return {
    async publish(input: unknown): Promise<string> {
      const bytes = canonicalMandateBytes(input);const commitment = await mandateCommitment(bytes);
      const r = await fetcher(`${base}/content/mandates`, {method:"POST",headers:{"content-type":"application/json"},body:new TextDecoder().decode(bytes),signal:AbortSignal.timeout(10000)});
      if (!r.ok) throw new Error("Mandate publication failed");
      if (await mandateCommitment(canonicalMandateBytes(await read(commitment))) !== commitment) throw new Error("Published mandate readback mismatch");return commitment;
    },
    async readVerified(terms: BoundVaultTerms): Promise<VaultMandate> { return verifyMandate(await read(terms.commitment), terms); }
  };
};
