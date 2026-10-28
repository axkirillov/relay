import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

import { colourNames, macchiato, type Palette } from "./palette.ts";
import { configFile, themesDir } from "./paths.ts";

export type Theme = { palette: Palette; warning: string | null };

const hexColour = /^#[0-9a-fA-F]{6}$/;
const fallbackName = "macchiato";

export function ensureDefaultTheme(): void {
  const colours = Object.fromEntries(colourNames.map((name) => [name, macchiato[name]]));
  try {
    mkdirSync(themesDir(), { recursive: true });
    writeFileSync(join(themesDir(), `${fallbackName}.yaml`), stringify({ name: fallbackName, ...colours }, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }), { flag: "wx" });
  } catch {}
}

export function loadTheme(): Theme {
  const chosen = chosenName();
  if (typeof chosen !== "string") return fallback("config.json is not valid");
  if (chosen === fallbackName) return { palette: macchiato, warning: null };
  return readTheme(chosen);
}

function chosenName(): string | null {
  let text: string;
  try {
    text = readFileSync(configFile(), "utf8");
  } catch {
    return fallbackName;
  }
  try {
    const config: unknown = JSON.parse(text);
    if (typeof config !== "object" || config === null || Array.isArray(config)) return null;
    const name = (config as Record<string, unknown>).theme;
    if (name === undefined) return fallbackName;
    return typeof name === "string" && name !== "" ? name : null;
  } catch {
    return null;
  }
}

function readTheme(name: string): Theme {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) return fallback(`theme ${name} not found`);
  let text: string;
  try {
    text = readFileSync(join(themesDir(), `${name}.yaml`), "utf8");
  } catch {
    return fallback(`theme ${name} not found`);
  }
  let file: unknown;
  try {
    file = parse(text) ?? {};
  } catch {
    return fallback(`theme ${name} is not valid yaml`);
  }
  if (typeof file !== "object" || file === null || Array.isArray(file)) return fallback(`theme ${name} is not a list of colours`);
  const colours: Record<string, string> = {};
  for (const [key, value] of Object.entries(file)) {
    if (key === "name") continue;
    if (!(colourNames as readonly string[]).includes(key)) return fallback(`theme ${name} has unknown colour ${key}`);
    if (typeof value !== "string" || !hexColour.test(value)) return fallback(`theme ${name}: ${key} is not #rrggbb`);
    colours[key] = value.toLowerCase();
  }
  return { palette: { ...macchiato, ...colours }, warning: null };
}

function fallback(reason: string): Theme {
  return { palette: macchiato, warning: `${reason} — using ${fallbackName}` };
}
