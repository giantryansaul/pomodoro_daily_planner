const SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = "pomDay.schemaVersion";

let schemaInitialized = false;

function ensureSchemaInitialized(): void {
  if (schemaInitialized) return;
  if (typeof window === "undefined" || !window.localStorage) {
    schemaInitialized = true;
    return;
  }
  const stored = window.localStorage.getItem(SCHEMA_VERSION_KEY);
  if (stored === null) {
    window.localStorage.setItem(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
  }
  schemaInitialized = true;
}

export function readJson<T>(key: string): T | null {
  ensureSchemaInitialized();
  if (typeof window === "undefined" || !window.localStorage) return null;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson<T>(key: string, value: T): void {
  ensureSchemaInitialized();
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function removeKey(key: string): void {
  ensureSchemaInitialized();
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.removeItem(key);
}

export const StorageKeys = {
  schemaVersion: SCHEMA_VERSION_KEY,
  dayBoundaryDefaults: "pomDay.dayBoundaryDefaults",
  recurringTemplates: "pomDay.recurringTemplates",
  day: (dateIso: string): string => `pomDay.day.${dateIso}`,
} as const;
