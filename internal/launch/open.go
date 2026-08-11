package launch

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Window shows url to the human. The Electron shell is preferred: it owns its
// keyboard, so vim keys are not competing with browser shortcuts, and it is a
// window rather than one tab among forty. A browser is the fallback.
//
// RELAY_NO_OPEN suppresses both, so tests do not steal focus.
// RELAY_BROWSER forces the browser path.
func Window(url string) error {
	if os.Getenv("RELAY_NO_OPEN") != "" {
		return nil
	}
	if os.Getenv("RELAY_BROWSER") == "" {
		if bin, app, ok := findShell(); ok {
			return spawn(exec.Command(bin, app, url))
		}
	}
	return Browser(url)
}

// findShell locates the Electron binary and the shell app directory, looking
// beside the running executable and then up from the working directory, so it
// works both from an install tree and from a checkout.
func findShell() (bin, app string, ok bool) {
	if custom := os.Getenv("RELAY_ELECTRON"); custom != "" {
		if app, ok := findShellDir(); ok {
			return custom, app, true
		}
		return "", "", false
	}
	app, ok = findShellDir()
	if !ok {
		return "", "", false
	}
	bin = filepath.Join(app, "node_modules", ".bin", "electron")
	if _, err := os.Stat(bin); err != nil {
		return "", "", false
	}
	return bin, app, true
}

func findShellDir() (string, bool) {
	var roots []string
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			roots = append(roots, filepath.Dir(resolved))
		}
	}
	if wd, err := os.Getwd(); err == nil {
		roots = append(roots, wd)
	}
	for _, root := range roots {
		for dir := root; ; dir = filepath.Dir(dir) {
			candidate := filepath.Join(dir, "shell", "main.js")
			if _, err := os.Stat(candidate); err == nil {
				return filepath.Dir(candidate), true
			}
			if parent := filepath.Dir(dir); parent == dir {
				break
			}
		}
	}
	return "", false
}

// Browser opens url in the user's default browser.
func Browser(url string) error {
	if os.Getenv("RELAY_NO_OPEN") != "" {
		return nil
	}
	switch runtime.GOOS {
	case "darwin":
		return spawn(exec.Command("open", url))
	case "windows":
		return spawn(exec.Command("rundll32", "url.dll,FileProtocolHandler", url))
	default:
		return spawn(exec.Command("xdg-open", url))
	}
}

func spawn(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launching %s: %w", cmd.Path, err)
	}
	go cmd.Wait()
	return nil
}
