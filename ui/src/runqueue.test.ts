import { queueAfter } from "./runqueue.ts";

let fails = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) return console.log(`ok   ${name}`);
  fails++;
  console.log(`FAIL ${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
}

{
  let finish!: (success: boolean) => void;
  const first = new Promise<boolean>((resolve) => { finish = resolve; });
  const events: string[] = [];
  const second = queueAfter(first, async () => { events.push("second"); return true; }, () => events.push("skip second"));
  const third = queueAfter(second, async () => { events.push("third"); return true; }, () => events.push("skip third"));
  check("queued runs wait", events, []);
  finish(true);
  check("queued runs proceed in order after success", await third, true);
  check("both queued commands ran", events, ["second", "third"]);
}

{
  const events: string[] = [];
  const second = queueAfter(Promise.resolve(false), async () => { events.push("second"); return true; }, () => events.push("skip second"));
  const third = queueAfter(second, async () => { events.push("third"); return true; }, () => events.push("skip third"));
  check("failed predecessor skips whole chain", await third, false);
  check("nothing in failed chain runs", events, ["skip second", "skip third"]);
}

{
  const events: string[] = [];
  const parallel = (async () => { events.push("parallel"); return true; })();
  const queued = queueAfter(Promise.resolve(false), async () => { events.push("queued"); return true; }, () => events.push("skip queued"));
  await Promise.all([parallel, queued]);
  check("parallel run is independent of failed chain", events, ["parallel", "skip queued"]);
}

process.exit(fails ? 1 : 0);
