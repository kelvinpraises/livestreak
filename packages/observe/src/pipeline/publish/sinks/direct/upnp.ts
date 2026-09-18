// Minimal UPnP IGD port-mapping client (SSDP discover → device description → AddPortMapping).
// Zero dependencies. The deterministic "knowable door" for the direct sink: ask the home router
// to map external UDP port P to this machine so viewers can dial the broadcaster directly.

// Node modules load lazily so the observe barrel stays browser-safe (same posture as the ffmpeg adapter).
const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

const dgram = (): Promise<typeof import("node:dgram")> =>
  importNode("node:dgram") as Promise<typeof import("node:dgram")>;

export interface UpnpGateway {
  readonly controlUrl: string;
  readonly serviceType: string;
  readonly localIp: string;
}

export interface UpnpMappingInput {
  readonly gateway: UpnpGateway;
  readonly externalPort: number;
  readonly internalPort: number;
  readonly protocol: "UDP" | "TCP";
  readonly description: string;
  readonly ttlSeconds?: number;
}

const SSDP_ADDR = "239.255.255.250";
const SSDP_PORT = 1900;
const IGD_SERVICES = [
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANIPConnection:2",
  "urn:schemas-upnp-org:service:WANPPPConnection:1"
];

export const localIpv4 = async (): Promise<string | undefined> => {
  const { networkInterfaces } = (await importNode("node:os")) as typeof import("node:os");
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return undefined;
};

/** SSDP M-SEARCH for an internet gateway; resolves the first IGD's description URL. */
export const discoverGatewayLocation = async (timeoutMs = 3_000): Promise<string> => {
  const { createSocket } = await dgram();
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const search = [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1",
      "",
      ""
    ].join("\r\n");

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("UPnP SSDP discovery timed out (no gateway answered)"));
    }, timeoutMs);

    socket.on("message", (message) => {
      const location = /^location:\s*(.+)$/im.exec(message.toString())?.[1]?.trim();
      if (location !== undefined) {
        clearTimeout(timer);
        socket.close();
        resolve(location);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.close();
      reject(error);
    });
    socket.send(search, SSDP_PORT, SSDP_ADDR);
  });
};

/** Fetch the device description and locate the WAN connection service control URL. */
export const resolveGateway = async (locationUrl: string): Promise<UpnpGateway> => {
  const response = await fetch(locationUrl);
  if (!response.ok) {
    throw new Error(`UPnP device description fetch failed (${response.status})`);
  }
  const xml = await response.text();

  for (const serviceType of IGD_SERVICES) {
    const serviceBlock = new RegExp(
      `<service>(?:(?!</service>)[\\s\\S])*?${serviceType.replace(/[:.]/g, "\\$&")}[\\s\\S]*?</service>`,
      "i"
    ).exec(xml)?.[0];
    const controlPath = serviceBlock === undefined
      ? undefined
      : /<controlURL>([^<]+)<\/controlURL>/i.exec(serviceBlock)?.[1]?.trim();
    if (controlPath !== undefined) {
      const base = new URL(locationUrl);
      const controlUrl = new URL(controlPath, base).toString();
      const localIp = await localIpv4();
      if (localIp === undefined) {
        throw new Error("No non-internal IPv4 interface found");
      }
      return { controlUrl, serviceType, localIp };
    }
  }
  throw new Error("Gateway exposes no WAN connection service (UPnP disabled?)");
};

const soapEnvelope = (serviceType: string, action: string, args: string): string =>
  `<?xml version="1.0"?>` +
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
  `<s:Body><u:${action} xmlns:u="${serviceType}">${args}</u:${action}></s:Body></s:Envelope>`;

const soapCall = async (
  gateway: UpnpGateway,
  action: string,
  args: string
): Promise<string> => {
  const response = await fetch(gateway.controlUrl, {
    method: "POST",
    headers: {
      "content-type": 'text/xml; charset="utf-8"',
      soapaction: `"${gateway.serviceType}#${action}"`
    },
    body: soapEnvelope(gateway.serviceType, action, args)
  });
  const body = await response.text();
  if (!response.ok) {
    const code = /<errorCode>(\d+)<\/errorCode>/.exec(body)?.[1];
    throw new Error(`UPnP ${action} failed (${response.status}${code === undefined ? "" : `, code ${code}`})`);
  }
  return body;
};

export const addPortMapping = async (input: UpnpMappingInput): Promise<void> => {
  const ttl = input.ttlSeconds ?? 7_200;
  await soapCall(
    input.gateway,
    "AddPortMapping",
    `<NewRemoteHost></NewRemoteHost>` +
      `<NewExternalPort>${input.externalPort}</NewExternalPort>` +
      `<NewProtocol>${input.protocol}</NewProtocol>` +
      `<NewInternalPort>${input.internalPort}</NewInternalPort>` +
      `<NewInternalClient>${input.gateway.localIp}</NewInternalClient>` +
      `<NewEnabled>1</NewEnabled>` +
      `<NewPortMappingDescription>${input.description}</NewPortMappingDescription>` +
      `<NewLeaseDuration>${ttl}</NewLeaseDuration>`
  );
};

export const deletePortMapping = async (
  gateway: UpnpGateway,
  externalPort: number,
  protocol: "UDP" | "TCP"
): Promise<void> => {
  await soapCall(
    gateway,
    "DeletePortMapping",
    `<NewRemoteHost></NewRemoteHost>` +
      `<NewExternalPort>${externalPort}</NewExternalPort>` +
      `<NewProtocol>${protocol}</NewProtocol>`
  );
};

export const externalIp = async (gateway: UpnpGateway): Promise<string> => {
  const body = await soapCall(gateway, "GetExternalIPAddress", "");
  const ip = /<NewExternalIPAddress>([^<]+)<\/NewExternalIPAddress>/.exec(body)?.[1];
  if (ip === undefined || ip.length === 0) {
    throw new Error("Gateway returned no external IP");
  }
  return ip;
};
