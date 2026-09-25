import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Mermaid, MermaidConfig } from "mermaid";

type SyntaxNode = {
  name: string;
  from: number;
  to: number;
  firstChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
};

type Tree = ReturnType<typeof syntaxTree>;

export type Fence = { from: number; to: number; code: string };
export type Drawn = { svg: string } | { error: string };
export type Diagrams = Map<string, Drawn>;

const locked = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "theme",
  "themeVariables",
  "themeCSS",
  "darkMode",
  "fontFamily",
  "look",
  "layout",
];

const config: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "base",
  layout: "dagre",
  secure: locked,
  class: { padding: 6, hideEmptyMembersBox: true },
  themeVariables: {
    darkMode: true,
    dropShadow: "none",
    useGradient: false,
    background: "#1b1c29",
    primaryColor: "#1b1c29",
    primaryBorderColor: "#7aa2f7",
    primaryTextColor: "#c0caf5",
    secondaryColor: "#20222f",
    tertiaryColor: "#20222f",
    lineColor: "#7a85b8",
    textColor: "#c0caf5",
    fontFamily: "ui-sans-serif, -apple-system, system-ui, sans-serif",
    fontSize: "13px",
    edgeLabelBackground: "#1b1c29",
    noteBkgColor: "#20222f",
    noteTextColor: "#c0caf5",
    noteBorderColor: "#565f89",
  },
};

export function mermaidFence(state: EditorState, node: SyntaxNode): Fence | null {
  if (node.name !== "FencedCode") return null;
  let info = "";
  let code = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "CodeInfo") info = state.doc.sliceString(child.from, child.to);
    if (child.name === "CodeText") code = state.doc.sliceString(child.from, child.to);
  }
  if (info.trim().toLowerCase().split(/\s/)[0] !== "mermaid") return null;
  return { from: node.from, to: node.to, code };
}

export function mermaidFences(state: EditorState, tree: Tree = syntaxTree(state)): Fence[] {
  const found: Fence[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return undefined;
      const fence = mermaidFence(state, node.node);
      if (fence) found.push(fence);
      return false;
    },
  });
  return found;
}

type Traced = { text: string; at: number[] };

const preprocessed = [
  /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/gs,
  /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi,
  /^\s*%%(?!{)[^\n]+\n?/gm,
  /^\s+/g,
];

function trace(code: string): Traced {
  const at: number[] = [];
  let line = 1;
  for (let i = 0; i < code.length; i++) {
    at.push(line);
    if (code[i] === "\n") line++;
  }
  return { text: code, at };
}

function drop(traced: Traced, pattern: RegExp): Traced {
  let text = "";
  let at: number[] = [];
  let kept = 0;
  for (const m of traced.text.matchAll(pattern)) {
    text += traced.text.slice(kept, m.index);
    at = at.concat(traced.at.slice(kept, m.index));
    kept = m.index + m[0].length;
  }
  return { text: text + traced.text.slice(kept), at: at.concat(traced.at.slice(kept)) };
}

export function sourceLine(code: string, n: number): number {
  const last = code.split("\n").length;
  const { text, at } = preprocessed.reduce(drop, trace(code));
  let index = 0;
  for (let line = 1; line < n; line++) {
    index = text.indexOf("\n", index) + 1;
    if (index === 0) return last;
  }
  return at[index] ?? last;
}

export function failure(message: string, code: string, top: number): string {
  const line = (n: string) => top + sourceLine(code, Number(n));
  const lines = message.split("\n");

  const jison = /^(?:Parse|Lexical) error on line (\d+)[:.]\s*(.*)$/.exec(lines[0] ?? "");
  if (jison) {
    const said = (jison[2] || lines.slice(3).join(" ")).trim();
    return `diagram not drawn — line ${line(jison[1]!)}${said ? `: ${said}` : ""}`;
  }

  if (message.startsWith("Parsing failed:")) {
    const said = message.replace(/\bline (\d+)/g, (_, n: string) => `line ${line(n)}`).replace(/\n/g, "\\n");
    return `diagram not drawn — ${said}`;
  }

  const unknown = /^(No diagram type detected) matching/.exec(message);
  if (unknown) return `diagram not drawn — ${unknown[1]}`;

  return `diagram not drawn — ${lines[0]?.trim() || "Mermaid gave no reason"}`;
}

function said(err: unknown): string {
  if (typeof err === "object" && err && "message" in err) return String(err.message);
  return String(err);
}

function load(): Promise<Mermaid> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/mermaid.js";
    script.onload = () => resolve((window as unknown as { mermaid: Mermaid }).mermaid);
    script.onerror = () => reject(new Error("mermaid.js did not load"));
    document.head.appendChild(script);
  });
}

export async function drawDiagrams(original: string): Promise<Diagrams> {
  const drawn: Diagrams = new Map();
  if (!/mermaid/i.test(original)) return drawn;

  const state = EditorState.create({ doc: original, extensions: markdown({ base: markdownLanguage }) });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state);
  const codes = new Set(mermaidFences(state, tree).map((f) => f.code));
  if (!codes.size) return drawn;

  let mermaid: Mermaid;
  try {
    mermaid = await load();
    mermaid.initialize(config);
  } catch (err) {
    for (const code of codes) drawn.set(code, { error: said(err) });
    return drawn;
  }

  let n = 0;
  for (const code of codes) {
    try {
      drawn.set(code, { svg: (await mermaid.render(`relay-diagram-${n++}`, code)).svg });
    } catch (err) {
      drawn.set(code, { error: said(err) });
    }
  }
  return drawn;
}
