import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk up from `start` to the nearest ancestor holding a package.json — the @livestreak/contracts
 * package root, identical for source (chains/…) and compiled (dist/chains/…) callers. Lets the
 * deployment loaders read the committed SOURCE snapshot regardless of where the module runs from. */
export const packageRootFrom = (start: string): string => {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate @livestreak/contracts package root above ${start}`);
    }
    dir = parent;
  }
};
