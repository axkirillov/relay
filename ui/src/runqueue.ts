export function queueAfter(
  previous: Promise<boolean>,
  run: () => Promise<boolean>,
  skip: () => void,
): Promise<boolean> {
  return previous.then((success) => {
    if (!success) {
      skip();
      return false;
    }
    return run();
  });
}
