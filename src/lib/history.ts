// Local query history (browser-only, localStorage). Keeps the last 20 entries.
import type { QueryData, ApiError } from "@/lib/api";

export interface HistoryEntry {
  id: string;
  sql: string;
  command: string;
  rowCount: number;
  durationMs: number;
  ok: boolean;
  errorType?: string;
  at: number;
}

const KEY = "pgconsole:history";
const MAX = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as HistoryEntry[]).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function persist(entries: HistoryEntry[]): HistoryEntry[] {
  const trimmed = entries.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage may be unavailable; ignore */
  }
  return trimmed;
}

export function addHistory(
  sql: string,
  data: QueryData | null,
  error: ApiError | null,
): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    sql,
    command: data?.command ?? "",
    rowCount: data?.rowCount ?? 0,
    durationMs: data?.durationMs ?? 0,
    ok: !error,
    errorType: error?.type,
    at: Date.now(),
  };
  return persist([entry, ...loadHistory()]);
}

export function clearHistory(): HistoryEntry[] {
  persist([]);
  return [];
}