import { ModelError } from "./deepseek.ts";
import { RESEARCH_BUDGET as B } from "./research-budget.ts";
import { academicDomain } from "./research-pages.ts";

// The network pool is shared across reports/accounts. Per-report budgets stay
// separate; repair/fee wave helpers do not acquire this pool a second time.
let globalActive = 0;
const globalHosts = new Set<string>();
const globalQueue: { host: string; signal: AbortSignal; start: () => void }[] =
  [];
function pumpGlobal() {
  while (globalActive < B.concurrency) {
    const index = globalQueue.findIndex((task) => !globalHosts.has(task.host));
    if (index < 0) return;
    const task = globalQueue.splice(index, 1)[0];
    if (task.signal.aborted) {
      task.start();
      continue;
    }
    globalActive++;
    globalHosts.add(task.host);
    task.start();
  }
}
export function sharedResearchRead<T>(
  url: string,
  signal: AbortSignal,
  read: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const host = academicDomain(url);
    const task = {
      host,
      signal,
      start: () => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return read();
          })
          .then(resolve, reject)
          .finally(() => {
            globalActive--;
            globalHosts.delete(host);
            pumpGlobal();
          });
      },
    };
    const onAbort = () => {
      const index = globalQueue.indexOf(task);
      if (index >= 0) {
        globalQueue.splice(index, 1);
        reject(signal.reason);
        pumpGlobal();
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    globalQueue.push(task);
    pumpGlobal();
  });
}

/** One report owns this scheduler. Reservations happen synchronously before dispatch. */
export function createResearchReader<T>(
  reader: (url: string, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const queue: {
    url: string;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const hosts = new Set<string>();
  const dispatchOrder: string[] = [];
  const statistics = {
    reads: 0,
    success: 0,
    failed: 0,
    failuresByCode: {} as Record<string, number>,
    bySchool: {} as Record<
      string,
      { reads: number; success: number; failed: number }
    >,
    platformReads: 0,
  };
  let active = 0;
  const abort = () =>
    controller.abort(signal?.reason ?? new ModelError("RESEARCH_CANCELLED"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  controller.signal.addEventListener("abort", () => {
    for (const task of queue.splice(0)) task.reject(controller.signal.reason);
  });
  function pump() {
    if (controller.signal.aborted) return;
    while (active < B.concurrency) {
      const index = queue.findIndex(
        (task) => !hosts.has(academicDomain(task.url)),
      );
      if (index < 0) break;
      const task = queue.splice(index, 1)[0];
      const host = new URL(task.url).hostname;
      const school = academicDomain(task.url);
      const platform = host === "yz.chsi.com.cn";
      const counts = (statistics.bySchool[school] ??= {
        reads: 0,
        success: 0,
        failed: 0,
      });
      if (
        statistics.reads >= B.reads ||
        counts.reads >= B.schoolReads ||
        (platform && statistics.platformReads >= B.platformReads)
      ) {
        task.reject(new ModelError("WEB_BUDGET_EXHAUSTED"));
        continue;
      }
      statistics.reads++;
      counts.reads++;
      if (platform) statistics.platformReads++;
      active++;
      // Same-school redirect hosts share the lock, so a redirected socket can
      // never overlap another request to its actual destination hostname.
      hosts.add(school);
      dispatchOrder.push(task.url);
      Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted();
          return reader(task.url, controller.signal);
        })
        .then(
          (value) => {
            statistics.success++;
            counts.success++;
            task.resolve(value);
          },
          (error) => {
            statistics.failed++;
            counts.failed++;
            const code =
              error instanceof ModelError ? error.code : "WEB_UNAVAILABLE";
            statistics.failuresByCode[code] =
              (statistics.failuresByCode[code] ?? 0) + 1;
            task.reject(error);
          },
        )
        .finally(() => {
          active--;
          hosts.delete(school);
          pump();
        });
    }
  }
  return {
    statistics,
    dispatchOrder,
    signal: controller.signal,
    abort,
    dispose() {
      signal?.removeEventListener("abort", abort);
    },
    read(url: string) {
      if (controller.signal.aborted)
        return Promise.reject<T>(controller.signal.reason);
      return new Promise<T>((resolve, reject) => {
        queue.push({ url, resolve, reject });
        pump();
      });
    },
  };
}

/** Start a bounded wave together, consume outcomes strictly in input order. */
export async function orderedReadWave<T, R>(
  items: T[],
  read: (item: T) => Promise<R>,
  consume: (item: T, result: PromiseSettledResult<R>) => Promise<void>,
) {
  const results = await Promise.allSettled(items.map(read));
  for (let index = 0; index < items.length; index++)
    await consume(items[index], results[index]);
}
