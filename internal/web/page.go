package web

import (
	"html/template"
	"io"
	"log"
	"path/filepath"
)

// The document itself is never templated into the page — the editor fetches it
// from /doc as text/markdown, so nothing can be mangled by HTML escaping.
var pageTmpl = template.Must(template.New("page").Parse(`<!doctype html>
<meta charset="utf-8">
<title>relay — {{.Name}}</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body {
    margin: 0; background: #16161e; color: #c0caf5;
    font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace;
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }
  header, footer {
    flex: none; background: #1a1b26; display: flex; align-items: center;
    gap: .85rem; padding: .6rem 1.1rem;
  }
  header { border-bottom: 1px solid #2a2e3f }
  footer { border-top: 1px solid #2a2e3f }
  header b { color: #7aa2f7 }
  header span { color: #565f89 }
  #editor { flex: 1; min-height: 0; overflow: hidden }
  .cm-editor { height: 100% }
  button {
    font: inherit; font-weight: 600; cursor: pointer; background: #7aa2f7;
    color: #16161e; border: 0; padding: .4rem 1rem; border-radius: 5px;
  }
  #status { color: #565f89 }
  #status[data-tone="warn"] { color: #ff9e64 }
  #status[data-tone="done"] { color: #9ece6a }
  kbd {
    background: #2a2e3f; border-radius: 3px; padding: 1px 5px;
    color: #c0caf5; font: inherit;
  }
  #hint { margin-left: auto; color: #565f89 }
</style>
<header>
  <b>relay</b>
  <span>{{.Source}}</span>
</header>
<div id="editor" data-doc="{{.DocURL}}" data-accept="{{.AcceptURL}}"></div>
<footer>
  <button id="accept">Accept</button>
  <span id="status">loading…</span>
  <span id="hint">
    <kbd>o</kbd> comment · <kbd>]u</kbd> next · <kbd>ZZ</kbd> accept
  </span>
</footer>
<script src="/assets/relay.js"></script>
`))

func renderPage(w io.Writer, sess *Session) {
	data := struct {
		Name      string
		Source    string
		DocURL    string
		AcceptURL string
	}{
		Name:      filepath.Base(sess.Source),
		Source:    sess.Source,
		DocURL:    "/r/" + sess.ID + "/doc",
		AcceptURL: "/r/" + sess.ID + "/accept",
	}
	if err := pageTmpl.Execute(w, data); err != nil {
		log.Printf("relay: rendering page: %v", err)
	}
}
