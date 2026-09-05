import type { HostRouteDeps } from "../../deps.js";
import { handleDescriptor, handleHealth } from "../../services/descriptor.js";

// --- exports ---

export const createDescriptorController = (deps: HostRouteDeps) => ({
  health: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
    res.status(200).json(handleHealth({ config: deps.config }));
  },

  descriptor: (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void => {
    res.status(200).json(handleDescriptor({ config: deps.config }));
  }
});
