import { join } from "node:path";

import { relayHome } from "@axkirillov/relay-contract/paths";

export function themesDir(): string {
  return join(relayHome(), "themes");
}

export function configFile(): string {
  return join(relayHome(), "config.json");
}
