import { pageColours } from "./colours.ts";

export const pngScale = 2;
export function pngName(at: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  const time = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `diagram-${day}-${time}.png`;
}

export function outermostSvg(target: EventTarget | null): SVGSVGElement | null {
  let found: SVGSVGElement | null = null;
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el instanceof SVGSVGElement) found = el;
  }
  return found;
}

function standalone(svg: SVGSVGElement, width: number, height: number): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const style = getComputedStyle(svg);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  copy.style.maxWidth = "none";
  copy.style.color = style.color;
  copy.style.fontFamily = style.fontFamily;
  return new XMLSerializer().serializeToString(copy);
}

async function drawn(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
  const { width, height } = svg.getBoundingClientRect();
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standalone(svg, width, height))}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * pngScale);
  canvas.height = Math.ceil(height * pngScale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = pageColours().base;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function save(svg: SVGSVGElement) {
  const link = document.createElement("a");
  link.href = (await drawn(svg)).toDataURL("image/png");
  link.download = pngName(new Date());
  link.click();
}

async function copy(svg: SVGSVGElement) {
  const canvas = await drawn(svg);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no PNG"))), "image/png"),
  );
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export function diagramMenu(note: (text: string) => void, back: () => void) {
  const menu = document.getElementById("diagram-menu")!;
  const rows = [...menu.querySelectorAll<HTMLButtonElement>(".row")];
  let target: SVGSVGElement | null = null;

  const isOpen = () => menu.dataset.show !== undefined;

  function close(refocus = true) {
    if (!isOpen()) return;
    delete menu.dataset.show;
    target = null;
    if (refocus) back();
  }

  function open(svg: SVGSVGElement, x: number, y: number) {
    target = svg;
    menu.dataset.show = "";
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(x, innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, innerHeight - height - 4))}px`;
    rows[0]?.focus();
  }

  async function act(choice: string | undefined) {
    const svg = target;
    close();
    if (!svg) return;
    try {
      if (choice === "save") await save(svg);
      if (choice === "copy") {
        await copy(svg);
        note("diagram copied to the clipboard as PNG");
      }
    } catch (err) {
      note(`diagram not exported — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  document.addEventListener("contextmenu", (event) => {
    const svg = outermostSvg(event.target);
    if (!svg || menu.contains(svg)) return close(false);
    event.preventDefault();
    open(svg, event.clientX, event.clientY);
  });

  for (const row of rows) row.addEventListener("click", () => void act(row.dataset.choice));

  document.addEventListener("mousedown", (event) => {
    if (isOpen() && !menu.contains(event.target as Node)) close(false);
  }, true);

  window.addEventListener("blur", () => close(false));
  document.addEventListener("scroll", () => close(false), true);

  window.addEventListener(
    "keydown",
    (event) => {
      if (!isOpen()) return;
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") close();
      else if (event.key === "ArrowDown" || event.key === "j") rows[(at + 1) % rows.length]?.focus();
      else if (event.key === "ArrowUp" || event.key === "k") rows[(at - 1 + rows.length) % rows.length]?.focus();
      else if (event.key === "s" || event.key === "c") void act(event.key === "s" ? "save" : "copy");
      else if (event.key === "Enter") void act(rows[at]?.dataset.choice);
      else return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
