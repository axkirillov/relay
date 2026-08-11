package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/mark3labs/mcp-go/server"

	"github.com/axkirillov/relay/internal/launch"
	"github.com/axkirillov/relay/internal/mcpsrv"
	"github.com/axkirillov/relay/internal/web"
)

var version = "dev"

func main() {
	doc := flag.String("doc", "", "show one document and print the result — no MCP client needed")
	flag.Parse()

	logger := log.New(os.Stderr, "[relay] ", log.LstdFlags|log.Lmsgprefix)

	w, err := web.New()
	if err != nil {
		logger.Fatalf("web server: %v", err)
	}

	if *doc != "" {
		if err := serveOnce(w, *doc, logger); err != nil {
			logger.Fatalf("%v", err)
		}
		return
	}

	mcpServer := server.NewMCPServer("relay", version,
		server.WithToolCapabilities(false),
		server.WithRecovery(),
		server.WithInstructions(
			"relay is how you talk to the human. Write a markdown document, "+
				"call relay with its path, and the call blocks until they reply. "+
				"They have seen nothing else — no tool output, no file contents."),
	)
	mcpsrv.New(w, logger).Register(mcpServer)

	logger.Printf("relay %s ready (ui on %s)", version, w.Addr())
	if err := server.ServeStdio(mcpServer, server.WithErrorLogger(logger)); err != nil {
		logger.Fatalf("serving stdio: %v", err)
	}
}

// serveOnce drives the UI without an agent on the other end, so the page can be
// worked on directly.
func serveOnce(w *web.Server, path string, logger *log.Logger) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolving %s: %w", path, err)
	}
	body, err := os.ReadFile(abs)
	if err != nil {
		return fmt.Errorf("reading %s: %w", abs, err)
	}

	sess, url, err := w.Open(abs, string(body))
	if err != nil {
		return err
	}
	logger.Printf("open at %s", url)
	if err := launch.Browser(url); err != nil {
		logger.Printf("%v — open it yourself: %s", err, url)
	}

	accepted, err := sess.Wait(context.Background())
	if err != nil {
		return err
	}
	fmt.Print(accepted)
	return nil
}
