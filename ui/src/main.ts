import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightSpecialChars, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";

import { blockHighlight, insertBlock, jumpBlock, protectAgentText } from "./blocks";
import { markdownHighlight, theme } from "./theme";

const status = document.getElementById("status")!;
const mount = document.getElementById("editor")! as HTMLElement;
const docUrl = mount.dataset.doc!;
const acceptUrl = mount.dataset.accept!;

function setStatus(text: string, tone: "idle" | "warn" | "done" = "idle") {
  status.textContent = text;
  status.dataset.tone = tone;
}

let view: EditorView;
let submitted = false;

async function accept() {
  if (submitted) return;
  submitted = true;
  setStatus("sending…");
  try {
    const res = await fetch(acceptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: view.state.doc.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("accepted — the agent has it", "done");
    view.contentDOM.blur();
  } catch (err) {
    submitted = false;
    setStatus(`could not send: ${err}`, "warn");
  }
}

/** Flash the editor when a change was refused for touching agent text. */
function refuse() {
  view.dom.classList.add("cm-relay-refused");
  setStatus("that text is the agent's — press o to add a comment", "warn");
  setTimeout(() => view.dom.classList.remove("cm-relay-refused"), 200);
}

function installVimBindings() {
  Vim.defineAction("relayOpenBelow", (cm: any) => {
    insertBlock(cm.cm6 as EditorView, false);
    Vim.handleKey(cm, "i", "mapping");
  });
  Vim.defineAction("relayOpenAbove", (cm: any) => {
    insertBlock(cm.cm6 as EditorView, true);
    Vim.handleKey(cm, "i", "mapping");
  });
  Vim.defineAction("relayNextBlock", (cm: any) => jumpBlock(cm.cm6 as EditorView, true));
  Vim.defineAction("relayPrevBlock", (cm: any) => jumpBlock(cm.cm6 as EditorView, false));
  Vim.defineAction("relayAccept", () => void accept());

  Vim.mapCommand("o", "action", "relayOpenBelow", {}, { context: "normal" });
  Vim.mapCommand("O", "action", "relayOpenAbove", {}, { context: "normal" });
  Vim.mapCommand("]u", "action", "relayNextBlock", {}, { context: "normal" });
  Vim.mapCommand("[u", "action", "relayPrevBlock", {}, { context: "normal" });
  Vim.mapCommand("ZZ", "action", "relayAccept", {}, { context: "normal" });

  Vim.defineEx("accept", "acc", () => void accept());
}

async function boot() {
  const doc = await (await fetch(docUrl)).text();
  installVimBindings();

  view = new EditorView({
    parent: mount,
    state: EditorState.create({
      doc,
      extensions: [
        vim(),
        history(),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        markdownHighlight,
        theme,
        protectAgentText(refuse),
        blockHighlight,
        keymap.of([...historyKeymap, ...defaultKeymap]),
      ],
    }),
  });

  view.focus();
  setStatus("the agent is waiting — o to comment, ZZ to accept");
  document.getElementById("accept")!.addEventListener("click", () => void accept());
}

void boot();
