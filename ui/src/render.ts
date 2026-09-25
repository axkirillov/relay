import { syntaxTree } from "@codemirror/language";
import { EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

import { type Diagrams, failure, mermaidFence, mermaidFences } from "./diagram.ts";

type SyntaxNode = {
  name: string;
  from: number;
  to: number;
  parent: SyntaxNode | null;
  firstChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
};

export type Block = { from: number; to: number; html: string; kind: Kind };
type Kind = "html" | "table" | "image" | "diagram";

export type Images = Record<string, string>;

export function localSrc(src: string): boolean {
  const s = src.trim();
  return s !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith("//") && !s.startsWith("#");
}

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

const loose = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
  "li", "p", "td", "th", "tr", "thead", "tbody", "tfoot", "dt", "dd",
  "option", "optgroup", "colgroup", "rp", "rt",
]);

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

export function blocks(state: EditorState, diagrams: Diagrams = new Map()): Block[] {
  const found: Block[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode") {
        const fence = mermaidFence(state, node.node);
        const drawn = fence && diagrams.get(fence.code);
        if (fence && drawn && "svg" in drawn) {
          found.push({
            from: fence.from,
            to: fence.to,
            html: `<div class="cm-relay-diagram">${drawn.svg}</div>`,
            kind: "diagram",
          });
        }
        return false;
      }
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
    if (last && block.from < last.to) continue;
    if (last && last.kind === "html" && block.kind === "html" && tagBalance(last.html) > 0) {
      last.to = block.to;
      last.html = state.doc.sliceString(last.from, block.to);
      continue;
    }
    out.push({ ...block });
  }
  return out.filter((b) => b.kind !== "html" || tagBalance(b.html) === 0);
}

function htmlParagraph(state: EditorState, node: SyntaxNode): Block | null {
  if (node.firstChild?.name !== "HTMLTag") return null;
  const text = state.doc.sliceString(node.from, node.to).trim();
  if (!text.startsWith("<") || !text.endsWith(">") || tagBalance(text) !== 0) return null;
  return { from: node.from, to: node.to, html: text, kind: "html" };
}

function standaloneImage(state: EditorState, node: SyntaxNode): Block | null {
  const parent = node.parent;
  if (!parent || parent.name !== "Paragraph") return null;
  const text = state.doc.sliceString(node.from, node.to);
  if (state.doc.sliceString(parent.from, parent.to).trim() !== text.trim()) return null;

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
  html: string;
  images: Images;
  constructor(html: string, images: Images) {
    super();
    this.html = html;
    this.images = images;
  }
  eq(other: Rendered) {
    return other.html === this.html;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-relay-render";
    const box = el.appendChild(document.createElement("div"));
    box.className = "cm-relay-box";
    box.appendChild(sanitize(this.html, this.images));
    for (const img of box.querySelectorAll("img")) {
      if (img.complete) continue;
      const measure = () => view.requestMeasure();
      img.addEventListener("load", measure, { once: true });
      img.addEventListener("error", measure, { once: true });
    }
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class Failed extends WidgetType {
  text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  eq(other: Failed) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-relay-failed";
    el.textContent = this.text;
    return el;
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

export function followRendered(open: (href: string) => void) {
  return ViewPlugin.define((view: EditorView) => {
    const clicked = (event: MouseEvent) => {
      const anchor = closestAnchor(event.target);
      if (!anchor || !enclosingBlock(anchor)) return;
      event.preventDefault();
      if (event.detail > 1) return;
      open(anchor.getAttribute("href") ?? "");
    };
    view.dom.addEventListener("click", clicked);
    return { destroy: () => view.dom.removeEventListener("click", clicked) };
  });
}

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

export function stepInto(state: EditorState, was: number, now: number): number | null {
  if (!state.field(rendering)) return null;

  const doc = state.doc;
  const lineOf = (pos: number) => doc.lineAt(Math.min(Math.max(pos, 0), doc.length)).number;
  const from = lineOf(was);
  const to = lineOf(now);

  for (const block of blocks(state)) {
    if (block.kind !== "table") continue;
    const top = doc.lineAt(block.from).number;
    const bottom = doc.lineAt(block.to).number;
    if (from === top - 1 && to > bottom) return doc.line(top).from;
    if (from === bottom + 1 && to < top) return doc.line(bottom).from;
  }

  return null;
}

function build(state: EditorState, original: string, images: Images, diagrams: Diagrams): DecorationSet {
  if (!state.field(rendering)) return Decoration.none;

  const sel = state.selection.main;
  const ranges: Range<Decoration>[] = [];

  for (const block of blocks(state, diagrams)) {
    const from = state.doc.lineAt(block.from).from;
    const to = state.doc.lineAt(block.to).to;
    if (sel.from <= to && sel.to >= from) continue;
    if (!original.includes(state.doc.sliceString(from, to))) continue;
    if (from >= to) continue;
    ranges.push(Decoration.replace({ widget: new Rendered(block.html, images), block: true }).range(from, to));
  }

  for (const fence of diagrams.size ? mermaidFences(state) : []) {
    const drawn = diagrams.get(fence.code);
    if (!drawn || !("error" in drawn)) continue;
    const top = state.doc.lineAt(fence.from);
    const to = state.doc.lineAt(fence.to).to;
    if (!original.includes(state.doc.sliceString(top.from, to))) continue;
    const widget = new Failed(failure(drawn.error, fence.code, top.number));
    ranges.push(Decoration.widget({ widget, block: true, side: 1 }).range(to));
  }

  return Decoration.set(ranges, true);
}

export function renderBlocks(original: string, images: Images = {}, diagrams: Diagrams = new Map()) {
  const field = StateField.define<DecorationSet>({
    create: (state) => build(state, original, images, diagrams),
    update(deco, tr) {
      const stale =
        tr.docChanged ||
        tr.selection ||
        tr.effects.some((e) => e.is(setRendering)) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state);
      return stale ? build(tr.state, original, images, diagrams) : deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const walkIn = EditorState.transactionFilter.of((tr) => {
    if (tr.docChanged || !tr.selection) return tr;
    const was = tr.startState.selection.main;
    const now = tr.newSelection.main;
    if (!was.empty || !now.empty) return tr;
    const target = stepInto(tr.startState, was.head, now.head);
    return target === null ? tr : [tr, { selection: { anchor: target } }];
  });

  return [rendering, field, walkIn];
}
