import { basename } from "node:path";

export function page(source: string, framed = false, readOnly = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- The document can contain HTML, and it is rendered. Nothing in here may run:
     the only script allowed is the editor bundle this server serves, and inline
     handlers are refused whatever the sanitiser missed. Images are the single
     exception to the network being closed — a document that links a picture
     should show the picture — and the request goes out as an image or not at
     all. 'unsafe-inline' for styles is unavoidable: CodeMirror injects its own
     <style> at runtime, as does the block above. -->
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

  #term, #edit {
    flex: 0 0 auto;
    height: 42%;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-top: 1px solid var(--line);
  }
  #edit { height: 72%; min-height: 200px; }
  #term[data-hidden], #edit[data-hidden] { display: none; }
  #term-grip, #edit-grip {
    flex: 0 0 auto;
    height: 5px;
    margin-top: -3px;
    cursor: row-resize;
  }
  #term-grip:hover, #edit-grip:hover { background: var(--accent); opacity: .5; }
  #term-bar, #edit-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: .75rem;
    padding: .15rem 1rem .3rem;
    color: var(--dim);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  #term-where, #edit-where { color: var(--fg); overflow: hidden; text-overflow: ellipsis; }
  #term-bar .spacer, #edit-bar .spacer { flex: 1 1 auto; }
  #term-bar button, #edit-bar button {
    -webkit-app-region: no-drag;
    font: inherit;
    color: var(--dim);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  #term-bar button:hover, #edit-bar button:hover { color: var(--fg); }
  #term-view, #edit-view { flex: 1 1 auto; min-height: 0; padding: 0 1rem .35rem; }
  #term-view .xterm, #edit-view .xterm { height: 100%; }

  footer {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .35rem 1rem;
    min-height: 36px;
    padding: .3rem 1rem;
    background: var(--panel);
    border-top: 1px solid var(--line);
    color: var(--dim);
  }
  footer .spacer { flex: 1 1 auto; }
  footer kbd {
    font: inherit;
    color: var(--fg);
    background: #232436;
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 1px 5px;
  }
  #mode {
    min-width: 6.5ch;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--dim);
  }
  #mode.insert { color: var(--add); }
  #mode.visual { color: #ff9e64; }
  #stats .add { color: var(--add); }
  #stats .del { color: var(--del); }
  #queue { color: var(--fg); }
  #note { color: var(--accent); }
  #accept {
    -webkit-app-region: no-drag;
    font: 600 12px/1 inherit;
    color: #16161e;
    background: var(--accent);
    border: 0;
    border-radius: 4px;
    padding: 7px 14px;
    cursor: pointer;
  }

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
    padding: 1.5rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--fg);
  }
  #run-choice button { margin: .75rem .5rem 0 0; padding: .5rem 1rem; cursor: pointer; }

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

    <div id="term" data-hidden>
      <div id="term-grip"></div>
      <div id="term-bar">
        <span id="term-where"></span>
        <span class="spacer"></span>
        <button id="term-take"><kbd id="term-keys">⌘Y</kbd> take into the document</button>
        <span><kbd>⌃\`</kbd> back to the document</span>
        <button id="term-close">✕</button>
      </div>
      <div id="term-view"></div>
    </div>

    <div id="edit" data-hidden>
      <div id="edit-grip"></div>
      <div id="edit-bar">
        <span id="edit-where"></span>
        <span class="spacer"></span>
        <button id="edit-take"><kbd id="edit-keys">⌘Y</kbd> take the selection</button>
        <span><kbd>⌃\`</kbd> back to the document</span>
        <span><kbd>:q</kbd> leaves nvim</span>
      </div>
      <div id="edit-view"></div>
    </div>
  </div>

  <footer>
    <span id="mode">NORMAL</span>
    <span id="stats">unchanged</span>
    <span id="queue"></span>
    <span id="note"></span>
    <span class="spacer"></span>
    <span><kbd>⌃\`</kbd> terminal</span>
    <span><kbd>⌃↵</kbd> run a command</span>
    <span><kbd>gf</kbd> open the file</span>
    <span><kbd>gx</kbd> open the link</span>
    <span><kbd>:res</kbd> put a line back</span>
    <span><kbd>:raw</kbd> render on/off</span>
    ${
      readOnly
        ? `<span><kbd>esc</kbd> or <kbd>:q</kbd> close</span>`
        : `<span><kbd>⌃X</kbd> or <kbd>ZZ</kbd> accept</span>
    <span><kbd>:q</kbd> close without replying</span>
    <button id="accept">Accept</button>`
    }
  </footer>

  <div id="run-choice" role="dialog" aria-modal="true" aria-label="Run command">
    <div class="card">
      <div>Another command is running. How should this one run?</div>
      <button data-choice="queue">Queue</button>
      <button data-choice="parallel">Parallel</button>
      <button data-choice="cancel">Cancel</button>
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
