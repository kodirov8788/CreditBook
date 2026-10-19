export type CategoryListItem = Readonly<{ id: string; name: string; status: "active" | "archived"; version: number }>;
export type CategoryListPage = Readonly<{ categories: CategoryListItem[]; nextOffset: number | null; paginationLimitReached?: true }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate transport before placing it in UI state; this is not authorization. */
export function parseCategoryList(value: unknown, offset: number): CategoryListPage {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
    !value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CATEGORY_LIST");
  const page = value as Record<string, unknown>;
  if (page.paginationLimitReached !== undefined && page.paginationLimitReached !== true) throw new Error("INVALID_CATEGORY_LIST");
  if (!Array.isArray(page.categories) || page.categories.length > 100 ||
    (page.paginationLimitReached === true && (offset + 100 <= 100000 || page.nextOffset !== null || page.categories.length !== 100)) ||
    (page.nextOffset !== null && (page.nextOffset !== offset + 100 || page.categories.length !== 100 || offset + 100 > 100000))) {
    throw new Error("INVALID_CATEGORY_LIST");
  }
  const seen = new Set<string>();
  const categories = page.categories.map((value): CategoryListItem => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CATEGORY_LIST");
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !uuid.test(row.id) || seen.has(row.id) ||
      typeof row.name !== "string" || [...row.name].length < 1 || [...row.name].length > 80 ||
      [...row.name].some(char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127) ||
      (row.status !== "active" && row.status !== "archived") || !Number.isSafeInteger(row.version) || (row.version as number) < 1) {
      throw new Error("INVALID_CATEGORY_LIST");
    }
    seen.add(row.id);
    return { id: row.id, name: row.name, status: row.status, version: row.version as number };
  });
  return { categories, nextOffset: page.nextOffset as number | null,
    ...(page.paginationLimitReached === true ? { paginationLimitReached: true as const } : {}) };
}

/** Pagination is not a frozen snapshot: de-duplicate a row without downgrading it. */
export function mergeCategoryList(current: readonly CategoryListItem[], incoming: readonly CategoryListItem[]): CategoryListItem[] {
  const rows = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) {
    const old = rows.get(row.id);
    if (!old || row.version > old.version) rows.set(row.id, row);
  }
  return [...rows.values()];
}
