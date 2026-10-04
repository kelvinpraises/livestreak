/** Late RPC results are ignored; only a completed read may replace the projection. */
export const readWithDeadline = async <T>(
  read: Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Catalog read timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
