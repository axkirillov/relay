package launch

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// Browser opens url in the user's default browser without waiting for it.
// Set RELAY_NO_OPEN to suppress it, so tests do not steal focus.
func Browser(url string) error {
	if os.Getenv("RELAY_NO_OPEN") != "" {
		return nil
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("opening browser: %w", err)
	}
	go cmd.Wait()
	return nil
}
