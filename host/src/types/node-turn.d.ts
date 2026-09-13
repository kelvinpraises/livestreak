// Minimal ambient types for `node-turn` (pure-JS STUN/TURN server; ships no types).
declare module "node-turn" {
  interface TurnOptions {
    authMech?: "long-term" | "none";
    credentials?: Record<string, string>;
    realm?: string;
    listeningPort?: number;
    listeningIps?: string[];
    relayIps?: string[];
    externalIps?: string | string[];
    minPort?: number;
    maxPort?: number;
    debugLevel?: "OFF" | "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE" | "ALL";
    software?: string;
  }
  export default class Turn {
    constructor(options?: TurnOptions);
    start(): void;
    stop(): void;
    addUser(username: string, password: string): void;
    removeUser(username: string): void;
  }
}
