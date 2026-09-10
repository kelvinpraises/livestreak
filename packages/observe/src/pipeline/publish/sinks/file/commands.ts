export const fileSinkConfigureScope = "sink:file-export:configure" as const;
export const fileSinkCloseScope = "sink:file-export:close" as const;

export const fileSinkConfigureCommand = {
  name: "configure",
  scope: fileSinkConfigureScope,
  help: "Set the MP4 output path for file export.",
  resultKind: "state-patch" as const,
  input: {
    type: "object" as const,
    properties: [
      {
        name: "path",
        value: { type: "string" as const, description: "Output MP4 path.", required: true },
        help: "Must not already exist."
      }
    ]
  }
};

export const fileSinkCloseCommand = {
  name: "close",
  scope: fileSinkCloseScope,
  help: "Close file export configuration and remove the sink cell.",
  resultKind: "state-patch" as const
};
