# @axkirillov/relay-contract

The files under `~/.relay` that [relay](https://github.com/axkirillov/relay) and any window that shows relay's documents read and write. A program that uses this package can take part in relay's queue without copying its rules.

| Import | What it covers |
|---|---|
| `@axkirillov/relay-contract/paths` | Where the files are. `RELAY_QUEUE_DIR` moves all of them, for a rehearsal. |
| `@axkirillov/relay-contract/live` | Whether a process behind a file is still there: its pid answers and it touched the file in the last 10 seconds. |
| `@axkirillov/relay-contract/queue` | The queue of documents waiting for the screen: one ticket per relay in `queue/<ms>-<pid>.json`. |
| `@axkirillov/relay-contract/presence` | Who holds the screen (`window.json`) and when a window last closed (`closed`). |
| `@axkirillov/relay-contract/priority` | The task the human marked to go first. |
| `@axkirillov/relay-contract/task` | Tasks under `tasks/`, one folder per worktree, with links to their rounds. |
| `@axkirillov/relay-contract/round` | One round: `sent.md`, `accepted.md` and `meta.json`. |

Node 22 or later. MIT.
