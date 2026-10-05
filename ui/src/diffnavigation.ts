import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { fileAt, neighbourFile, type ReviewFile, type ReviewFiles, type ReviewFileSummary } from "./difffiles";

let nextPicker = 0;

function filePath(doc: Document, name: string): HTMLSpanElement {
  const path = doc.createElement("span");
  path.className = "cm-relay-diff-path";
  const slash = name.lastIndexOf("/") + 1;
  const directory = path.appendChild(doc.createElement("span"));
  directory.className = "cm-relay-diff-directory";
  directory.textContent = name.slice(0, slash);
  const basename = path.appendChild(doc.createElement("span"));
  basename.className = "cm-relay-diff-basename";
  basename.textContent = name.slice(slash);
  return path;
}

export function diffNavigation(readFiles: (state: EditorState) => ReviewFiles) {
  return ViewPlugin.fromClass(
    class {
      dom: HTMLDivElement;
      bar: HTMLDivElement;
      current: HTMLButtonElement;
      toggle: HTMLButtonElement;
      panel: HTMLDivElement;
      summary: HTMLSpanElement;
      list: HTMLDivElement;
      hint: HTMLDivElement;
      rows: HTMLButtonElement[] = [];
      files: ReviewFileSummary[] = [];
      file: ReviewFile | null = null;
      highlighted: string | null = null;
      pinned: ReviewFile | null = null;
      openWhenShown = false;
      openedFromEditor = false;
      destroyed = false;

      constructor(readonly view: EditorView) {
        const doc = view.dom.ownerDocument;
        this.dom = doc.createElement("div");
        this.dom.className = "cm-relay-diff-navigation";
        this.dom.hidden = true;
        this.bar = this.dom.appendChild(doc.createElement("div"));
        this.bar.className = "cm-relay-diff-bar";
        this.current = this.bar.appendChild(doc.createElement("button"));
        this.current.type = "button";
        this.current.className = "cm-relay-diff-current";
        this.current.hidden = true;
        this.toggle = this.bar.appendChild(doc.createElement("button"));
        this.toggle.type = "button";
        this.toggle.className = "cm-relay-diff-picker-toggle";
        this.toggle.hidden = true;
        this.toggle.setAttribute("aria-expanded", "false");
        this.panel = this.dom.appendChild(doc.createElement("div"));
        this.panel.className = "cm-relay-diff-picker";
        this.panel.id = `relay-diff-picker-${++nextPicker}`;
        this.panel.hidden = true;
        this.panel.setAttribute("role", "region");
        this.panel.setAttribute("aria-label", "Jump to file");
        this.toggle.setAttribute("aria-controls", this.panel.id);
        const heading = this.panel.appendChild(doc.createElement("div"));
        heading.className = "cm-relay-diff-picker-heading";
        heading.append("Jump to file");
        this.summary = heading.appendChild(doc.createElement("span"));
        this.list = this.panel.appendChild(doc.createElement("div"));
        this.list.className = "cm-relay-diff-picker-list";
        this.hint = this.panel.appendChild(doc.createElement("div"));
        this.hint.className = "cm-relay-diff-picker-hint";
        this.hint.setAttribute("aria-hidden", "true");
        view.dom.insertBefore(this.dom, view.scrollDOM);
        this.current.onclick = () => { if (this.file) this.jump(this.file); };
        this.toggle.onclick = () => this.panel.hidden ? this.open() : this.close(true);
        this.dom.addEventListener("keydown", this.keydown);
        this.dom.addEventListener("mousedown", this.mousedown);
        this.dom.addEventListener("focusout", this.focusout);
        doc.addEventListener("pointerdown", this.outside);
        this.measure();
      }

      keydown = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (this.panel.hidden) {
          if (event.target !== this.toggle || event.key !== "ArrowDown") return;
          this.open();
        } else if (event.key === "Escape") this.close(true);
        else {
          const at = this.rows.indexOf(this.view.dom.ownerDocument.activeElement as HTMLButtonElement);
          let next: number;
          if (event.key === "ArrowDown") next = (at + 1) % this.rows.length;
          else if (event.key === "ArrowUp") next = (at - 1 + this.rows.length) % this.rows.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = this.rows.length - 1;
          else return;
          this.focusRow(next);
        }
        event.preventDefault();
        event.stopPropagation();
      };

      mousedown = (event: MouseEvent) => {
        if (event.button === 0 && (event.target as Element).closest("button")) event.preventDefault();
      };

      focusout = () => {
        queueMicrotask(() => {
          if (!this.destroyed && !this.dom.contains(this.view.dom.ownerDocument.activeElement)) this.close(false);
        });
      };

      outside = (event: PointerEvent) => {
        if (!this.dom.contains(event.target as Node)) this.close(false);
      };

      focusRow(index: number) {
        for (const [i, row] of this.rows.entries()) row.tabIndex = i === index ? 0 : -1;
        this.rows[index]?.focus({ preventScroll: true });
        this.rows[index]?.scrollIntoView({ block: "nearest" });
      }

      label(arrow: string) {
        const key = this.view.dom.ownerDocument.createElement("span");
        key.className = "cm-relay-diff-picker-key";
        key.textContent = "gO";
        this.toggle.replaceChildren(`${this.files.length} files ${arrow}`, key);
      }

      pickFromEditor(): boolean {
        const files = readFiles(this.view.state);
        const file = fileAt(files, this.view.state.doc.lineAt(this.view.state.selection.main.head).number);
        if (!file || files.list.length < 2) return false;
        if (this.file) this.open(true);
        else {
          this.pinned = file;
          this.openWhenShown = true;
          this.measure();
        }
        return true;
      }

      step(direction: 1 | -1): boolean {
        const files = readFiles(this.view.state);
        const file = neighbourFile(files, this.view.state.doc.lineAt(this.view.state.selection.main.head).number, direction);
        if (file) queueMicrotask(() => { if (!this.destroyed) this.jump(file); });
        return !!file;
      }

      open(fromEditor = false) {
        if (!this.file || this.toggle.hidden) return;
        this.openedFromEditor = fromEditor;
        this.panel.hidden = false;
        this.toggle.setAttribute("aria-expanded", "true");
        this.label("▴");
        this.hint.textContent = this.view.state.readOnly ? "↑↓ move · Enter jump" : "↑↓ move · Enter jump · Esc close";
        this.focusRow(Math.max(0, this.files.findIndex(file => file.name === this.file?.name)));
        this.view.requestMeasure();
      }

      close(focus: boolean) {
        if (this.panel.hidden) return;
        this.panel.hidden = true;
        this.toggle.setAttribute("aria-expanded", "false");
        this.label("▾");
        if (focus) {
          if (this.openedFromEditor) this.view.focus();
          else this.toggle.focus({ preventScroll: true });
        }
        if (this.pinned) {
          this.pinned = null;
          this.measure();
        } else this.view.requestMeasure();
      }

      jump(file: ReviewFile) {
        this.close(false);
        const anchor = this.view.state.doc.line(file.header).from;
        this.view.dispatch({
          selection: { anchor },
          effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 0 }),
        });
        this.view.focus();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.file = null;
          const focused = this.dom.contains(this.view.dom.ownerDocument.activeElement);
          this.close(false);
          if (focused) queueMicrotask(() => { if (!this.destroyed) this.view.focus(); });
        }
        if (update.docChanged || update.geometryChanged || update.viewportChanged) this.measure();
      }

      renderFiles(files: ReviewFileSummary[]) {
        if (this.files === files) return;
        this.files = files;
        this.highlighted = null;
        const doc = this.view.dom.ownerDocument;
        let added = 0;
        let removed = 0;
        this.rows = files.map(file => {
          added += file.added;
          removed += file.removed;
          const row = doc.createElement("button");
          row.type = "button";
          row.className = "cm-relay-diff-picker-file";
          row.tabIndex = -1;
          row.title = file.name;
          row.setAttribute("aria-label", `${file.name}, ${file.added} added lines, ${file.removed} removed lines`);
          const dot = row.appendChild(doc.createElement("span"));
          dot.className = "cm-relay-diff-picker-dot";
          dot.textContent = "●";
          dot.setAttribute("aria-hidden", "true");
          row.append(filePath(doc, file.name));
          for (const [kind, text] of [["add", `+${file.added}`], ["del", `−${file.removed}`]]) {
            const count = row.appendChild(doc.createElement("span"));
            count.className = `cm-relay-diff-picker-${kind}`;
            count.textContent = text!;
          }
          row.onclick = () => this.jump(file);
          return row;
        });
        this.list.replaceChildren(...this.rows);
        this.summary.textContent = `${added} added · ${removed} removed`;
        this.toggle.hidden = files.length < 2;
        this.label(this.panel.hidden ? "▾" : "▴");
        this.toggle.setAttribute("aria-label", `Jump to file: ${files.length} files, gO`);
      }

      measure() {
        const view = this.view;
        view.requestMeasure({
          key: this,
          read: () => {
            if (this.destroyed) return null;
            const rect = view.scrollDOM.getBoundingClientRect();
            const top = Math.max(0, rect.top);
            const height = top - view.documentTop + 0.01;
            if (top >= rect.bottom || height < 0) return null;
            const block = view.lineBlockAtHeight(height);
            if (height >= block.bottom) return null;
            const number = view.state.doc.lineAt(block.from).number;
            const files = readFiles(view.state);
            return files.at.get(number) ?? files.heads.get(number) ?? null;
          },
          write: (found) => {
            if (this.destroyed) return;
            this.renderFiles(readFiles(view.state).list);
            const file = found ?? this.pinned;
            this.file = file;
            const hidden = !file;
            const resized = this.dom.hidden !== hidden;
            const focused = hidden && this.dom.contains(view.dom.ownerDocument.activeElement);
            if (hidden) this.close(false);
            this.dom.hidden = hidden;
            this.current.hidden = hidden;
            const name = file?.name ?? "";
            const title = name ? `Back to file header: ${name}` : "";
            if (this.current.title !== title) {
              const arrow = view.dom.ownerDocument.createElement("span");
              arrow.textContent = "↑";
              arrow.setAttribute("aria-hidden", "true");
              this.current.replaceChildren(filePath(view.dom.ownerDocument, name), arrow);
              this.current.title = title;
              this.current.setAttribute("aria-label", title);
            }
            if (this.highlighted !== name) {
              this.highlighted = name;
              for (const [i, row] of this.rows.entries()) {
                if (this.files[i]!.name === name) row.setAttribute("aria-current", "true");
                else row.removeAttribute("aria-current");
              }
            }
            if (this.openWhenShown) {
              this.openWhenShown = false;
              this.open(true);
            }
            if (resized) view.requestMeasure();
            if (focused) queueMicrotask(() => { if (!this.destroyed) view.focus(); });
          },
        });
      }

      destroy() {
        this.destroyed = true;
        this.dom.removeEventListener("keydown", this.keydown);
        this.dom.removeEventListener("mousedown", this.mousedown);
        this.dom.removeEventListener("focusout", this.focusout);
        this.view.dom.ownerDocument.removeEventListener("pointerdown", this.outside);
        this.dom.remove();
      }
    },
    { eventObservers: { scroll() { this.measure(); } } },
  );
}
