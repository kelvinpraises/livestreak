import { randomBytes, scryptSync } from "node:crypto";

// Gateway-format verifier used to exercise Host authentication.
export const makePasswordVerifier = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
};

