export const localSinkConfigureScope = "sink:local:configure" as const;
export const localSinkCloseScope = "sink:local:close" as const;

export const localSinkConfigureCommand = {
  name: "configure",
  scope: localSinkConfigureScope,
  help: "Bind the local WebRTC preview sink to a stream id.",
  resultKind: "state-patch" as const,
  input: {
    type: "object" as const,
    properties: [
      {
        name: "streamId",
        value: { type: "string" as const, description: "Stream/market id.", required: true },
        help: "Scopes the feed end-to-end."
      },
      {
        name: "channelLabel",
        value: { type: "string" as const, description: "WebRTC data channel label." },
        help: "Optional; defaults to livestreak-video:<streamId>."
      }
    ]
  }
};

export const localSinkCloseCommand = {
  name: "close",
  scope: localSinkCloseScope,
  help: "Close local preview configuration and remove the sink cell.",
  resultKind: "state-patch" as const
};
