package mcpsrv

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/axkirillov/relay/internal/launch"
	"github.com/axkirillov/relay/internal/web"
)

const toolDescription = `Show a markdown document to the human and wait for their reply.

This is the ONLY channel to the human. Assume they know nothing about the task
beyond what you have relayed: no tool output, no file contents, no reasoning of
yours has reached them. State the context, then the finding or the question.

The call BLOCKS until the human accepts. It returns the whole document back to
you with their remarks inserted inline, fenced like this:

    <<< USER >>> no — fix the query instead <<< /USER >>>

Ask questions as ordinary prose; the human answers in their own words.`

type Server struct {
	web    *web.Server
	logger *log.Logger
}

func New(w *web.Server, logger *log.Logger) *Server {
	return &Server{web: w, logger: logger}
}

func (s *Server) Register(m *server.MCPServer) {
	m.AddTool(mcp.NewTool("relay",
		mcp.WithDescription(toolDescription),
		mcp.WithString("path",
			mcp.Required(),
			mcp.Description("Path to the markdown file to show. Write it first."),
		),
	), s.handleRelay)
}

func (s *Server) handleRelay(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	path, err := req.RequireString("path")
	if err != nil {
		return mcp.NewToolResultError("missing required parameter: path"), nil
	}

	abs, err := filepath.Abs(path)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("resolving %s: %v", path, err)), nil
	}
	doc, err := os.ReadFile(abs)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("reading %s: %v", abs, err)), nil
	}

	sess, url, err := s.web.Open(abs, string(doc))
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("opening relay: %v", err)), nil
	}
	s.logger.Printf("relay %s open at %s (%s)", sess.ID, url, abs)

	if err := launch.Browser(url); err != nil {
		s.logger.Printf("relay %s: %v — open it yourself: %s", sess.ID, err, url)
	}

	accepted, err := sess.Wait(ctx)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("relay cancelled before the human accepted: %v", err)), nil
	}
	s.logger.Printf("relay %s accepted", sess.ID)

	return mcp.NewToolResultText(accepted), nil
}
