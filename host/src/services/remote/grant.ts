import {
  createCapabilityGrant,
  capabilityGrantSigningBytes,
  grantIsExpired,
  scopeMatchesGrant,
  type CapabilityGrant,
  type CapabilityScope
} from "@livestreak/schema";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as edSign,
  verify as edVerify,
  type KeyObject
} from "node:crypto";

// --- Remote Bridge Console: host-signed, relay-verifiable capability grants (P4) ---
//
// The host mints a CapabilityGrant on admission and signs it over the CANONICAL
// `capabilityGrantSigningBytes` (from @livestreak/schema) with a DEDICATED Ed25519
// host grant key. This key is NEVER the paymaster/executor signer — grants and
// chain-tx sponsorship use entirely separate keys (scope-host B.4 / GATES). The
// relay verifies `grant.sig` against the same key on every relayed UI call; it
// can authorize, but it can never sign a chain transaction.

export interface HostGrantSignerOptions {
  /** Optional 32-byte Ed25519 seed (hex, with/without 0x) so the key is stable across restarts. */
  readonly privateKeyHex?: string | null;
  /** Identifier advertised in `grant.hostKeyId` (key rotation / multi-host). */
  readonly keyId?: string;
}

export interface HostGrantSigner {
  readonly keyId: string;
  /** Raw Ed25519 public key (hex) so legs/tests can independently verify a grant. */
  readonly publicKeyHex: string;
  /** Mint + sign a scoped, expiring grant for a remote (non-trusted) holder. */
  readonly issueGrant: (input: IssueGrantInput) => CapabilityGrant;
  /** Verify a grant's host signature over the canonical signing bytes. */
  readonly verifyGrant: (grant: CapabilityGrant) => boolean;
}

export interface IssueGrantInput {
  readonly sessionId: string;
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly expiresAt: number;
  readonly id?: string;
}

const ED25519_RAW_PRIVATE_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const stripHex = (value: string): string => (value.startsWith("0x") ? value.slice(2) : value);

const privateKeyFromSeedHex = (hex: string): KeyObject => {
  const raw = Buffer.from(stripHex(hex), "hex");
  if (raw.length !== 32) {
    throw new Error("remote grant key must be a 32-byte Ed25519 seed");
  }
  const der = Buffer.concat([ED25519_RAW_PRIVATE_PREFIX, raw]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
};

const rawPublicKeyHex = (publicKey: KeyObject): string => {
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // SPKI Ed25519 = 12-byte prefix + 32-byte raw key.
  return der.subarray(der.length - 32).toString("hex");
};

export const createHostGrantSigner = (
  options: HostGrantSignerOptions = {}
): HostGrantSigner => {
  let privateKey: KeyObject;
  let publicKey: KeyObject;

  if (options.privateKeyHex !== undefined && options.privateKeyHex !== null) {
    privateKey = privateKeyFromSeedHex(options.privateKeyHex);
    publicKey = createPublicKey(privateKey);
  } else {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }

  const keyId = options.keyId ?? "host_grant_dev";
  const publicKeyHex = rawPublicKeyHex(publicKey);

  const issueGrant = (input: IssueGrantInput): CapabilityGrant => {
    const base = createCapabilityGrant({
      id: input.id ?? `grant_${randomUUID()}`,
      sessionId: input.sessionId,
      holder: input.holder,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      revoked: false,
      hostKeyId: keyId
    });
    const sig = Buffer.from(
      edSign(null, Buffer.from(capabilityGrantSigningBytes(base)), privateKey)
    ).toString("hex");
    return { ...base, sig };
  };

  const verifyGrant = (grant: CapabilityGrant): boolean => {
    if (grant.sig === undefined || grant.hostKeyId !== keyId) {
      return false;
    }
    const unsigned: Omit<CapabilityGrant, "sig"> = {
      id: grant.id,
      sessionId: grant.sessionId,
      holder: grant.holder,
      scopes: grant.scopes,
      revoked: grant.revoked,
      ...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
      ...(grant.hostKeyId === undefined ? {} : { hostKeyId: grant.hostKeyId })
    };
    try {
      return edVerify(
        null,
        Buffer.from(capabilityGrantSigningBytes(unsigned)),
        publicKey,
        Buffer.from(stripHex(grant.sig), "hex")
      );
    } catch {
      return false;
    }
  };

  return { keyId, publicKeyHex, issueGrant, verifyGrant };
};

// Authorize a required scope from a verified grant: signature + liveness + scope.
export const grantAuthorizes = (
  signer: HostGrantSigner,
  grant: CapabilityGrant,
  requiredScope: CapabilityScope,
  now = Date.now()
): boolean =>
  signer.verifyGrant(grant) &&
  !grant.revoked &&
  !grantIsExpired(grant.expiresAt, now) &&
  grant.scopes.some((scope) => scopeMatchesGrant(scope, requiredScope));
