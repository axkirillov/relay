package web

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
)

const maxDocBytes = 8 << 20

// Server serves in-flight relays over loopback on an ephemeral port. One per
// process, so two agents never contend for a port or see each other's docs.
type Server struct {
	ln       net.Listener
	mu       sync.Mutex
	sessions map[string]*Session
}

func New() (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listening on loopback: %w", err)
	}
	s := &Server{ln: ln, sessions: make(map[string]*Session)}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /r/{id}", s.handlePage)
	mux.HandleFunc("GET /r/{id}/doc", s.handleDoc)
	mux.HandleFunc("POST /r/{id}/accept", s.handleAccept)

	go http.Serve(ln, mux)
	return s, nil
}

func (s *Server) Addr() string { return s.ln.Addr().String() }

func (s *Server) Close() error { return s.ln.Close() }

// Open registers a document and returns the session plus the URL to show.
func (s *Server) Open(source, doc string) (*Session, string, error) {
	id, err := newID()
	if err != nil {
		return nil, "", err
	}
	sess := newSession(id, source, doc)

	s.mu.Lock()
	s.sessions[id] = sess
	s.mu.Unlock()

	return sess, fmt.Sprintf("http://%s/r/%s", s.Addr(), id), nil
}

func (s *Server) lookup(id string) (*Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	return sess, ok
}

func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.lookup(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	renderPage(w, sess)
}

func (s *Server) handleDoc(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.lookup(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	io.WriteString(w, sess.Doc)
}

func (s *Server) handleAccept(w http.ResponseWriter, r *http.Request) {
	sess, ok := s.lookup(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxDocBytes))
	if err != nil {
		http.Error(w, "reading body", http.StatusBadRequest)
		return
	}
	if !sess.Accept(string(body)) {
		http.Error(w, "already accepted", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generating id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}
