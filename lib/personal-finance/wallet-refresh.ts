/** Coalesce focus refreshes, while session changes always supersede old work.
 * No identities, results or credentials are cached here.
 */
export function createWalletRefresh() {
  let active: { controller: AbortController; promise: Promise<void>; focus: boolean } | undefined;
  return {
    run(work: (signal: AbortSignal) => Promise<void>, replace = true): Promise<void> {
      if (active?.focus && !replace) return active.promise;
      active?.controller.abort();
      const controller = new AbortController();
      const job = { controller, promise: Promise.resolve(), focus: !replace };
      active = job;
      job.promise = Promise.resolve().then(async () => {
        if (!controller.signal.aborted) await work(controller.signal);
      }).finally(() => { if (active === job) active = undefined; });
      return job.promise;
    },
    cancel() { active?.controller.abort(); active = undefined; },
  };
}

export type CategoryPage<Category> = {categories: Category[]; nextOffset: number | null; paginationLimitReached?: boolean};
/** Completes the snapshot's category prefix independently of its first paint.
 * Callers publish only the complete list and own cancellation/identity checks.
 */
export async function readRemainingCategories<Category>(first: CategoryPage<Category>, read: (offset: number) => Promise<CategoryPage<Category>>, signal: AbortSignal) {
  const result = [...first.categories];
  let page = first, previous = 0;
  for (;;) {
    signal.throwIfAborted();
    if (page.paginationLimitReached || (page.nextOffset !== null && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= previous || page.nextOffset > 100000))) throw new Error("Category pagination incomplete");
    if (page.nextOffset === null) return result;
    previous = page.nextOffset;
    page = await read(previous);
    result.push(...page.categories);
  }
}
