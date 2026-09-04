import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import type { HostSimilarityResult } from "@livestreak/host";

import type { SimilarityQuery, SimilarityResult } from "../model/similarity.js";
import type { BookmakerSimilarityClient } from "./client.js";
import { hostSimilarityResultToBookmaker, similarityQueryToHostRequest } from "./host-adapter.js";

// --- exports ---

export const DISCOVERY_FIND_PATH = "/discovery/find" as const;

export interface HostDiscoveryClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export const createHostDiscoveryClient = (
  options: HostDiscoveryClientOptions
): BookmakerSimilarityClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  return {
    findSimilar: async (query: SimilarityQuery): Promise<SimilarityResult> => {
      const body = similarityQueryToHostRequest(query);
      const response = await fetchImpl(`${baseUrl}${DISCOVERY_FIND_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (response.ok === false) {
        throw new LiveStreakRuntimeError({
          message: `Host discovery find failed with status ${response.status}`,
          metadata: { details: String(response.status) }
        });
      }

      const payload = (await response.json()) as HostSimilarityResult;
      const mapped = hostSimilarityResultToBookmaker(payload, query.marketId);
      if (mapped.ok === false) {
        throw new LiveStreakConfigError({
          message: mapped.issues.join("; "),
          metadata: { details: mapped.issues.join("; ") }
        });
      }

      return mapped.value;
    }
  };
};
