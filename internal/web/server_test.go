package web

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	s, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestAcceptUnblocksWaiter(t *testing.T) {
	s := newTestServer(t)
	sess, url, err := s.Open("/tmp/finding.md", "# Findings\n\nthe cap is hit every run.\n")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	got := make(chan string, 1)
	go func() {
		doc, err := sess.Wait(context.Background())
		if err != nil {
			t.Errorf("Wait: %v", err)
		}
		got <- doc
	}()

	page, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET page: %v", err)
	}
	defer page.Body.Close()
	body, _ := io.ReadAll(page.Body)
	if page.StatusCode != http.StatusOK {
		t.Fatalf("page status = %d, want 200", page.StatusCode)
	}
	if !strings.Contains(string(body), "the cap is hit every run.") {
		t.Error("page does not contain the document")
	}

	const annotated = "# Findings\n\nthe cap is hit every run.\n\n<<< USER >>> since when? <<< /USER >>>\n"
	res, err := http.Post(url+"/accept", "text/markdown", strings.NewReader(annotated))
	if err != nil {
		t.Fatalf("POST accept: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("accept status = %d, want 204", res.StatusCode)
	}

	select {
	case doc := <-got:
		if doc != annotated {
			t.Errorf("returned doc =\n%q\nwant\n%q", doc, annotated)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Wait did not return after accept")
	}
}

func TestSecondAcceptConflicts(t *testing.T) {
	s := newTestServer(t)
	_, url, err := s.Open("/tmp/x.md", "hello")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	for i, want := range []int{http.StatusNoContent, http.StatusConflict} {
		res, err := http.Post(url+"/accept", "text/markdown", strings.NewReader("hello"))
		if err != nil {
			t.Fatalf("accept %d: %v", i, err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Errorf("accept %d status = %d, want %d", i, res.StatusCode, want)
		}
	}
}

func TestUnknownSession404s(t *testing.T) {
	s := newTestServer(t)
	res, err := http.Get("http://" + s.Addr() + "/r/deadbeef")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", res.StatusCode)
	}
}

func TestWaitHonoursCancellation(t *testing.T) {
	s := newTestServer(t)
	sess, _, err := s.Open("/tmp/x.md", "hello")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := sess.Wait(ctx); !errors.Is(err, context.Canceled) {
		t.Errorf("Wait err = %v, want context.Canceled", err)
	}
}

func TestDocEndpointServesSource(t *testing.T) {
	s := newTestServer(t)
	const src = "# Proposal\n\nraise the cap.\n"
	sess, _, err := s.Open("/tmp/x.md", src)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	res, err := http.Get("http://" + s.Addr() + "/r/" + sess.ID + "/doc")
	if err != nil {
		t.Fatalf("GET doc: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if string(body) != src {
		t.Errorf("doc = %q, want %q", body, src)
	}
}
