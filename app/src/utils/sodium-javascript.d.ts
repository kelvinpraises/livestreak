declare module 'sodium-javascript' {
  const sodium: { sodium_memzero(buffer: Uint8Array): void }
  export default sodium
}
