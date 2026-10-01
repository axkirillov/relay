export type Draft = {
  save(): Promise<boolean>;
  saved(): string;
};

export function draftKeeper(
  initial: string,
  current: () => string,
  send: (text: string) => Promise<void>,
  showUnsaved: (unsaved: boolean) => void,
): Draft {
  let saved = initial;
  let failed = false;
  let queue: Promise<boolean> = Promise.resolve(true);

  const write = async (): Promise<boolean> => {
    const text = current();
    if (text !== saved) {
      try {
        await send(text);
        saved = text;
      } catch {
        failed = true;
      }
    }
    if (failed && current() === saved) failed = false;
    showUnsaved(failed);
    return current() === saved;
  };

  return {
    save() {
      queue = queue.then(write);
      return queue;
    },
    saved: () => saved,
  };
}
