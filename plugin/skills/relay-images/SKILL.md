---
name: relay-images
description: How to put an image in a relay document — markdown or <img>, how local paths resolve, and why the file must exist before relay launches. Use for "show me a screenshot", "put an image in relay", "show the plot", "image not found".
---

# Images in relay

Both spellings work — `![alt](/abs/path.png)` and `<img src="…">`.

Local paths resolve **relative to the document's own directory**, and the file
must exist when relay launches: the servable set is built once from the document
as sent, so an image written later, or produced after launch, will not load
(the box says `image not found` instead). Write the document next to the file, or
use an absolute path. Remote `https:` images and `data:` URIs load.

A screenshot or a rendered plot is often the shortest true answer. `data:` URIs
are the way to embed something generated on the fly without leaving a file
behind.

