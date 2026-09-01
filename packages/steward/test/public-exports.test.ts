import { describe, expect, it } from "vitest";
import type { AnnotationPayload, AppendMessagePayload, OpenThreadPayload } from "../src/index.js";
import * as Public from "../src/index.js";

type PayloadTypeExports = [OpenThreadPayload, AppendMessagePayload, AnnotationPayload];

const publicExport = (name: string): unknown => (Public as Record<string, unknown>)[name];
const _payloadTypes: PayloadTypeExports | undefined = undefined;

describe("steward public exports", () => {
  it("exports model validators", () => {
    expect(publicExport("validateStewardSubject")).toBeTypeOf("function");
    expect(publicExport("validateStewardFact")).toBeTypeOf("function");
    expect(publicExport("validateStewardFinding")).toBeTypeOf("function");
    expect(publicExport("validateStewardDecision")).toBeTypeOf("function");
    expect(publicExport("validateStewardActionPlan")).toBeTypeOf("function");
  });

  it("exports pure workflow functions", () => {
    expect(publicExport("evaluateStewardRules")).toBeTypeOf("function");
    expect(publicExport("chooseStewardDecisions")).toBeTypeOf("function");
    expect(publicExport("planStewardActions")).toBeTypeOf("function");
    expect(publicExport("projectStewardPanel")).toBeTypeOf("function");
  });

  it("exports runtime factory and config without test fakes", () => {
    expect(publicExport("createStewardRuntime")).toBeTypeOf("function");
    expect(publicExport("validateStewardRuntimeConfig")).toBeTypeOf("function");
    expect(publicExport("makeFakeContractFactSource")).toBeUndefined();
    expect(publicExport("makeFakeHostFactSource")).toBeUndefined();
    expect(publicExport("makeFakeObserveFactSource")).toBeUndefined();
    expect(publicExport("makeRecordingActionPlanSink")).toBeUndefined();
  });

  it("exports TEE metadata guard without execution helpers", () => {
    expect(publicExport("isTeeAttestationRef")).toBeTypeOf("function");
    expect(publicExport("runTeeAttestation")).toBeUndefined();
    expect(publicExport("verifyEnclaveQuote")).toBeUndefined();
  });

  it("exports steward-of-stewards action constants", () => {
    expect(publicExport("STEWARD_OF_STEWARDS_ACTIONS")).toEqual([
      "proposePenalty",
      "vetoSteward",
      "challengeStewardDecision"
    ]);
  });

  it("exports typed host action payload types at compile time", () => {
    expect(_payloadTypes).toBeUndefined();
  });
});
