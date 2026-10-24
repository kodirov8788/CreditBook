// Pure domain contract only. No persistence, auth, schema or HTTP boundary yet.
export type PersonalCategory = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  status: "active" | "archived";
}>;

export type CategoryAttribution = Readonly<{
  categoryId: string;
  workspaceId: string;
  /** Frozen on entry creation/reclassification; rename never rewrites it. */
  nameSnapshot: string;
}>;

export type CategoryAssignment =
  | Readonly<{ kind: "new" }>
  | Readonly<{
      kind: "correction";
      /** Load from an authorized persisted entry, never accept from a client. */
      previous: CategoryAttribution;
    }>;

/** Inputs must be validated server-loaded records and an authorized workspace. */
export function selectableCategories(workspaceId: string, categories: readonly PersonalCategory[]): PersonalCategory[] {
  return categories.filter(category => category.workspaceId === workspaceId && category.status === "active");
}

/**
 * Preserve historical attribution while allowing corrections of other fields.
 * This check supplements, never replaces, DB ownership/FK checks and an atomic
 * category-status/version recheck inside the eventual entry-write transaction.
 */
export function categoryAttribution(
  workspaceId: string,
  category: PersonalCategory | undefined,
  assignment: CategoryAssignment,
): CategoryAttribution {
  if (!category || category.workspaceId !== workspaceId ||
      (assignment.kind === "correction" && assignment.previous.workspaceId !== workspaceId)) {
    throw new Error("CATEGORY_UNAVAILABLE");
  }
  if (assignment.kind === "correction" && assignment.previous.categoryId === category.id) {
    return { ...assignment.previous };
  }
  if (category.status !== "active") throw new Error("CATEGORY_ARCHIVED");
  return { categoryId: category.id, workspaceId, nameSnapshot: category.name };
}
