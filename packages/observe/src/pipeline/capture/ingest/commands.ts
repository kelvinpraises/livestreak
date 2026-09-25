export const ingestCaptureConfigureScope = "capture:ingest:configure" as const;
export const ingestCaptureCloseScope = "capture:ingest:close" as const;

export const ingestCaptureConfigureCommand = {
  name: "configure",
  scope: ingestCaptureConfigureScope,
  help: "Set the bot-pushed frame contract for ingest capture (dimensions + fps required, endpoint optional).",
  resultKind: "state-patch" as const,
  input: {
    type: "object" as const,
    properties: [
      {
        name: "width",
        value: {
          type: "number" as const,
          description: "Frame width in pixels the bot sends.",
          required: true
        },
        help: "Positive integer; must match the posted bytes."
      },
      {
        name: "height",
        value: {
          type: "number" as const,
          description: "Frame height in pixels the bot sends.",
          required: true
        },
        help: "Positive integer; must match the posted bytes."
      },
      {
        name: "fps",
        value: {
          type: "number" as const,
          description: "Expected frames per second.",
          required: true
        },
        help: "Positive number."
      },
      {
        name: "port",
        value: {
          type: "number" as const,
          description: "Loopback TCP port the bot POSTs frames to.",
          default: 48710
        },
        help: "Defaults to 48710."
      },
      {
        name: "path",
        value: {
          type: "string" as const,
          description: "Ingest path the bot POSTs frames to.",
          default: "/frames"
        },
        help: "Defaults to /frames."
      }
    ]
  }
};

export const ingestCaptureCloseCommand = {
  name: "close",
  scope: ingestCaptureCloseScope,
  help: "Close ingest capture configuration and remove the capture cell.",
  resultKind: "state-patch" as const
};
