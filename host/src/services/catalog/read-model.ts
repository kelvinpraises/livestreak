import { Schema } from "effect";
import { Agent as AgentSchema } from "@livestreak/host";
import type { Agent, AgentsData, HomepageData, HostStreamDetail } from "./types.js";
import {
  marketRowToDetail,
  marketRowToSummary,
  resolutionRowToLifetime,
  vaultRowToLiveRaw
} from "./mapper.js";
import type { CatalogRepository } from "../../infrastructure/database/repository.js";

// The discovery READ-MODEL: turns the materialized DB projection into the exact
// `@livestreak/host` page shapes — ONE shape per page, zero composition on the app side.
// Reads only; the cron owns all writes.

export interface CatalogReadModelConfig {
  readonly repo: CatalogRepository;
  readonly now?: () => number;
  // Agents have no on-chain enumerator in this read-model (they belong to the options
  // board bridge — see reply). Seedable via LIVESTREAK_AGENTS_JSON so /agents is non-empty
  // on the demo stack; defaults to [].
  readonly agents?: readonly Agent[];
}

export interface CatalogReadModel {
  homepage(): Promise<HomepageData>;
  agents(): Promise<AgentsData>;
  stream(routeId: string): Promise<HostStreamDetail | null>;
}

export const parseAgentsSeed = (raw: string | undefined): readonly Agent[] => {
  if (raw === undefined || raw.trim().length === 0) return [];
  try {
    return Schema.decodeUnknownSync(Schema.Array(AgentSchema))(JSON.parse(raw));
  } catch (error) {
    console.warn(`[catalog]: ignoring LIVESTREAK_AGENTS_JSON — ${String(error)}`);
    return [];
  }
};

export const createCatalogReadModel = (
  config: CatalogReadModelConfig
): CatalogReadModel => {
  const now = config.now ?? (() => Date.now());
  const agents = config.agents ?? [];

  const homepage = async (): Promise<HomepageData> => {
    const nowMs = now();
    const [markets, live, lifetime, protocolStats] = await Promise.all([
      config.repo.allMarkets(),
      config.repo.liveVaults(),
      config.repo.lifetimeVaults(),
      config.repo.protocolStats()
    ]);
    return {
      streams: markets.map((m) => marketRowToSummary(m, nowMs)),
      liveVaults: live.map((r) => vaultRowToLiveRaw(r.vault, r.streamTitle, nowMs)),
      lifetimeVaults: lifetime.map((r) =>
        resolutionRowToLifetime(r.resolution, r.question, r.streamTitle, nowMs)
      ),
      protocolStats
    };
  };

  const stream = async (routeId: string): Promise<HostStreamDetail | null> => {
    const row = await config.repo.marketByRoute(routeId);
    return row === undefined ? null : marketRowToDetail(row);
  };

  return {
    homepage,
    agents: async () => ({ agents }),
    stream
  };
};
