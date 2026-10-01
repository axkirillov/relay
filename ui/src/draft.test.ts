import { draftKeeper } from "./draft.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

function harness(start: string) {
  let doc = start;
  let refuse = false;
  const sent: string[] = [];
  const shown: boolean[] = [];
  let hold: (() => void) | null = null;
  const keeper = draftKeeper(
    start,
    () => doc,
    async (text) => {
      sent.push(text);
      if (hold) await new Promise<void>((resolve) => { const release = hold!; hold = () => { release(); resolve(); }; });
      if (refuse) throw new Error("HTTP 500");
    },
    (unsaved) => shown.push(unsaved),
  );
  return {
    keeper, sent, shown,
    type: (text: string) => { doc = text; },
    refuse: (on: boolean) => { refuse = on; },
    pause: () => { hold = () => {}; },
    resume: () => { const h = hold!; hold = null; h(); },
  };
}

{
  const h = harness("a");
  h.type("ab");
  check("a save that works reports the text kept", await h.keeper.save(), true);
  check("and shows no warning", h.shown, [false]);
  check("the text went to the server", h.sent, ["ab"]);
}

{
  const h = harness("a");
  check("unchanged text is not sent", [await h.keeper.save(), h.sent], [true, []]);
}

{
  const h = harness("a");
  h.refuse(true);
  h.type("ab");
  check("a failed save reports the text not kept", await h.keeper.save(), false);
  check("and shows the warning", h.shown.at(-1), true);
  check("nothing counts as saved", h.keeper.saved(), "a");
  await h.keeper.save();
  check("the warning stays while saves keep failing", h.shown.at(-1), true);
  h.refuse(false);
  check("a retry that works clears it", [await h.keeper.save(), h.shown.at(-1)], [true, false]);
  check("and the text is now kept", h.keeper.saved(), "ab");
}

{
  const h = harness("a");
  h.refuse(true);
  h.type("ab");
  await h.keeper.save();
  h.refuse(false);
  h.pause();
  const saving = h.keeper.save();
  await Promise.resolve();
  h.type("abc");
  h.resume();
  check("a save that worked but missed newer typing reports not kept", await saving, false);
  check("so the warning stays", h.shown.at(-1), true);
  check("the next save catches up and clears it", [await h.keeper.save(), h.shown.at(-1)], [true, false]);
}

{
  const h = harness("a");
  h.pause();
  h.type("ab");
  const first = h.keeper.save();
  await Promise.resolve();
  h.type("abc");
  const second = h.keeper.save();
  await Promise.resolve();
  check("a second save waits for the first", h.sent, ["ab"]);
  h.resume();
  await first;
  await second;
  check("then sends the newer text", h.sent, ["ab", "abc"]);
  check("and the newest text is what counts as saved", h.keeper.saved(), "abc");
  check("typing during a save that works never shows the warning", h.shown, [false, false]);
}

{
  const h = harness("a");
  h.refuse(true);
  h.type("ab");
  await h.keeper.save();
  h.type("a");
  check("undoing back to the saved text clears the warning without a request", [await h.keeper.save(), h.shown.at(-1), h.sent.length], [true, false, 1]);
}

process.exit(fails ? 1 : 0);
