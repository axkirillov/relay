# relay

An MCP tool that hands a markdown document to a human and blocks until they
answer.

The agent calls `relay(path)`. A browser tab opens with the document in a modal
(vim) editor. The agent's text is read-only; the human inserts their own blocks
wherever they like. On accept, the whole annotated document goes back to the
agent.

See [SPEC.md](SPEC.md).

Status: **not built yet.** Spec only.
