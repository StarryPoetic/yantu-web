import { Store } from "../../../server/store.ts";
import { createPersistentUsageLedger } from "../../../server/explanation/usage-ledger.ts";
import { createSearchBudget } from "../../../server/explanation/search.ts";
import { createModelRuntime } from "../../../server/explanation/index.ts";

const [path, mode] = process.argv.slice(2);
const store = new Store(path);
const usageLedger = createPersistentUsageLedger(store);
process.send?.("ready");
process.once("message", async () => {
  if (mode === "search") {
    const budget = createSearchBudget({
      usageLedger,
      searchDailyRequestsPerUser: 30,
      searchDailyRequestsGlobal: 35,
    });
    let accepted = 0;
    for (let i = 0; i < 40; i++)
      if (budget.claim("same-student", "2026-11-11")) accepted++;
    process.send?.({ accepted });
    store.close();
    process.disconnect?.();
  } else {
    const runtime = createModelRuntime({
      usageLedger,
      userDailyTokens: 18,
      globalDailyTokens: 18,
      now: () => Date.parse("2026-11-11T00:00:00Z"),
      adapter: {
        complete: () => {
          process.send?.("reserved");
          setInterval(() => {}, 10_000);
          return new Promise(() => {});
        },
      },
    });
    await runtime.run("student", "crash", [], JSON.parse, {
      maxOutputTokens: 16,
    });
  }
});
