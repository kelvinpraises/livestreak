export const fileCaptureConfigureScope = "capture:file:configure" as const;
export const fileCaptureCloseScope = "capture:file:close" as const;

export const fileCaptureConfigureCommand = {
  name: "configure",
  scope: fileCaptureConfigureScope,
  help: "Set the media file path for file capture.",
  resultKind: "state-patch" as const,
  input: {
    type: "object" as const,
    properties: [
      {
        name: "path",
        value: { type: "string" as const, description: "Path to the media file.", required: true },
        help: "Local file to replay frames from."
      }
    ]
  }
};

export const fileCaptureCloseCommand = {
  name: "close",
  scope: fileCaptureCloseScope,
  help: "Close file capture configuration and remove the capture cell.",
  resultKind: "state-patch" as const
};
