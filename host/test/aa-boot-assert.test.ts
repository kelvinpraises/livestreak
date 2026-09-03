import { describe, expect, it } from "vitest";
import { readExecutorAddress } from "#config/aa/boot-assert.js";

describe("aa boot assert", () => {
  it("derives executor address from private key", () => {
    const address = readExecutorAddress(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    );

    expect(address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });
});
