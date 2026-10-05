// Explicit named export for WDK's signing-key cleanup; sodium-javascript
// builds its CommonJS exports dynamically, which Vite cannot statically infer.
import sodium from 'sodium-javascript'
export default sodium
export const sodium_memzero = sodium.sodium_memzero
