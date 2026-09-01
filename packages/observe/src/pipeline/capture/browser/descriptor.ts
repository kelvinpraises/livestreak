import type {
  CaptureDriverDescriptor,
  DescriptorValueSchema,
  RegistryCommandDescriptor,
  RegistryFlagDescriptor
} from "#pipeline/capture/types.js";
import {
  browserCaptureClearCropScope,
  browserCaptureSetCaptureFpsScope,
  browserCaptureSetCropScope
} from "./control/controls.js";
import {
  browserCaptureGetPreviewScope,
  browserCaptureInspectTargetsScope,
  browserCaptureSetTargetScope
} from "./control/preview.js";

const numberValue = (description: string, required = false): DescriptorValueSchema => ({
  type: "number",
  description,
  required
});

const stringValue = (description: string, required = false): DescriptorValueSchema => ({
  type: "string",
  description,
  required
});

const booleanValue = (description: string, required = false): DescriptorValueSchema => ({
  type: "boolean",
  description,
  required
});

const cropValue: DescriptorValueSchema = {
  type: "object",
  description: "Pixel crop rectangle within the active browser viewport.",
  required: true,
  properties: [
    { name: "x", value: numberValue("Left edge in pixels.", true), help: "Crop left edge." },
    { name: "y", value: numberValue("Top edge in pixels.", true), help: "Crop top edge." },
    { name: "width", value: numberValue("Crop width in pixels.", true), help: "Crop width." },
    { name: "height", value: numberValue("Crop height in pixels.", true), help: "Crop height." }
  ]
};

const viewportValue: DescriptorValueSchema = {
  type: "object",
  description: "Browser viewport size.",
  properties: [
    { name: "width", value: numberValue("Viewport width in pixels.", true), help: "Viewport width." },
    { name: "height", value: numberValue("Viewport height in pixels.", true), help: "Viewport height." }
  ]
};

const flag = (
  name: string,
  value: DescriptorValueSchema,
  help: string,
  extras: Omit<RegistryFlagDescriptor, "name" | "value" | "help"> = {}
): RegistryFlagDescriptor => ({
  name,
  value,
  help,
  ...extras
});

const command = (
  name: string,
  scope: RegistryCommandDescriptor["scope"],
  help: string,
  options: {
    readonly input?: DescriptorValueSchema;
    readonly output?: DescriptorValueSchema;
    readonly resultKind?: RegistryCommandDescriptor["resultKind"];
    readonly examples?: readonly string[];
  } = {}
): RegistryCommandDescriptor => ({
  name,
  scope,
  help,
  input: options.input,
  output: options.output,
  resultKind: options.resultKind,
  examples: options.examples
});

const previewTargetRectValue: DescriptorValueSchema = {
  type: "object",
  description: "Target rectangle within the browser viewport.",
  properties: [
    { name: "x", value: numberValue("Left edge in pixels.", true), help: "Target left edge." },
    { name: "y", value: numberValue("Top edge in pixels.", true), help: "Target top edge." },
    { name: "width", value: numberValue("Target width in pixels.", true), help: "Target width." },
    { name: "height", value: numberValue("Target height in pixels.", true), help: "Target height." }
  ]
};

const previewTargetValue: DescriptorValueSchema = {
  type: "object",
  description: "Numbered browser capture target detected in the latest preview.",
  properties: [
    { name: "id", value: stringValue("Stable target id.", true), help: "Target id." },
    { name: "number", value: numberValue("Human-friendly target number.", true), help: "Target number." },
    {
      name: "kind",
      value: {
        type: "enum",
        description: "Detected target kind.",
        values: ["video", "canvas", "iframe", "element"]
      },
      help: "Target kind."
    },
    { name: "label", value: stringValue("Human-readable target label.", true), help: "Target label." },
    { name: "rect", value: previewTargetRectValue, help: "Target rectangle." },
    { name: "confidence", value: numberValue("Optional confidence score."), help: "Target confidence." }
  ]
};

const browserPreviewArtifactOutput: DescriptorValueSchema = {
  type: "object",
  description: "browser.previewTargets artifact payload returned by preview commands.",
  properties: [
    {
      name: "preview",
      value: {
        type: "object",
        description: "Fresh browser preview image and metadata.",
        properties: [
          { name: "revision", value: numberValue("Browser-local preview revision.", true), help: "Preview revision." },
          { name: "capturedAtMs", value: numberValue("Preview capture timestamp.", true), help: "Captured at." },
          {
            name: "mime",
            value: { type: "enum", description: "Preview image mime type.", values: ["image/jpeg", "image/png"] },
            help: "Preview mime."
          },
          { name: "width", value: numberValue("Preview width in pixels.", true), help: "Preview width." },
          { name: "height", value: numberValue("Preview height in pixels.", true), help: "Preview height." },
          { name: "viewport", value: viewportValue, help: "Preview viewport." },
          { name: "dataUri", value: stringValue("Base64 data URI for the preview image.", true), help: "Preview data URI." }
        ]
      },
      help: "Preview payload."
    },
    {
      name: "targets",
      value: {
        type: "array",
        description: "Numbered browser capture targets. Empty for getPreview.",
        items: previewTargetValue
      },
      help: "Detected targets."
    }
  ]
};

const setTargetInput: DescriptorValueSchema = {
  type: "object",
  description: "Select a numbered browser capture target from the latest preview inspection.",
  required: true,
  properties: [
    { name: "targetId", value: stringValue("Target id from inspectTargets.", true), help: "Target id." },
    {
      name: "previewRevision",
      value: numberValue("Preview revision returned by inspectTargets.", true),
      help: "Preview revision."
    }
  ]
};

const setCropInput: DescriptorValueSchema = {
  type: "union",
  description: "Manual crop rectangle or crop with preview revision validation.",
  variants: [
    cropValue,
    {
      type: "object",
      properties: [
        { name: "crop", value: cropValue, help: "Manual crop rectangle." },
        {
          name: "previewRevision",
          value: numberValue("Preview revision returned by inspectTargets.", true),
          help: "Preview revision."
        }
      ]
    }
  ]
};

const setCaptureFpsInput: DescriptorValueSchema = {
  type: "union",
  description: "Capture FPS as a number or wrapped object.",
  variants: [
    numberValue("Capture frames per second.", true),
    {
      type: "object",
      properties: [
        {
          name: "captureFps",
          value: numberValue("Capture frames per second.", true),
          help: "Capture FPS."
        }
      ]
    }
  ]
};

export const browserCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "browser",
  version: "0.1.0",
  displayName: "Browser Capture",
  summary: "Capture frames from a browser page via an injected automation adapter.",
  capabilityScopes: ["capture:browser:*"],
  sourceType: "browser",
  sourceMode: "live",
  flags: [
    flag("url", stringValue("URL to capture from a browser page.", true), "Capture a live web page.", {
      examples: ["--url https://example.com/live"]
    }),
    flag(
      "captureFps",
      numberValue("Monotonic browser capture cadence in frames per second.", true),
      "Capture at a source-owned FPS."
    ),
    flag("viewport", viewportValue, "Set the browser viewport before capture."),
    flag("crop", cropValue, "Crop the captured browser viewport."),
    flag(
      "encoding",
      {
        type: "enum",
        description: "Screenshot encoding format.",
        values: ["jpeg", "png"]
      },
      "Choose jpeg or png screenshot encoding."
    ),
    flag(
      "interactive",
      booleanValue("Allow adapter-specific interactive browser behavior."),
      "Pass interactive mode to the browser adapter."
    ),
    flag("debug", booleanValue("Enable adapter-specific browser diagnostics."), "Enable browser capture diagnostics.")
  ],
  commands: [
    command("getPreview", browserCaptureGetPreviewScope, "Capture a fresh browser preview artifact.", {
      resultKind: "artifact",
      output: browserPreviewArtifactOutput
    }),
    command(
      "inspectTargets",
      browserCaptureInspectTargetsScope,
      "Capture preview and detect numbered browser targets in one artifact.",
      {
        resultKind: "artifact",
        output: browserPreviewArtifactOutput
      }
    ),
    command("setTarget", browserCaptureSetTargetScope, "Apply crop from a numbered browser target.", {
      input: setTargetInput,
      resultKind: "state-patch"
    }),
    command("setCrop", browserCaptureSetCropScope, "Update the browser capture crop rectangle.", {
      input: setCropInput,
      resultKind: "state-patch",
      examples: ["capture:browser:setCrop {\"x\":0,\"y\":0,\"width\":1280,\"height\":720}"]
    }),
    command("clearCrop", browserCaptureClearCropScope, "Clear browser crop and target selection.", {
      resultKind: "state-patch"
    }),
    command("setCaptureFps", browserCaptureSetCaptureFpsScope, "Update the monotonic browser capture cadence.", {
      input: setCaptureFpsInput,
      resultKind: "state-patch",
      examples: ["capture:browser:setCaptureFps 30"]
    })
  ]
};
