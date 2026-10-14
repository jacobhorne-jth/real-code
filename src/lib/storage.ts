/**
 * localStorage helpers. Every access is wrapped in try/catch: storage can be
 * disabled, full, or throw in private windows, and the app must still work.
 */

const PREFIX = "realcode:v1:";

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: progress lives only for this page view.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

// In-memory fallback so a session survives re-renders even without storage.
let memorySessionId: string | null = null;

export function loadSessionId(): string | null {
  const stored = read<string>("session");
  return typeof stored === "string" ? stored : memorySessionId;
}

export function saveSessionId(id: string): void {
  memorySessionId = id;
  write("session", id);
}

export function clearSessionId(): void {
  memorySessionId = null;
  remove("session");
}

/** Per-problem progress kept in the browser, keyed by problem id. */
export interface LocalProblemProgress {
  sessionId: string;
  code: string;
  startedAt: number | null;
  finishedAt: number | null;
  unlockedStage: number;
  submitsPerStage: Record<string, number>;
  regressionsHit: number;
  updatedAt: number;
}

export function loadProblemProgress(problemId: string): LocalProblemProgress | null {
  const value = read<LocalProblemProgress>(`problem:${problemId}`);
  return value && typeof value === "object" && typeof value.code === "string" ? value : null;
}

export function saveProblemProgress(problemId: string, value: LocalProblemProgress): void {
  write(`problem:${problemId}`, value);
}
