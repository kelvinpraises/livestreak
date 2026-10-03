import { expect, it, vi } from "vitest";
import {
  createResolutionController,
  type ResolutionAttempt,
} from "../../src/runtime/resolution/controller.js";
import { fixtureEvidence } from "../../../schema/test/helpers/resolution.js";
import { fixtureMandate } from "../../../schema/test/helpers/mandate.js";
import {
  canonicalMandateBytes,
  mandateCommitment,
  resolutionDigest,
} from "@livestreak/schema";
const setup = async () => {
  const mandate = fixtureMandate();
  const commitment = await mandateCommitment(canonicalMandateBytes(mandate));
  let attempt: ResolutionAttempt | null = null;
  let outcome: "pending" | "yes" | "no" = "pending";
  const readState = vi.fn(async () => ({
    outcome,
    disputed: false,
    chainTime: 2000000050,
  }));
  const execute = vi.fn(
    async (
      _vault: string,
      side: "yes" | "no",
      submitted: (hash: string) => Promise<void>,
    ) => {
      await submitted("tx-one");
      outcome = side;
      return "tx-one";
    },
  );
  const ports = {
    stewardId: "independent",
    readMandate: async () => ({
      mandate,
      terms: {
        chainId: mandate.chainId,
        marketId: mandate.marketId,
        vaultId: "vault-1",
        question: mandate.question,
        commitment,
        fundingClose: mandate.fundingClose,
      },
    }),
    readState,
    publish: vi.fn(resolutionDigest),
    load: async () => attempt,
    save: async (a: ResolutionAttempt) => {
      attempt = a;
    },
    execute,
  };
  return {
    ports,
    get: () => attempt,
    setOutcome: (s: typeof outcome) => {
      outcome = s;
    },
    input: {
      vaultId: "vault-1",
      outcome: "yes",
      reason: "Official score 3 exceeds 2",
      evidence: [await fixtureEvidence()],
    },
  };
};
it("publishes first, captures hash before receipt and verifies chain outcome", async () => {
  const s = await setup(),
    c = createResolutionController(s.ports);
  expect((await c.submit(s.input)).status).toBe("confirmed");
  expect(s.ports.publish.mock.invocationCallOrder[0]).toBeLessThan(
    s.ports.execute.mock.invocationCallOrder[0]!,
  );
  expect(s.get()?.txId).toBe("tx-one");
  await c.submit(s.input);
  expect(s.ports.execute).toHaveBeenCalledTimes(1);
  await expect(c.submit({ ...s.input, outcome: "no" })).rejects.toThrow("overwrite");
});
it("quarantines a dropped send, then recovers without resubmitting", async () => {
  const s = await setup();
  s.ports.execute.mockImplementationOnce(async (_v, side, submitted) => {
    await submitted("tx-lost");
    s.setOutcome(side);
    throw Error("Lost response");
  });
  const c = createResolutionController(s.ports);
  await expect(c.submit(s.input)).rejects.toThrow("Lost");
  expect(s.get()?.status).toBe("unknown");
  expect((await c.recover("vault-1")).status).toBe("confirmed");
  expect(s.ports.execute).toHaveBeenCalledTimes(1);
});
it("records attention without signing for dispute or missing evidence", async () => {
  const s = await setup();
  s.ports.readState.mockResolvedValue({
    outcome: "pending",
    disputed: true,
    chainTime: 2000000050,
  });
  expect((await createResolutionController(s.ports).submit(s.input)).status).toBe(
    "attention",
  );
  expect(s.ports.execute).not.toHaveBeenCalled();
});
it("rechecks eligibility after publication and never retries an unidentifiable send", async () => {
  const s = await setup();
  s.ports.readState
    .mockResolvedValueOnce({ outcome: "pending", disputed: false, chainTime: 2000000050 })
    .mockResolvedValue({ outcome: "pending", disputed: false, chainTime: 2000000101 });
  await expect(createResolutionController(s.ports).submit(s.input)).rejects.toThrow(
    "Eligibility changed",
  );
  expect(s.ports.execute).not.toHaveBeenCalled();
  const n = await setup();
  n.ports.execute.mockRejectedValue(Error("send lost"));
  const c = createResolutionController(n.ports);
  await expect(c.submit(n.input)).rejects.toThrow("send lost");
  await expect(c.submit(n.input)).rejects.toThrow("pending/unknown");
  expect(n.ports.execute).toHaveBeenCalledTimes(1);
});
it("rejects a changed mandate commitment between evidence publication and signing", async () => {
  const s = await setup();
  const original = await s.ports.readMandate();
  const readMandate = vi
    .fn()
    .mockResolvedValueOnce(original)
    .mockResolvedValue({
      ...original,
      terms: { ...original.terms, commitment: `0x${"ff".repeat(32)}` },
    });
  await expect(
    createResolutionController({ ...s.ports, readMandate }).submit(s.input),
  ).rejects.toThrow("Eligibility changed");
  expect(s.ports.publish).toHaveBeenCalledTimes(1);
  expect(s.ports.execute).not.toHaveBeenCalled();
  expect(s.get()?.status).toBe("prepared");
});
