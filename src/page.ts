import { basename } from "node:path";

import { paletteRules } from "./palette.ts";
import { loadTheme } from "./theme.ts";

export function page(source: string, framed = false, readOnly = false): string {
  const theme = loadTheme();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>${escape(basename(source))} — relay</title>
<style>${paletteRules(theme.palette)}</style>
<link rel="stylesheet" href="/assets/relay.css">
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; overflow: hidden; }

  header {
    -webkit-app-region: drag;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: .5rem;
    height: 44px;
    padding: 0 var(--gutter) 0 88px;
    background: var(--pane);
    border-bottom: 1px solid var(--line);
    color: var(--dim);
    user-select: none;
  }
  header .name { color: var(--title); font-weight: 600; }

  #split { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  #editor { flex: 1 1 auto; min-height: 0; position: relative; }
  .cm-editor { height: 100%; }

  footer {
    flex: 0 0 auto;
    padding: 6px var(--gutter);
    background: var(--pane);
    border-top: 1px solid var(--line);
    color: var(--dim);
  }
  .footer-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: .75rem; }
  .footer-state { display: flex; gap: .75rem; min-width: 0; align-items: center; }
  #stats, #note, #queue { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  #stats { min-width: 0; }
  body[data-read] #stats { display: none; }
  #note { flex: 1; min-width: 0; color: var(--fg); }
  #queue { max-width: 30ch; }
  #queue:empty { display: none; }
  #context-action { flex: 0 0 auto; padding: 0; color: var(--dim); }
  #context-action:hover { text-decoration: none; color: var(--fg); }
  #mode { flex: 0 0 auto; min-width: 7ch; white-space: nowrap; font-weight: 600; color: var(--dim); }
  #mode.insert { color: var(--working); }
  #mode.visual { color: var(--needs); }
  #stats .add { color: var(--added); }
  #stats .del { color: var(--removed); }
  #theme-warning { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #unsaved { flex: 0 0 auto; white-space: nowrap; }
  #unsaved[hidden] { display: none; }

  #help-dialog { padding-bottom: 0; }
  #help-dialog::backdrop { background: var(--scrim); }
  #help-dialog .label.group { margin: 14px 0 6px; }
  #help-dialog dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px var(--gutter); margin: 0; }
  #help-dialog dd { margin: 0; color: var(--said); }
  #help-dialog .note { margin: 14px 0 0; }

  #run-choice {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 9;
  }
  #run-choice[data-show] { display: flex; }
  #run-preview { margin-bottom: 9px; font-size: 11px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #run-choice .choices { margin: 0 -10px; }

  #diagram-menu {
    position: fixed;
    display: none;
    min-width: 26ch;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-box);
    box-shadow: var(--shadow-card);
    z-index: 9;
  }
  #diagram-menu[data-show] { display: block; }

  #overlay {
    position: fixed;
    inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .75rem;
    background: var(--cover);
    z-index: 10;
    text-align: center;
  }
  #overlay[data-show] { display: flex; }
  #overlay .mark { font-size: 56px; line-height: 1; color: var(--added); }
  #overlay .title { font-size: 22px; font-weight: 600; color: var(--title); }
  #overlay .note { font-size: 13px; color: var(--dim); max-width: 40ch; }
  #overlay[data-tone="error"] .mark { color: var(--removed); }
</style>
</head>
<body${readOnly ? " data-read" : ""}>
  ${framed ? "" : `<header>
    <span class="name">${escape(basename(source))}</span>
    <span>· the agent is waiting</span>
  </header>`}

  <div id="split">
    <div id="editor"></div>

  </div>

  <footer>
    <div class="footer-bar">
      <div class="footer-state">
        <span id="mode">NORMAL</span>
        <span id="stats">unchanged</span>
        ${theme.warning ? `<span id="theme-warning" class="warning" role="status">${escape(theme.warning)}</span>` : ""}
        ${readOnly ? "" : `<span id="unsaved" class="warning" role="alert" hidden>draft not saved · <button id="retry" class="action" type="button">retry</button></span>`}
        <button id="context-action" class="action" type="button"><kbd id="context-key">${readOnly ? ":q" : "i"}</kbd> <span id="context-label">${readOnly ? "close" : "edit"}</span></button>
        <span id="note" role="status"></span>
      </div>
      <span id="queue"></span>
      <button id="help" class="button soft" type="button" aria-haspopup="dialog" aria-controls="help-dialog">help</button>
      ${readOnly ? `<button id="close" class="button primary" type="button">close <kbd>:q</kbd></button>` : `<button id="accept" class="button primary" type="button" title="Accept and send your reply">accept <kbd>⌃X</kbd></button>`}
    </div>
  </footer>

  <dialog id="help-dialog" class="card" aria-labelledby="help-title">
    <div class="label">keys</div>
    <div class="subject" id="help-title">${readOnly ? "read this round" : "edit and reply"}</div>
    <dl>
      <dt><kbd>j k</kbd> · <kbd>/</kbd> · <kbd>:N</kbd></dt><dd>Move, search, or go to line N</dd>
      ${readOnly ? `<dt><kbd>esc</kbd> · <kbd>:q</kbd></dt><dd>Close this read-only round</dd>` : `<dt><kbd>i</kbd> · <kbd>esc</kbd></dt><dd>Edit · return to normal mode</dd>
      <dt><kbd>⌃J</kbd></dt><dd>Tick or untick the checkbox on this line</dd>
      <dt><kbd>⌃X</kbd> · <kbd>ZZ</kbd></dt><dd>Accept and send your reply</dd>
      <dt><kbd>:wq</kbd> · <kbd>:x</kbd> · <kbd>:acc</kbd></dt><dd>Also accept</dd>
      <dt><kbd>:w</kbd></dt><dd>Save the draft now</dd>
      <dt><kbd>:q</kbd></dt><dd>Close without replying</dd>
      <dt><kbd>:res</kbd></dt><dd>Restore this line or the selected lines</dd>`}
      <dt><kbd>gf</kbd></dt><dd>Edit the linked file in Neovim</dd>
      <dt><kbd>gx</kbd></dt><dd>Open the web link in normal or visual mode</dd>
      <dt><kbd>y</kbd></dt><dd>Yank to the system clipboard</dd>
      <dt><kbd>⌘O</kbd></dt><dd>Open the file list of the diff under the cursor</dd>
      <dt><kbd>]f</kbd> · <kbd>[f</kbd></dt><dd>Jump to the next or previous file in a diff</dd>
    </dl>
    <div class="label group">commands and rendering</div>
    <dl>
      <dt><kbd>⌃J</kbd> · <kbd>:run</kbd></dt><dd>Run the shell block under the cursor</dd>
      <dt><kbd>⌃⇧J</kbd> · <kbd>:run!</kbd></dt><dd>Run it in a live terminal under the block; <kbd>⌃⇧J</kbd> again goes back to the document</dd>
      <dt><kbd>]r</kbd> · <kbd>[r</kbd></dt><dd>Jump to the next or previous shell block</dd>
      <dt><kbd>⌃C</kbd></dt><dd>Stop the latest active run; each block also has its own Stop button</dd>
      <dt><kbd>:raw</kbd></dt><dd>Toggle rendered blocks and source</dd>
      <dt><kbd>zc</kbd> · <kbd>:fold</kbd></dt><dd>Fold expanded command output</dd>
      <dt><kbd>:help</kbd></dt><dd>Open this shortcut list</dd>
    </dl>
    <p class="note">${readOnly ? "Commands run in this round's original worktree; the saved round stays unchanged." : "Accepting does not stop running or queued commands. Their output and report paths are included in your reply. It does stop live terminals, and keeps what was on their screen."}</p>
    <div class="keys"><span class="spacer"></span><button id="help-close" class="action" type="button" autofocus><kbd>esc</kbd> ${readOnly ? "back to round" : "close"}</button></div>
  </dialog>

  <div id="run-choice" class="scrim" role="dialog" aria-modal="true" aria-label="Run command">
    <div class="card">
      <div class="label">another command is running</div>
      <div class="subject">run this command</div>
      <div id="run-preview"></div>
      <div class="choices">
        <button class="row" data-choice="queue"><kbd>[Q]</kbd>ueue<small>after the previous run succeeds</small></button>
        <button class="row" data-choice="parallel"><kbd>[P]</kbd>arallel<small>start now, on its own</small></button>
      </div>
      <div class="keys"><span><kbd>↑↓</kbd> move</span><span><kbd>↵</kbd> run</span><span class="spacer"></span><span><kbd>esc</kbd> cancel</span></div>
    </div>
  </div>

  <div id="diagram-menu" role="menu" aria-label="Diagram">
    <button class="row" role="menuitem" data-choice="save"><kbd>[S]</kbd>ave diagram as PNG…</button>
    <button class="row" role="menuitem" data-choice="copy"><kbd>[C]</kbd>opy diagram as PNG</button>
  </div>

  <div id="overlay">
    <div class="mark"></div>
    <div class="title"></div>
    <div class="note"></div>
  </div>

  <script src="/assets/relay.js"></script>
</body>
</html>
`;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
