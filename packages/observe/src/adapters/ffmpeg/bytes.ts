// --- exports ---

export const copyBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  const output: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output;
};

export const concatBytes = (chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output: Uint8Array<ArrayBuffer> = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
};

export const bytesToUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
