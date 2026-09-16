export const liveSinkConfigureScope = "sink:live:configure" as const;
export const liveSinkCloseScope = "sink:live:close" as const;

export const liveSinkConfigureCommand = {
  name: "configure",
  scope: liveSinkConfigureScope,
  help: "Bind the live fMP4 stream sink to a stream id.",
  resultKind: "state-patch" as const,
  input: {
    type: "object" as const,
    properties: [
      {
        name: "streamId",
        value: { type: "string" as const, description: "Stream/market id.", required: true },
        help: "Scopes the live feed end-to-end (the host ring buffer + viewer key)."
      }
    ]
  }
};

export const liveSinkCloseCommand = {
  name: "close",
  scope: liveSinkCloseScope,
  help: "Close live stream configuration and remove the sink cell.",
  resultKind: "state-patch" as const
};
