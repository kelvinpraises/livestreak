export const directSinkConfigureScope = "sink:direct:configure" as const;
export const directSinkCloseScope = "sink:direct:close" as const;

export const directSinkConfigureCommand = {
  name: "configure",
  scope: directSinkConfigureScope,
  help: "Set the direct-serve fMP4 sink's viewer door. The stream id is board-derived from the observation's market.",
  resultKind: "state-patch" as const,
  input: {
    type: "object" as const,
    properties: [
      {
        name: "port",
        value: {
          type: "number" as const,
          description: "TCP port viewers dial (UPnP-mapped on the router).",
          default: 48700
        },
        help: "Defaults to 48700."
      },
      {
        name: "maxViewers",
        value: {
          type: "number" as const,
          description: "Direct-viewer cap (bandwidth is the only scarcity).",
          default: 20
        },
        help: "Viewer N+1 is refused with an honest at_capacity signal."
      },
      {
        name: "reachability",
        value: {
          type: "enum" as const,
          description: "Eligibility mode.",
          values: ["require", "lan"],
          default: "require"
        },
        help: "require = UPnP + host echo must verify the public door (the go-live gate); lan = serve on the local network only (dev/demo)."
      }
    ]
  }
};

export const directSinkCloseCommand = {
  name: "close",
  scope: directSinkCloseScope,
  help: "Close direct stream configuration and remove the sink cell.",
  resultKind: "state-patch" as const
};
