package web

import (
	"embed"
	"io/fs"
	"net/http"
)

// The built editor bundle. It is committed so `go install` yields a binary
// with a UI in it, without needing node at install time.
//
//go:embed dist
var assetsFS embed.FS

func assetHandler() http.Handler {
	sub, err := fs.Sub(assetsFS, "dist")
	if err != nil {
		panic(err)
	}
	return http.StripPrefix("/assets/", http.FileServer(http.FS(sub)))
}
