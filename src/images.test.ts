import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentType, imageRefs, localImages } from "./images.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${g}\n     want ${w}`);
}

// --- which srcs are ours to serve ---------------------------------------------
check("refs: a markdown image", imageRefs("![shot](/tmp/a.png)\n"), ["/tmp/a.png"]);
check("refs: relative", imageRefs("![shot](shots/a.png)\n"), ["shots/a.png"]);
check("refs: no alt text", imageRefs("![](/tmp/a.png)\n"), ["/tmp/a.png"]);
check("refs: a title is not part of the path", imageRefs(`![a](/tmp/a.png "hi")\n`), ["/tmp/a.png"]);
check("refs: angle-bracketed", imageRefs("![a](</tmp/a.png>)\n"), ["/tmp/a.png"]);
check("refs: angle-bracketed with a space", imageRefs("![a](</tmp/a b.png>)\n"), ["/tmp/a b.png"]);
check("refs: a bare space still ends the path", imageRefs("![a](/tmp/a b.png)\n"), ["/tmp/a"]);
check("refs: unclosed angle bracket is taken as written", imageRefs("![a](</tmp/a.png)\n"), ["</tmp/a.png"]);
check("refs: empty angle brackets", imageRefs("![a](<>)\n"), []);
check("refs: raw img, double quotes", imageRefs(`<img src="/tmp/a.png" alt="a">`), ["/tmp/a.png"]);
check("refs: raw img, single quotes", imageRefs("<img src='/tmp/a.png'>"), ["/tmp/a.png"]);
check("refs: raw img, unquoted", imageRefs("<img src=/tmp/a.png>"), ["/tmp/a.png"]);
check("refs: raw img, src after other attrs", imageRefs(`<img alt="a" width=20 src="/tmp/a.png">`), [
  "/tmp/a.png",
]);
check("refs: both spellings at once", imageRefs(`![a](/tmp/a.png)\n\n<img src="/tmp/b.png">`), [
  "/tmp/a.png",
  "/tmp/b.png",
]);
check("refs: the same path twice is one ref", imageRefs("![a](/tmp/a.png)\n![b](/tmp/a.png)\n"), [
  "/tmp/a.png",
]);

check("refs: https is not ours", imageRefs("![a](https://example.com/a.png)\n"), []);
check("refs: data is not ours", imageRefs("![a](data:image/png;base64,iVB)\n"), []);
check("refs: protocol-relative is not ours", imageRefs("![a](//example.com/a.png)\n"), []);
check("refs: a fragment is not a file", imageRefs("![a](#anchor)\n"), []);
check("refs: empty src", imageRefs("![a]()\n"), []);
check("refs: a link is not an image", imageRefs("[a](/tmp/a.png)\n"), []);
check("refs: prose", imageRefs("# hi\n\nnothing here\n"), []);

// --- content types -----------------------------------------------------------
check("type: png", contentType("/tmp/a.png"), "image/png");
check("type: JPG is jpeg", contentType("/tmp/a.JPG"), "image/jpeg");
check("type: svg", contentType("/tmp/a.svg"), "image/svg+xml");
check("type: unknown", contentType("/tmp/a.wat"), "application/octet-stream");
check("type: no extension", contentType("/tmp/a"), "application/octet-stream");

// --- the allow-list ----------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "relay-images-"));
const doc = join(dir, "note.md");
mkdirSync(join(dir, "shots"));
writeFileSync(join(dir, "shots", "a.png"), "not really a png");
writeFileSync(join(dir, "with space.png"), "nor this");
writeFileSync(join(dir, "real.png"), "nor this");
symlinkSync(join(dir, "real.png"), join(dir, "link.png"));

{
  const got = await localImages(doc, "![a](shots/a.png)\n");
  check("list: relative to the document", got.map, { "shots/a.png": "/local/0" });
  check("list: resolved path", got.files, [join(dir, "shots", "a.png")]);
}

{
  const got = await localImages(doc, "![a](shots/a.png)\n![b](shots/gone.png)\n");
  check("list: a file that is not there is not served", got.map, { "shots/a.png": "/local/0" });
  check("list: and takes no slot", got.files.length, 1);
}

{
  const got = await localImages(doc, "![a](with%20space.png)\n");
  check("list: percent-encoded space", got.map, { "with%20space.png": "/local/0" });
  check("list: decoded to the real file", got.files, [join(dir, "with space.png")]);
}

{
  const got = await localImages(doc, "![a](%ZZ.png)\n");
  check("list: undecodable is just not a file", got.map, {});
}

{
  const got = await localImages(doc, "![a](link.png)\n");
  check("list: a symlink to a file counts", got.files, [join(dir, "link.png")]);
}

{
  const got = await localImages(doc, "![a](shots)\n");
  check("list: a directory is not a file", got.map, {});
}

{
  const got = await localImages(doc, "![a](/etc/passwd)\n![b](https://example.com/a.png)\n");
  check("list: absolute paths are served only because the document named one", got.map, {
    "/etc/passwd": "/local/0",
  });
}

{
  const got = await localImages(doc, `![a](real.png)\n\n<img src="shots/a.png">\n`);
  check("list: numbered in the order they appear", got.map, {
    "real.png": "/local/0",
    "shots/a.png": "/local/1",
  });
}

rmSync(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
