import { nitkatiGroupAdapter } from "./nitkatiGroup";
import type { DiscoveryAdapter } from "./types";

export const adapterRegistry: Record<string, DiscoveryAdapter> = {
  [nitkatiGroupAdapter.sourceName]: nitkatiGroupAdapter,
};
