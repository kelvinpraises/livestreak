export const liveSinkConfigureScope = "sink:live:configure" as const;
export const liveSinkCloseScope = "sink:live:close" as const;

export const liveSinkConfigureCommand = {
  name: "configure",
  scope: liveSinkConfigureScope,
  help: "Confirm the host fan-out sink. The stream id is board-derived from the observation's market.",
  resultKind: "state-patch" as const
};

export const liveSinkCloseCommand = {
  name: "close",
  scope: liveSinkCloseScope,
  help: "Close live stream configuration and remove the sink cell.",
  resultKind: "state-patch" as const
};
