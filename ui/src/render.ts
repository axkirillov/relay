import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

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

/**
 * Anything that would fetch from the network. The window has a content policy
 * that blocks these outright, so they are caught here to say so plainly instead
 * of leaving a broken image on screen.
 */
export function remoteUrl(url: string): boolean {
  return /^\s*(https?:)?\/\//i.test(url);
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

  const m = /^!\[([^\]]*)\]\(([^)\s]*)/.exec(text);
  if (!m) return null;
  const [, alt = "", src = ""] = m;
  const html = remoteUrl(src)
    ? `<span class="cm-relay-blocked">remote image not loaded — ${escapeHtml(src)}</span>`
    : `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
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
 * handlers, no remote sources and no code to run.
 */
function sanitize(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");

  for (const el of [...parsed.body.querySelectorAll("*")]) {
    if (bannedTag(el.tagName)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (bannedAttr(attr.name, attr.value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === "IMG" && remoteUrl(el.getAttribute("src") ?? "")) {
      const note = parsed.createElement("span");
      note.className = "cm-relay-blocked";
      note.textContent = `remote image not loaded — ${el.getAttribute("src")}`;
      el.replaceWith(note);
    }
  }

  const frag = document.createDocumentFragment();
  while (parsed.body.firstChild) frag.appendChild(parsed.body.firstChild);
  return frag;
}

class Rendered extends WidgetType {
  // A plain field, not a parameter property: node's type stripping runs this
  // file for the tests and does not support them.
  html: string;
  constructor(html: string) {
    super();
    this.html = html;
  }
  eq(other: Rendered) {
    return other.html === this.html;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-relay-render";
    el.appendChild(sanitize(this.html));
    return el;
  }
  // Clicks have to reach the editor: putting the caret in the block is how the
  // source comes back for editing.
  ignoreEvent() {
    return false;
  }
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
 * Two things put the source back. The caret being inside a block, so a block is
 * never rendered while it is being worked on — that is what keeps this a
 * document rather than a preview. And any edit at all: a block is only rendered
 * while it still reads exactly as it was sent, because the live diff paints the
 * human's edits and a rendered block would hide them. Between them, everything
 * the human types stays visible as text.
 */
function build(state: EditorState, original: string): DecorationSet {
  if (!state.field(rendering)) return Decoration.none;

  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  for (const block of blocks(state)) {
    const from = state.doc.lineAt(block.from).from;
    const to = state.doc.lineAt(block.to).to;
    if (sel.from <= to && sel.to >= from) continue;
    if (!original.includes(state.doc.sliceString(from, to))) continue;
    if (from >= to) continue;
    ranges.push(Decoration.replace({ widget: new Rendered(block.html), block: true }).range(from, to));
  }

  return Decoration.set(ranges, true);
}

/**
 * A state field rather than a view plugin: CodeMirror refuses block decorations
 * from a plugin, because it needs their heights before it has drawn anything.
 * So this is computed over the whole document, not just the viewport.
 */
export function renderBlocks(original: string) {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, original),
    update(deco, tr) {
      const stale =
        tr.docChanged ||
        tr.selection ||
        tr.effects.some((e) => e.is(setRendering)) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state);
      return stale ? build(tr.state, original) : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [rendering, field];
}
