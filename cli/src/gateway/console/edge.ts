import type { BridgeCaller, CallActionEnvelope, FunctionDescriptor } from "@livestreak/schema";

/** One package bridge wired into the merged remote console gateway. */
export type ConsolePackage = "options" | "bookmaker" | "observe" | "steward";

export interface ConsoleEdge {
  readonly package: ConsolePackage;
  describeFunctions(): Promise<readonly FunctionDescriptor[]>;
  dispatch(caller: BridgeCaller, envelope: CallActionEnvelope): Promise<{ readonly txId?: string; readonly tokenId?: string }>;
  subscribeBoard?(listener: (board: unknown) => void): () => void;
  refresh?(): Promise<void>;
  readBoard?(): Promise<unknown>;
}

export const mergeConsoleDescriptors = (
  edges: readonly ConsoleEdge[]
): Promise<readonly FunctionDescriptor[]> =>
  Promise.all(edges.map((edge) => edge.describeFunctions().catch(() => [] as FunctionDescriptor[]))).then(
    (groups) => {
      const seen = new Set<string>();
      const merged: FunctionDescriptor[] = [];
      for (const group of groups) {
        for (const fn of group) {
          if (seen.has(fn.id)) {
            continue;
          }
          seen.add(fn.id);
          merged.push(fn);
        }
      }
      return merged;
    }
  );

export const buildConsoleRoutes = async (
  edges: readonly ConsoleEdge[]
): Promise<ReadonlyMap<string, ConsoleEdge>> => {
  const routes = new Map<string, ConsoleEdge>();
  for (const edge of edges) {
    const fns = await edge.describeFunctions().catch(() => [] as FunctionDescriptor[]);
    for (const fn of fns) {
      routes.set(`${edge.package}:${fn.name}`, edge);
      routes.set(fn.id, edge);
    }
  }
  return routes;
};

export const createMergedDispatch = (
  routes: ReadonlyMap<string, ConsoleEdge>,
  getTargetPackage?: (frame: { readonly target?: string; readonly envelope: CallActionEnvelope }) => ConsolePackage | undefined
): ((caller: BridgeCaller, envelope: CallActionEnvelope, target?: string) => Promise<{ readonly txId?: string; readonly tokenId?: string }>) => {
  return async (caller, envelope, target) => {
    const pkg = target ?? getTargetPackage?.({ envelope, target });
    const key = pkg === undefined ? envelope.action : `${pkg}:${envelope.action}`;
    const edge = routes.get(key) ?? routes.get(envelope.action);
    if (edge === undefined) {
      throw new Error(`No console bridge registered for "${key}"`);
    }
    return edge.dispatch(caller, envelope);
  };
};
