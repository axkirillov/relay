const names = "… long output — all of it is in ";

export function spillNotice(path: string): string {
  return `${names}${path}`;
}

export function spillPath(text: string): string | null {
  const at = text.lastIndexOf(names);
  if (at < 0) return null;
  const rest = text.slice(at + names.length);
  const end = rest.search(/\s/);
  return (end < 0 ? rest : rest.slice(0, end)) || null;
}

const running = "… still running when this was sent — its output is in ";

export function stillRunningNotice(path: string): string {
  return `${running}${path}`;
}
