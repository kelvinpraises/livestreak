import { LiveStreakConfigError } from "@livestreak/core";
import { Effect } from "effect";
import type { ControlSurface, ControlFunctionEntry } from "./types.js";

export interface SurfaceFunctionMatch {
  readonly surface: ControlSurface;
  readonly entry: ControlFunctionEntry;
}

export const buildSurfaceFunctionIndex = (
  surfaces: readonly ControlSurface[]
): Effect.Effect<ReadonlyMap<string, SurfaceFunctionMatch>, LiveStreakConfigError> => {
  const index = new Map<string, SurfaceFunctionMatch>();

  for (const surface of surfaces) {
    for (const entry of surface.functions) {
      const existing = index.get(entry.scope);
      if (existing !== undefined) {
        return Effect.fail(
          new LiveStreakConfigError({
            message: `Duplicate live surface function scope ${entry.scope}`,
            metadata: {
              cause: {
                firstCell: existing.surface.cell.id,
                secondCell: surface.cell.id
              }
            }
          })
        );
      }

      index.set(entry.scope, { surface, entry });
    }
  }

  return Effect.succeed(index);
};

export const findSurfaceFunctionByScope = (
  index: ReadonlyMap<string, SurfaceFunctionMatch>,
  scope: string
): Effect.Effect<SurfaceFunctionMatch, LiveStreakConfigError> => {
  const match = index.get(scope);
  if (match === undefined) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `No live surface advertises function scope ${scope}`
      })
    );
  }

  return Effect.succeed(match);
};

export const mountSurfaceRegistry = (
  surfaces: readonly ControlSurface[],
  surface: ControlSurface
): Effect.Effect<readonly ControlSurface[], LiveStreakConfigError> => {
  const cellId = surface.cell.id;
  const existingIndex = surfaces.findIndex((entry) => entry.cell.id === cellId);
  const nextSurfaces =
    existingIndex === -1
      ? [...surfaces, surface]
      : surfaces.map((entry, index) => (index === existingIndex ? surface : entry));

  return Effect.gen(function* () {
    yield* buildSurfaceFunctionIndex(nextSurfaces);
    return nextSurfaces;
  });
};
