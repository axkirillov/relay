---
name: relay-pr
description: When opening a pull request — relay the verbatim diff, then push the branch and run gh pr create.
---

# Before you open a pull request

Relay the diff first, **verbatim** — `git diff`'s own output.

Put it in a fenced ```diff block. Long is fine; the window scrolls.

Once they accept the diff, push the branch and open the pull request.

If they edit the diff document instead of accepting it as is, act on the
edit before pushing.
