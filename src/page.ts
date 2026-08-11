import { basename } from "node:path";

export function page(source: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(basename(source))} — relay</title>
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

  /* The traffic lights sit at the far left of this bar, so the title starts
     clear of them rather than underneath. */
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

  #editor { flex: 1 1 auto; min-height: 0; position: relative; }
  .cm-editor { height: 100%; }

  footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 1rem;
    height: 36px;
    padding: 0 1rem;
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
  #stats .add { color: var(--add); }
  #stats .del { color: var(--del); }
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

  /* Acceptance is a full-screen event, not a line of grey text in a corner. */
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
<body>
  <header>
    <span class="name">${escape(basename(source))}</span>
    <span>· the agent is waiting</span>
  </header>

  <div id="editor"></div>

  <footer>
    <span id="stats">unchanged</span>
    <span class="spacer"></span>
    <span><kbd>ZZ</kbd> accept</span>
    <span><kbd>:q</kbd> close without replying</span>
    <button id="accept">Accept</button>
  </footer>

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
