---
name: relay-pr
description: What to do before opening a pull request — relay the verbatim diff first, and hand the user the gh pr create command in a shell fence. Use for "open a PR", "open a pull request", "push this branch", "create the PR".
---

# Before you open a pull request

Relay the diff first, **verbatim** — `git diff`'s own output.

Put it in a fenced ```diff block. Long is fine; the window scrolls.

Opening the PR may be refused outright anyway, so the `gh pr create` goes in a
shell fence under the diff and they run it once the diff is agreed.

