// --- exports ---

export const WAD = 1_000_000_000_000_000_000n;

export const BASE_PRICE = 100_000n;
export const CURVE_K = 10_000_000_000n;
export const SHARE_SCALE = 1_000_000n;

export const priceOf = (pool: bigint): bigint =>
  BASE_PRICE + (BASE_PRICE * pool) / CURVE_K;

export const sharesPerUsdc = (pool: bigint): bigint => {
  const price = priceOf(pool);
  if (price === 0n) {
    return 0n;
  }

  return SHARE_SCALE / price;
};

export type BoardSegmentInput = {
  readonly pool: bigint;
  readonly sideRate: bigint;
  readonly dtSeconds: number;
};

export type BoardSegmentResult = {
  readonly newPool: bigint;
  readonly dG: number;
};

export const segMath = (input: BoardSegmentInput): BoardSegmentResult => {
  const { pool, sideRate, dtSeconds } = input;
  if (dtSeconds <= 0 || sideRate === 0n) {
    return { newPool: pool, dG: 0 };
  }

  const newPool = pool + sideRate * BigInt(dtSeconds);
  const p0 = Number(priceOf(pool));
  const p1 = Number(priceOf(newPool));

  if (p1 <= p0) {
    return { newPool, dG: 0 };
  }

  const lnv = Math.log(p1 / p0);
  const dG =
    (Number(SHARE_SCALE) * Number(CURVE_K) * lnv) / (Number(BASE_PRICE) * Number(sideRate));

  return { newPool, dG };
};

export type ProjectSharesInput = {
  readonly board: {
    readonly pool: bigint;
    readonly sideRate: bigint;
    readonly g: bigint;
    readonly lastAdvanceMs: number;
  };
  readonly position: {
    readonly rate: bigint;
    readonly gPaid: bigint;
    readonly maxEndMs?: number;
    readonly depleted: boolean;
  };
  readonly atMs: number;
  readonly resolvedAtMs?: number;
};

export const projectShares = (input: ProjectSharesInput): bigint => {
  const { board, position, atMs, resolvedAtMs } = input;

  if (position.depleted) {
    return 0n;
  }

  const freezeMs = Math.min(
    atMs,
    position.maxEndMs ?? atMs,
    resolvedAtMs ?? atMs
  );

  if (freezeMs <= board.lastAdvanceMs || board.sideRate === 0n || position.rate === 0n) {
    return sharesFromG(position.rate, board.g, position.gPaid);
  }

  const dtSeconds = Math.floor((freezeMs - board.lastAdvanceMs) / 1000);
  const { dG } = segMath({ pool: board.pool, sideRate: board.sideRate, dtSeconds });
  const gNow = board.g + BigInt(Math.floor(dG));

  return sharesFromG(position.rate, gNow, position.gPaid);
};

// --- helpers ---

const sharesFromG = (rate: bigint, g: bigint, gPaid: bigint): bigint =>
  (rate * (g - gPaid)) / WAD;
