import assert from "node:assert/strict";

import { pngName } from "./diagrammenu.ts";

assert.equal(pngName(new Date(2026, 9, 28, 9, 5, 7)), "diagram-20261028-090507.png");
assert.notEqual(pngName(new Date(2026, 9, 28, 9, 5, 7)), pngName(new Date(2026, 9, 28, 9, 5, 8)));
console.log("ok   a saved diagram is named for the second it was saved");
