import { LiveStreakConfigError } from "@livestreak/core";

// --- exports ---

export interface BundlerProxyResult {
  readonly ok: true;
  readonly status: number;
  readonly body: unknown;
}

export interface BundlerProxyError {
  readonly ok: false;
  readonly status: number;
  readonly code: number;
  readonly message: string;
}

export const proxyBundlerRpc = async (
  bundlerUrl: string | undefined,
  requestBody: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<BundlerProxyResult | BundlerProxyError> => {
  if (bundlerUrl === undefined || bundlerUrl.length === 0) {
    return {
      ok: false,
      status: 503,
      code: -32000,
      message: "bundler_not_configured"
    };
  }

  try {
    const response = await fetchImpl(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    const data = await response.json();
    return { ok: true, status: response.status, body: data };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: -32000,
      message: `Bundler unavailable: ${String(error)}`
    };
  }
};

export const bundlerNotConfiguredError = (routeKey: string): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `Bundler not available for chain: ${routeKey}`,
    metadata: { retryable: false }
  });
