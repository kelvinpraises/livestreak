import { describe, expect, it } from "vitest";
import * as Public from "../src/index.js";

const publicExport = (name: string): unknown => (Public as Record<string, unknown>)[name];

describe("steward package boundaries", () => {
  it("does not export market creation APIs", () => {
    expect(publicExport("createMarket")).toBeUndefined();
    expect(publicExport("registerMarket")).toBeUndefined();
  });

  it("does not export vault creation APIs", () => {
    expect(publicExport("createVault")).toBeUndefined();
    expect(publicExport("joinVault")).toBeUndefined();
  });

  it("does not export forum storage or runtime loop APIs", () => {
    expect(publicExport("storeForumThread")).toBeUndefined();
    expect(publicExport("appendForumMessage")).toBeUndefined();
    expect(publicExport("startStewardRuntime")).toBeUndefined();
    expect(publicExport("runTeeEnclave")).toBeUndefined();
  });

  it("does not export user funding or bookmaker strategy APIs", () => {
    expect(publicExport("streamFunds")).toBeUndefined();
    expect(publicExport("createBookmakerStrategy")).toBeUndefined();
  });
});
