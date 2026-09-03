import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

// Structural, so the tree types need not be a direct dependency: these are the
// only parts of a syntax node used here.
type SyntaxNode = {
  name: string;
  from: number;
  to: number;
  parent: SyntaxNode | null;
  firstChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
};

/** A stretch of the document that can stand as rendered HTML instead of source. */
export type Block = { from: number; to: number; html: string; kind: Kind };
type Kind = "html" | "table" | "image";

/**
 * Where to fetch each local image from, keyed by the src as the document spells
 * it. The server builds this from the document and serves nothing that is not in
 * it; this side only ever looks a src up.
 */
export type Images = Record<string, string>;

/** A src that names a file on this machine rather than somewhere to fetch from. */
export function localSrc(src: string): boolean {
  const s = src.trim();
  return s !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith("//") && !s.startsWith("#");
}

// Nothing here loads code or steals the caret. <details>, <svg> and <table> are
// the point of the feature and stay.
const banned = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "base",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "audio",
  "video",
]);

export function bannedTag(tag: string): boolean {
  return banned.has(tag.toLowerCase());
}

export function bannedAttr(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("on")) return true;
  if (n === "srcdoc") return true;
  if (n === "href" || n === "src" || n === "xlink:href" || n === "action" || n === "formaction") {
    return /^\s*(javascript:|vbscript:|data:text\/html)/i.test(value);
  }
  return false;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

// Tags the browser closes for you, so leaving one open says nothing about
// whether the block is finished.
const loose = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
  "li", "p", "td", "th", "tr", "thead", "tbody", "tfoot", "dt", "dd",
  "option", "optgroup", "colgroup", "rp", "rt",
]);

/**
 * How many tags a chunk of HTML leaves open. Negative if it closes tags it
 * never opened — a trailing `</div>` on its own.
 */
export function tagBalance(html: string): number {
  let depth = 0;
  const tag = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][-a-zA-Z0-9:]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    const name = m[2]?.toLowerCase();
    if (!name || loose.has(name)) continue;
    if (m[1]) depth--;
    else if (!/\/\s*$/.test(m[3] ?? "")) depth++;
  }
  return depth;
}

/**
 * Every renderable stretch of the document, in order and non-overlapping.
 *
 * Markdown ends an HTML block at a blank line, so HTML written with blank lines
 * in it for readability arrives in pieces — a lone `<div>`, then whatever is
 * between, then a lone `</div>`. Rendered separately those are three pieces of
 * rubbish, so a block that leaves tags open is welded forward to the block that
 * closes them, swallowing what lies between. Anything still unbalanced after
 * that is left as source: half a tag renders as an empty box, which is worse
 * than the text it was written as.
 */
export function blocks(state: EditorState): Block[] {
  const found: Block[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "HTMLBlock") {
        found.push({
          from: node.from,
          to: node.to,
          html: state.doc.sliceString(node.from, node.to),
          kind: "html",
        });
        return false;
      }
      if (node.name === "Table") {
        found.push({
          from: node.from,
          to: node.to,
          html: tableHtml(state, node.node),
          kind: "table",
        });
        return false;
      }
      if (node.name === "Paragraph") {
        const p = htmlParagraph(state, node.node);
        if (!p) return undefined;
        found.push(p);
        return false;
      }
      if (node.name === "Image") {
        const img = standaloneImage(state, node.node);
        if (img) found.push(img);
        return false;
      }
      return undefined;
    },
  });

  return weld(state, found);
}

function weld(state: EditorState, found: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of found) {
    const last = out[out.length - 1];
    if (last && block.from < last.to) continue; // nested; the outer one won
    if (last && last.kind === "html" && block.kind === "html" && tagBalance(last.html) > 0) {
      last.to = block.to;
      last.html = state.doc.sliceString(last.from, block.to);
      continue;
    }
    out.push({ ...block });
  }
  return out.filter((b) => b.kind !== "html" || tagBalance(b.html) === 0);
}

/**
 * A paragraph that is nothing but HTML.
 *
 * Markdown only opens an HTML block for the tags it knows, and `svg` is not one
 * of them, so an SVG written on a single line arrives as an ordinary paragraph.
 * One that starts and ends with a tag and closes everything it opens is HTML
 * whatever the parser called it; anything with prose at either end is left
 * alone, on the same reasoning as an image inside a sentence.
 */
function htmlParagraph(state: EditorState, node: SyntaxNode): Block | null {
  if (node.firstChild?.name !== "HTMLTag") return null;
  const text = state.doc.sliceString(node.from, node.to).trim();
  if (!text.startsWith("<") || !text.endsWith(">") || tagBalance(text) !== 0) return null;
  return { from: node.from, to: node.to, html: text, kind: "html" };
}

/**
 * An image on a line of its own becomes a real image. One inside a sentence
 * stays as source — replacing it would reflow the words around it.
 */
function standaloneImage(state: EditorState, node: SyntaxNode): Block | null {
  const parent = node.parent;
  if (!parent || parent.name !== "Paragraph") return null;
  const text = state.doc.sliceString(node.from, node.to);
  if (state.doc.sliceString(parent.from, parent.to).trim() !== text.trim()) return null;

  // Angle brackets are markdown's way of wrapping a path rather than part of
  // one, and the only way it can spell a path with a space in it. The server
  // reads the document by the same rule, so a src ends up the same string on
  // both sides and the lookup can hit.
  const m = /^!\[([^\]]*)\]\(\s*(?:<([^<>]*)>|([^)\s]*))/.exec(text);
  if (!m) return null;
  const [, alt = "", bracketed, bare] = m;
  const src = bracketed ?? bare ?? "";
  const html = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  return { from: node.from, to: node.to, html, kind: "image" };
}

function tableHtml(state: EditorState, table: SyntaxNode): string {
  let head = "";
  const body: string[] = [];

  for (let row = table.firstChild; row; row = row.nextSibling) {
    if (row.name === "TableDelimiter") continue;
    const cells: string[] = [];
    for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
      if (cell.name === "TableCell") {
        cells.push(escapeHtml(state.doc.sliceString(cell.from, cell.to).trim()));
      }
    }
    if (!cells.length) continue;
    if (row.name === "TableHeader" && !head) {
      head = `<tr>${cells.map((c) => `<th>${c}</th>`).join("")}</tr>`;
    } else {
      body.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`);
    }
  }

  return `<table>${head ? `<thead>${head}</thead>` : ""}<tbody>${body.join("")}</tbody></table>`;
}

/**
 * Parse and strip in a document of its own, so nothing runs on the way in.
 * `DOMParser` does not execute scripts, and what is left after this has no
 * handlers and no code to run. Images are the one thing allowed off the
 * machine, and only ever as pictures — the content policy permits no other
 * kind of request.
 *
 * Local images are also settled here, rather than where each kind of block is
 * built, because there are two ways to write one — a markdown image and a raw
 * `<img>` in an HTML block — and by this point they are the same element.
 */
function sanitize(html: string, images: Images): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  for (const el of [...parsed.body.querySelectorAll("*")]) {
    if (bannedTag(el.tagName)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (bannedAttr(attr.name, attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === "IMG") resolveLocal(el, images, parsed);
  }

  const frag = document.createDocumentFragment();
  while (parsed.body.firstChild) frag.appendChild(parsed.body.firstChild);
  return frag;
}

/**
 * A path on disk is not something this window can fetch, so it becomes the
 * address the server gave that file. A local src with no address behind it is a
 * file that was not there when the document was served — say that, because a
 * broken-image icon does not distinguish it from a picture that failed to
 * decode.
 */
function resolveLocal(el: Element, images: Images, doc: Document) {
  const src = el.getAttribute("src") ?? "";
  if (!localSrc(src)) return;

  const served = images[src.trim()];
  if (served) return el.setAttribute("src", served);

  const note = doc.createElement("span");
  note.className = "cm-relay-blocked";
  note.textContent = `image not found — ${src}`;
  el.replaceWith(note);
}

class Rendered extends WidgetType {
  // A plain field, not a parameter property: node's type stripping runs this
  // file for the tests and does not support them.
  html: string;
  images: Images;
  constructor(html: string, images: Images) {
    super();
    this.html = html;
    this.images = images;
  }
  // The map is fixed for the life of the window, so the html alone says whether
  // two widgets would draw the same thing.
  eq(other: Rendered) {
    return other.html === this.html;
  }
  // Two elements, and the nesting is load-bearing. CodeMirror measures a block
  // widget with getBoundingClientRect, which excludes margins, so a margin out
  // here would be height it never knows about and every block would push the
  // text a little further down than its own line number. The outer element
  // therefore spaces with padding, and the box that can be seen is inside it.
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-relay-render";
    const box = el.appendChild(document.createElement("div"));
    box.className = "cm-relay-box";
    box.appendChild(sanitize(this.html, this.images));
    // An image off the network arrives after the block has been measured, and
    // arriving is what gives it its height. Nothing tells the editor that on
    // its own, so every line below would keep the spacing of a block that was
    // empty when it was measured — the numbers drifting again, by however tall
    // the picture turned out to be.
    for (const img of box.querySelectorAll("img")) {
      if (img.complete) continue;
      const measure = () => view.requestMeasure();
      img.addEventListener("load", measure, { once: true });
      img.addEventListener("error", measure, { once: true });
    }
    return el;
  }
  // Everything that happens inside the box is the page's, not the editor's.
  // Returning true is what keeps CodeMirror out of it, and it buys three things
  // at once: the click never becomes a caret, so the box is not swapped back for
  // its source; the selection a drag leaves behind is left alone rather than read
  // back as a selection in the document; and ⌘C is the browser's own copy of
  // what is highlighted, rather than CodeMirror answering with the line the
  // caret happens to be on somewhere else entirely. Between them, a drag across
  // a rendered block highlights the rendered words and copies them.
  ignoreEvent() {
    return true;
  }
}

function enclosingBlock(node: EventTarget | null): Element | null {
  return element(node)?.closest(".cm-relay-render") ?? null;
}

function closestAnchor(target: EventTarget | null): Element | null {
  return element(target)?.closest("a") ?? null;
}

function element(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

/**
 * A link inside a rendered block, clicked.
 *
 * Nothing that happens inside a box reaches CodeMirror any more, and nothing
 * else was stopping a click on an anchor doing what such a click does: the
 * window left the document for the address, and what came back was a browser
 * error page with the human's half-written answer nowhere on it. So the click is
 * caught on the editor's own element, outside CodeMirror's routing — that is the
 * one place it still passes — and the address goes where `gx` sends one, to
 * whatever the human opens links with.
 */
export function followRendered(open: (href: string) => void) {
  return ViewPlugin.define((view: EditorView) => {
    const clicked = (event: MouseEvent) => {
      const anchor = closestAnchor(event.target);
      if (!anchor || !enclosingBlock(anchor)) return;
      event.preventDefault();
      // Both halves of a double click are clicks. Both have to be stopped, or
      // the second one takes the window off the document; only the first is
      // worth an address, or the human gets two of whatever opened it.
      if (event.detail > 1) return;
      open(anchor.getAttribute("href") ?? "");
    };
    view.dom.addEventListener("click", clicked);
    return { destroy: () => view.dom.removeEventListener("click", clicked) };
  });
}

/**
 * A word inside a rendered block, double-clicked.
 *
 * A box is a `contenteditable="false"` island inside an editor that is
 * `contenteditable="true"`, and Chrome will not widen a selection to a word in
 * one: the first click leaves a caret exactly where it was aimed, and the second
 * does nothing at all. Measured against a control — the same synthetic double
 * click on ordinary page text picks its word — so it is the island, not the
 * input. No stylesheet moves it either: `-webkit-user-modify: read-only`,
 * `user-select: text`, spelling `contenteditable="false"` on the box, even making
 * the whole editor uneditable, all leave the selection empty.
 *
 * What does work is asking for the widening by hand. The caret the first click
 * left is in the right place, so a word is one step back and one step forward
 * from it.
 *
 * Starting the gesture on a link is the exception. A press on an anchor in such
 * an island leaves no caret at all — Chrome has taken it for dragging the link,
 * and `-webkit-user-drag: none` does not give it back — so there is nothing here
 * to widen, and a drag that begins there selects nothing either. A drag that
 * begins in the prose runs across the link's words perfectly well, which is the
 * gesture that matters; the link is a thing to click.
 */
export function selectWords() {
  return ViewPlugin.define((view: EditorView) => {
    const doubled = (event: MouseEvent) => {
      if (!enclosingBlock(event.target)) return;
      const selection = view.dom.ownerDocument.getSelection();
      if (!selection?.focusNode || !enclosingBlock(selection.focusNode)) return;
      selection.modify("move", "backward", "word");
      selection.modify("extend", "forward", "word");
    };
    view.dom.addEventListener("dblclick", doubled);
    return { destroy: () => view.dom.removeEventListener("dblclick", doubled) };
  });
}

export const setRendering = StateEffect.define<boolean>();

const rendering = StateField.define<boolean>({
  create: () => true,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setRendering)) return e.value;
    return value;
  },
});

export function isRendering(state: EditorState): boolean {
  return state.field(rendering);
}

/**
 * Which blocks are standing as rendered HTML right now.
 *
 * Two things put the source back, and they are the same two as ever. Any edit at
 * all: a block is only rendered while it still reads exactly as it was sent,
 * because the live diff paints the human's edits and a rendered block would hide
 * them. And the caret being inside it, so a block is never rendered while it is
 * being worked on — that is what keeps this a document rather than a preview.
 *
 * What changed is how the caret can get there. It used to arrive on a click,
 * which meant the one gesture that would select the rendered words dumped you
 * into raw markup instead. `Rendered.ignoreEvent()` now keeps the click out of
 * the editor entirely, so no press inside a box moves the caret and the mouse is
 * free to read and select.
 *
 * The caret still arrives when it is sent — `:17` to the line, or `/pattern` —
 * because those dispatch a selection rather than walking one. Measured: `j` and
 * `k` step over a block rather than into it, CodeMirror having no position to
 * offer inside a replaced range, so an addressed jump is the way in and the
 * lines are numbered for exactly that.
 */
function build(state: EditorState, original: string, images: Images): DecorationSet {
  if (!state.field(rendering)) return Decoration.none;

  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  for (const block of blocks(state)) {
    const from = state.doc.lineAt(block.from).from;
    const to = state.doc.lineAt(block.to).to;
    if (sel.from <= to && sel.to >= from) continue;
    if (!original.includes(state.doc.sliceString(from, to))) continue;
    if (from >= to) continue;
    ranges.push(Decoration.replace({ widget: new Rendered(block.html, images), block: true }).range(from, to));
  }

  return Decoration.set(ranges, true);
}

/**
 * A state field rather than a view plugin: CodeMirror refuses block decorations
 * from a plugin, because it needs their heights before it has drawn anything.
 * So this is computed over the whole document, not just the viewport.
 */
export function renderBlocks(original: string, images: Images = {}) {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, original, images),
    update(deco, tr) {
      const stale =
        tr.docChanged ||
        tr.selection ||
        tr.effects.some((e) => e.is(setRendering)) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state);
      return stale ? build(tr.state, original, images) : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [rendering, field];
}
