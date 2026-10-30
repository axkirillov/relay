import { EditorView } from "@codemirror/view";

import type { Images } from "./render.ts";
import { insertion } from "./take.ts";

type Kept = { ref: string; served: string };

export function imageLine(ref: string): string {
  return /\s/.test(ref) ? `![](<${ref}>)` : `![](${ref})`;
}

export function pastedImage(data: DataTransfer | null): File | null {
  const items = [...(data?.items ?? [])];
  if (items.some((item) => item.kind === "string" && item.type === "text/plain")) return null;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

export function pasteImages(images: Images, pasted: Set<string>, note: (text: string) => void, reading: boolean) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const image = pastedImage(event.clipboardData);
      if (!image) return false;
      event.preventDefault();
      if (reading) {
        note("this document is read-only");
        return true;
      }
      void keep(image).then(
        ({ ref, served }) => {
          images[ref] = served;
          const line = imageLine(ref);
          pasted.add(line);
          const { from, insert } = insertion(view.state.doc.toString(), view.state.selection.main.head, line);
          view.dispatch({ changes: { from, insert }, selection: view.state.selection, scrollIntoView: true });
          view.focus();
          note("image pasted");
        },
        (err: Error) => note(err.message),
      );
      return true;
    },
  });
}

async function keep(image: File): Promise<Kept> {
  const res = await fetch("/paste", { method: "POST", headers: { "content-type": image.type }, body: image });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Kept;
}
