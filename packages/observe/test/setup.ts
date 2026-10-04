// Unit fixtures must never announce synthetic markets to a running demo Host.
// Tests exercising real HTTP servers use their own ephemeral ports.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "8787") {
    return Promise.reject(new Error("Unit test attempted to contact the demo Host; mock fetch or use an isolated test server"));
  }
  return realFetch(input, init);
};
