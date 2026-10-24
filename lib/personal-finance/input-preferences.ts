export type InputPreferences = Readonly<{ entry: "voice" | "manual" | "receipt"; category: "voice" | "text" }>;
export const DEFAULT_INPUT_PREFERENCES: InputPreferences = { entry: "voice", category: "voice" };

/** Preferences contain no identity, draft, transcript or financial data. */
export function parseInputPreferences(raw: string | null): InputPreferences {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return DEFAULT_INPUT_PREFERENCES;
    const p = value as Record<string, unknown>;
    return {
      entry: p.entry === "manual" || p.entry === "receipt" ? p.entry : "voice",
      category: p.category === "text" ? "text" : "voice",
    };
  } catch { return DEFAULT_INPUT_PREFERENCES; }
}

export function categoryNameProblem(name: string, existing: readonly string[]): string | null {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return "Toifa nomini kiriting.";
  if ([...clean].length > 80 || /[\u0000-\u001f\u007f]/.test(name)) return "Toifa nomi 80 belgigacha bo‘lsin.";
  const key = (value: string) => value.trim().replace(/\s+/g, " ").normalize("NFKC").toLocaleLowerCase("uz");
  return existing.some(value => key(value) === key(clean)) ? "Bunday toifa bor. Boshqa nom kiriting." : null;
}
