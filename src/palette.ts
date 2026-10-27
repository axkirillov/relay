export const macchiato = {
  crust: "#181926",
  mantle: "#1e2030",
  base: "#24273a",
  surface0: "#363a4f",
  surface1: "#494d64",
  surface2: "#5b6078",
  overlay0: "#6e738d",
  overlay1: "#8087a2",
  overlay2: "#939ab7",
  subtext0: "#a5adcb",
  subtext1: "#b8c0e0",
  text: "#cad3f5",
  rosewater: "#f4dbd6",
  pink: "#f5bde6",
  mauve: "#c6a0f6",
  red: "#ed8796",
  peach: "#f5a97f",
  yellow: "#eed49f",
  green: "#a6da95",
  teal: "#8bd5ca",
  sky: "#91d7e3",
  blue: "#8aadf4",
  lavender: "#b7bdf8",
  white: "#ffffff",
} as const;

export type Palette = typeof macchiato;

export const palette: Palette = macchiato;

export function paletteRules(p: Palette = palette): string {
  const names = Object.entries(p).map(([name, hex]) => `--${name}: ${hex};`);
  return `:root { ${names.join(" ")} }`;
}

export function wash(hex: string, percent: 12 | 18 | 35): string {
  return `color-mix(in srgb, ${hex} ${percent}%, transparent)`;
}
