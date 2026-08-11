package web

import (
	"context"
	"sync"
	"time"
)

// Session is one in-flight relay: a document shown to the human, and the
// agent's tool call parked on Wait until they accept it.
type Session struct {
	ID       string
	Source   string // absolute path the agent passed
	Doc      string // markdown as sent
	Opened   time.Time
	accepted chan string
	once     sync.Once
}

func newSession(id, source, doc string) *Session {
	return &Session{
		ID:       id,
		Source:   source,
		Doc:      doc,
		Opened:   time.Now(),
		accepted: make(chan string, 1),
	}
}

// Accept hands the final document back to the waiting agent. Only the first
// call has any effect; later ones report false so a double-submit from the
// page is a no-op rather than a panic.
func (s *Session) Accept(doc string) bool {
	first := false
	s.once.Do(func() {
		s.accepted <- doc
		first = true
	})
	return first
}

// Wait blocks until the human accepts, or the agent's call is cancelled.
func (s *Session) Wait(ctx context.Context) (string, error) {
	select {
	case doc := <-s.accepted:
		return doc, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
