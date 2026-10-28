import { colourNames, type Palette } from "../../src/palette.ts";

export function pageColours(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return Object.fromEntries([...colourNames, "white"].map((name) => [name, read(name)])) as Palette;
}
