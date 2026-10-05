import { basename } from "node:path";

export function page(source: string, framed = false, readOnly = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>${escape(basename(source))} — relay</title>
<link rel="stylesheet" href="/assets/relay.css">
<style>
  :root {
    --bg: #16161e;
    --panel: #1a1b26;
    --fg: #c0caf5;
    --dim: #565f89;
    --line: #2a2e3f;
    --accent: #e0af68;
    --add: #9ece6a;
    --del: #f7768e;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 13px/1.5 ui-sans-serif, -apple-system, system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    -webkit-app-region: drag;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: .5rem;
    height: 38px;
    padding: 0 1rem 0 88px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    color: var(--dim);
    user-select: none;
  }
  header .name { color: var(--fg); font-weight: 600; }

  #split { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  #editor { flex: 1 1 auto; min-height: 0; position: relative; }
  .cm-editor { height: 100%; }

  footer {
    flex: 0 0 auto;
    padding: .4rem 1rem;
    background: var(--panel);
    border-top: 1px solid var(--line);
    color: #9aa5ce;
  }
  .footer-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: .6rem; }
  .footer-state { display: flex; gap: .6rem; min-width: 0; align-items: center; }
  .footer-detail { display: flex; gap: .6rem; height: 27px; align-items: center; }
  #stats, #note, #queue { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  #stats { min-width: 0; }
  #note { flex: 1; min-width: 0; color: var(--accent); }
  #queue { max-width: 35%; color: var(--fg); }
  footer kbd, #help-dialog kbd { font: inherit; color: var(--fg); }
  footer button, #help-close {
    -webkit-app-region: no-drag;
    font: inherit;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 5px 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  footer button:hover, #help-close:hover { background: #292e42; }
  footer button:focus-visible, #help-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #context-action { border: 0; padding: 0; text-align: left; flex: 0 0 auto; color: #9aa5ce; }
  #context-action kbd { margin-left: .35rem; }
  #mode { flex: 0 1 13ch; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; letter-spacing: .04em; }
  #mode.insert { color: var(--add); }
  #mode.visual { color: #ff9e64; }
  #stats .add { color: var(--add); }
  #stats .del { color: var(--del); }
  #unsaved { flex: 0 0 auto; color: var(--del); font-weight: 600; white-space: nowrap; }
  #unsaved[hidden] { display: none; }
  #unsaved #retry { border: 0; padding: 0; color: inherit; font-weight: inherit; text-decoration: underline; }
  #accept { color: #16161e; background: var(--accent); border-color: var(--accent); font-weight: 600; }
  #accept kbd { color: inherit; margin-left: .4rem; font-weight: 400; }
  #accept:hover { background: #efc483; }
  #help-dialog {
    width: min(540px, calc(100vw - 32px));
    max-height: calc(100vh - 40px);
    overflow-y: auto;
    padding: 1.25rem;
    border: 1px solid #414968;
    border-radius: 10px;
    background: #1b1c29;
    color: var(--fg);
    box-shadow: 0 24px 80px #0009;
  }
  #help-dialog::backdrop { background: rgba(22, 22, 30, .8); }
  .help-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  #help-dialog h2 { margin: 0; font-size: 18px; }
  #help-dialog h3 { color: #7dcfff; font-size: 13px; margin: 1.1rem 0 .5rem; }
  #help-dialog p { color: #9aa5ce; font-size: 12px; }
  #help-dialog dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .45rem 1rem; margin: 0; }
  #help-dialog dt { color: #e0af68; }
  #help-dialog dd { margin: 0; }

  #run-choice {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(22, 22, 30, .8);
    z-index: 9;
  }
  #run-choice[data-show] { display: flex; }
  #run-choice .card {
    width: min(440px, calc(100vw - 40px));
    padding: 1.4rem;
    background: #1b1c29;
    border: 1px solid #414968;
    border-radius: 12px;
    box-shadow: 0 24px 80px #0009;
    color: var(--fg);
  }
  #run-choice .eyebrow { color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  #run-choice h2 { margin: .4rem 0 .25rem; font-size: 19px; }
  #run-choice .preview { color: var(--dim); font: 12px/1.5 ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #run-choice .choices { display: flex; gap: .7rem; margin-top: 1.2rem; }
  #run-choice button {
    flex: 1;
    text-align: left;
    padding: .8rem;
    color: var(--fg);
    background: #232638;
    border: 1px solid #414968;
    border-radius: 7px;
    cursor: pointer;
    font: inherit;
  }
  #run-choice button:hover, #run-choice button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; background: #303851; }
  #run-choice button kbd { color: var(--accent); font: 700 13px ui-monospace, monospace; }
  #run-choice button small { display: block; margin-top: .3rem; color: var(--dim); font-size: 11px; }
  #run-choice .hint { margin-top: 1rem; color: var(--dim); font-size: 11px; text-align: center; }

  #overlay {
    position: fixed;
    inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .75rem;
    background: rgba(22, 22, 30, .94);
    z-index: 10;
    text-align: center;
  }
  #overlay[data-show] { display: flex; }
  #overlay .mark { font-size: 56px; line-height: 1; color: var(--add); }
  #overlay .title { font-size: 22px; font-weight: 700; color: var(--fg); }
  #overlay .note { font-size: 14px; color: var(--dim); max-width: 40ch; }
  #overlay[data-tone="error"] .mark { color: var(--del); }
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
        ${readOnly ? "" : `<span id="unsaved" role="alert" hidden>Draft not saved · <button id="retry" type="button">Retry</button></span>`}
      </div>
      <button id="help" type="button" aria-haspopup="dialog" aria-controls="help-dialog">Help</button>
      ${readOnly ? `<button id="close" type="button">Close</button>` : `<button id="accept" type="button" title="Accept and send your reply">Accept <kbd>⌃X</kbd></button>`}
    </div>
    <div class="footer-detail">
      <button id="context-action" type="button"><span id="context-label">${readOnly ? "Close" : "Edit"}</span><kbd id="context-key">${readOnly ? ":q" : "i"}</kbd></button>
      <span id="note" role="status"></span>
      <span id="queue"></span>
    </div>
  </footer>

  <dialog id="help-dialog" aria-labelledby="help-title">
    <div class="help-heading"><h2 id="help-title">Keyboard shortcuts</h2><button id="help-close" type="button" autofocus>${readOnly ? "Back to round" : "Close <kbd>Esc</kbd>"}</button></div>
    <h3>${readOnly ? "Read this round" : "Edit and reply"}</h3>
    <dl>
      <dt><kbd>j k</kbd> · <kbd>/</kbd> · <kbd>:N</kbd></dt><dd>Move, search, or go to line N</dd>
      ${readOnly ? `<dt><kbd>Esc</kbd> · <kbd>:q</kbd></dt><dd>Close this read-only round (Esc also closes it from Help in Composer)</dd>` : `<dt><kbd>i</kbd> · <kbd>Esc</kbd></dt><dd>Edit · return to normal mode</dd>
      <dt><kbd>⌃J</kbd></dt><dd>Tick or untick the checkbox on this line</dd>
      <dt><kbd>⌃X</kbd> · <kbd>ZZ</kbd></dt><dd>Accept and send your reply</dd>
      <dt><kbd>:wq</kbd> · <kbd>:x</kbd> · <kbd>:acc</kbd></dt><dd>Also accept</dd>
      <dt><kbd>:w</kbd></dt><dd>Save the draft now</dd>
      <dt><kbd>:q</kbd></dt><dd>Close without replying</dd>
      <dt><kbd>:res</kbd></dt><dd>Restore this line or the selected lines</dd>`}
      <dt><kbd>gx</kbd></dt><dd>Open the link in normal or visual mode</dd>
      <dt><kbd>y</kbd></dt><dd>Yank to the system clipboard</dd>
      <dt><kbd>gO</kbd></dt><dd>Open the file list of the diff under the cursor</dd>
      <dt><kbd>]f</kbd> · <kbd>[f</kbd></dt><dd>Jump to the next or previous file in a diff</dd>
    </dl>
    <h3>Commands and rendering</h3>
    <dl>
      <dt><kbd>⌃J</kbd> · <kbd>:run</kbd></dt><dd>Run the shell block under the cursor</dd>
      <dt><kbd>⌃C</kbd></dt><dd>Stop the latest active run; each block also has its own Stop button</dd>
      <dt><kbd>:raw</kbd></dt><dd>Toggle rendered blocks and source</dd>
      <dt><kbd>zc</kbd> · <kbd>:fold</kbd></dt><dd>Fold expanded command output</dd>
      <dt><kbd>:help</kbd></dt><dd>Open this shortcut list</dd>
    </dl>
    <p>${readOnly ? "Commands run in this round's original worktree; the saved round stays unchanged." : "Accepting does not stop running or queued commands. Their output and report paths are included in your reply."}</p>
  </dialog>

  <div id="run-choice" role="dialog" aria-modal="true" aria-label="Run command">
    <div class="card">
      <div class="eyebrow">Another command is in progress</div>
      <h2>Run this command</h2>
      <div class="preview" id="run-preview"></div>
      <div class="choices">
        <button data-choice="queue"><kbd>[Q]</kbd>ueue<small>After the previous run succeeds</small></button>
        <button data-choice="parallel"><kbd>[P]</kbd>arallel<small>Start now, independently</small></button>
      </div>
      <div class="hint">← → choose · Enter confirm · Esc cancel</div>
    </div>
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
