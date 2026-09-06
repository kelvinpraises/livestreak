// Pairing password + verifier for the Remote Bridge Console (leg-A admission).
//
// The operator shares a PAIRING password out-of-band with the remote user; it is SEPARATE from the
// keystore password (which unlocks the seed). The gateway derives a scrypt VERIFIER and sends only
// that to the host on `register` — the host verifies `/remote/:session/join` against it and never
// sees the plaintext. The verifier shape MUST match the host's `makePasswordVerifier`
// (`scrypt$<saltHex>$<hashHex>`, 16-byte salt, 32-byte hash) so host(verify) and gateway(derive) agree.

import { randomBytes, scryptSync } from "node:crypto";

export const makePasswordVerifier = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
};

// A short, human-shareable pairing password when the operator does not supply one.
export const generatePairingPassword = (): string => randomBytes(6).toString("base64url");
