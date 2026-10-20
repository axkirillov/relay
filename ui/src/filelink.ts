import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type FileReference = { path: string; line?: number; column?: number };

export function fileReference(value: string, encoded = false): FileReference | null {
  let text = value.trim().replace(/^<([^<>]+)>$/, "$1");
  if (!text || /[\x00-\x1f\x7f]/.test(text) || /^www\./i.test(text)) return null;
  const location = /(?::([1-9]\d*)(?::([1-9]\d*))?|#L([1-9]\d*)(?:C([1-9]\d*))?(?:-L?\d+)?)$/.exec(text);
  const line = location ? Number(location[1] ?? location[3]) : undefined;
  const column = location && (location[2] ?? location[4]) ? Number(location[2] ?? location[4]) : undefined;
  if ([line, column].some(n => n !== undefined && (!Number.isSafeInteger(n) || n > 2147483647))) return null;
  if (location) text = text.slice(0, location.index);
  if (/^file:/i.test(text)) {
    try {
      const uri = new URL(text);
      if (uri.host && uri.host !== "localhost" || uri.search || uri.hash) return null;
      text = decodeURIComponent(uri.pathname);
    } catch { return null; }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(text) || text.startsWith("//") || text.startsWith("#")) return null;
    if (encoded) {
      try { text = decodeURIComponent(text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1")); }
      catch { return null; }
    }
  }
  if (!text || /[\x00-\x1f\x7f]/.test(text)) return null;
  return { path: text, ...(line ? { line } : {}), ...(column ? { column } : {}) };
}

export function fileAt(state: EditorState): FileReference | null {
  const selection = state.selection.main;
  if (!selection.empty) return fileReference(state.sliceDoc(selection.from, selection.to).replace(/^`([^`]+)`$/, "$1"));
  const at = selection.head;
  const node = syntaxTree(state).resolveInner(at, 1);
  for (let parent = node; parent; parent = parent.parent!) {
    if (parent.name === "Link" || parent.name === "Autolink") {
      const target = parent.getChild("URL");
      if (target) return fileReference(state.sliceDoc(target.from, target.to), true);
      const label = parent.getChild("LinkLabel");
      const text = state.sliceDoc(parent.from, parent.to);
      const name = label ? state.sliceDoc(label.from + 1, label.to - 1) : "";
      const wanted = normalizeLabel(name || /^\[([^\]]+)\]/.exec(text)?.[1] || "");
      let found: FileReference | null = null;
      const tree = ensureSyntaxTree(state, state.doc.length, 30) ?? syntaxTree(state);
      tree.iterate({ enter(node) {
        if (found || node.name !== "LinkReference") return;
        const label = node.node.getChild("LinkLabel");
        const url = node.node.getChild("URL");
        if (label && url && normalizeLabel(state.sliceDoc(label.from + 1, label.to - 1)) === wanted) found = fileReference(state.sliceDoc(url.from, url.to), true);
      } });
      return found;
    }
    if (parent.name === "InlineCode") {
      return fileReference(state.sliceDoc(parent.from, parent.to).replace(/^(`+)([\s\S]*?)\1$/, "$2"));
    }
  }
  const line = state.doc.lineAt(at);
  const offset = at - line.from;
  for (const match of line.text.matchAll(/"([^"\n]+)"|'([^'\n]+)'|[^\s`<>"']+/g)) {
    if (offset < match.index || offset >= match.index + match[0].length) continue;
    const token = match[1] ?? match[2] ?? match[0].replace(/^[([{]+/, "").replace(/[),;\]}]+$/, "").replace(/\.(?=$)/, "");
    return fileReference(token);
  }
  return null;
}

function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function looksLikeFile(reference: FileReference): boolean {
  return /[/.]/.test(reference.path) || reference.line !== undefined || /^[A-Z][A-Z_\d-]*$/.test(reference.path);
}
