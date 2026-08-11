package web

import (
	"html/template"
	"io"
	"log"
	"path/filepath"
)

// M1 scaffold: the document as plain text plus an Accept button. Enough to
// prove the blocking loop end to end. The CodeMirror editor replaces this.
var pageTmpl = template.Must(template.New("page").Parse(`<!doctype html>
<meta charset="utf-8">
<title>relay — {{.Name}}</title>
<style>
  :root { color-scheme: dark }
  body {
    margin: 0; background: #16161e; color: #c0caf5;
    font: 14px/1.6 ui-monospace, "SF Mono", Menlo, monospace;
    display: flex; flex-direction: column; height: 100vh;
  }
  header {
    display: flex; align-items: baseline; gap: .75rem;
    padding: .75rem 1.25rem; border-bottom: 1px solid #2a2e3f;
    background: #1a1b26;
  }
  header b { color: #7aa2f7; font-weight: 600 }
  header span { color: #565f89; font-size: 12px }
  main { flex: 1; overflow: auto; padding: 1.5rem 1.25rem }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; max-width: 88ch }
  footer {
    padding: .75rem 1.25rem; border-top: 1px solid #2a2e3f;
    background: #1a1b26; display: flex; align-items: center; gap: 1rem;
  }
  button {
    font: inherit; font-weight: 600; cursor: pointer;
    background: #7aa2f7; color: #16161e; border: 0;
    padding: .45rem 1.1rem; border-radius: 5px;
  }
  button:disabled { background: #2a2e3f; color: #565f89; cursor: default }
  #status { color: #565f89; font-size: 12px }
</style>
<header>
  <b>relay</b>
  <span>{{.Source}}</span>
</header>
<main><pre id="doc">{{.Doc}}</pre></main>
<footer>
  <button id="accept">Accept</button>
  <span id="status">the agent is waiting</span>
</footer>
<script>
  const btn = document.getElementById("accept");
  const status = document.getElementById("status");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "sending…";
    const res = await fetch({{.AcceptURL}}, {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: document.getElementById("doc").textContent,
    });
    status.textContent = res.ok
      ? "accepted — you can close this tab"
      : "failed: " + res.status;
  });
</script>
`))

func renderPage(w io.Writer, sess *Session) {
	data := struct {
		Name      string
		Source    string
		Doc       string
		AcceptURL string
	}{
		Name:      filepath.Base(sess.Source),
		Source:    sess.Source,
		Doc:       sess.Doc,
		AcceptURL: "/r/" + sess.ID + "/accept",
	}
	if err := pageTmpl.Execute(w, data); err != nil {
		log.Printf("relay: rendering page: %v", err)
	}
}
