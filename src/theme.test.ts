import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import { colourNames, macchiato } from "./palette.ts";
import { page } from "./page.ts";
import { ensureDefaultTheme, loadTheme } from "./theme.ts";

const home = mkdtempSync(join(tmpdir(), "relay-theme-"));
process.env.RELAY_QUEUE_DIR = join(home, "queue");
const themes = join(home, "themes");
const config = join(home, "config.json");

function themeFile(name: string, text: string) {
  mkdirSync(themes, { recursive: true });
  writeFileSync(join(themes, `${name}.yaml`), text);
}

function chooses(name: unknown) {
  writeFileSync(config, JSON.stringify({ theme: name }));
}

const none = loadTheme();
assert.deepEqual(none.palette, macchiato);
assert.equal(none.warning, null);

ensureDefaultTheme();
const shipped = join(themes, "macchiato.yaml");
const written = parse(readFileSync(shipped, "utf8"));
assert.equal(written.name, "macchiato");
assert.deepEqual(Object.keys(written), ["name", ...colourNames]);
for (const name of colourNames) assert.equal(written[name], macchiato[name]);
assert.equal(written.white, undefined);
assert.ok(readFileSync(shipped, "utf8").includes('base: "#24273a"'));

writeFileSync(shipped, "name: mine\n");
ensureDefaultTheme();
assert.equal(readFileSync(shipped, "utf8"), "name: mine\n");

writeFileSync(config, "{}");
assert.equal(loadTheme().warning, null);

chooses("macchiato");
assert.deepEqual(loadTheme(), { palette: macchiato, warning: null });

themeFile("mocha", 'name: Mocha\ncrust: "#11111b"\nbase: "#1E1E2E"\n');
chooses("mocha");
const mocha = loadTheme();
assert.equal(mocha.warning, null);
assert.equal(mocha.palette.crust, "#11111b");
assert.equal(mocha.palette.base, "#1e1e2e");
assert.equal(mocha.palette.text, macchiato.text);
assert.equal(mocha.palette.white, "#ffffff");

themeFile("empty", "");
chooses("empty");
assert.deepEqual(loadTheme(), { palette: macchiato, warning: null });

const fallsBack = (warning: string) => {
  const theme = loadTheme();
  assert.deepEqual(theme.palette, macchiato);
  assert.equal(theme.warning, warning);
};

chooses("latte");
fallsBack("theme latte not found — using macchiato");

chooses("../config");
fallsBack("theme ../config not found — using macchiato");

themeFile("broken", "crust: [unclosed\n");
chooses("broken");
fallsBack("theme broken is not valid yaml — using macchiato");

themeFile("list", "- crust\n");
chooses("list");
fallsBack("theme list is not a list of colours — using macchiato");

themeFile("odd", 'crust: "#181926"\nwhite: "#000000"\n');
chooses("odd");
fallsBack("theme odd has unknown colour white — using macchiato");

themeFile("short", 'crust: "#fff"\n');
chooses("short");
fallsBack("theme short: crust is not #rrggbb — using macchiato");

themeFile("named", "crust: red\n");
chooses("named");
fallsBack("theme named: crust is not #rrggbb — using macchiato");

chooses(7);
fallsBack("config.json is not valid — using macchiato");

writeFileSync(config, "{ nope");
fallsBack("config.json is not valid — using macchiato");

writeFileSync(config, "[]");
fallsBack("config.json is not valid — using macchiato");

writeFileSync(config, "{}");
assert.equal(loadTheme().warning, null);

chooses("mocha");
const themed = page("/x/doc.md");
assert.ok(themed.includes("<style>:root { --rosewater: #f4dbd6;"));
assert.ok(themed.includes("--crust: #11111b;"));
assert.ok(!themed.includes('id="theme-warning"'));

chooses("latte");
const warned = page("/x/doc.md", true, true);
assert.ok(warned.includes('<span id="theme-warning" class="warning" role="status">theme latte not found — using macchiato</span>'));
assert.ok(warned.includes("--crust: #181926;"));
const footer = warned.match(/<footer>([\s\S]*?)<\/footer>/)![1]!;
assert.ok(footer.includes('id="theme-warning"'));

chooses('<b>"x"');
assert.ok(page("/x/doc.md").includes("theme &lt;b&gt;&quot;x&quot; not found"));

rmSync(home, { recursive: true });
console.log("ok");
