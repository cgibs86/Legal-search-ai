import "server-only";

type Level = "debug" | "info" | "warn" | "error";

const REDACT_KEYS = new Set(["query", "q", "email", "password", "token", "authorization", "pacer_password", "name"]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Structured JSON logs. Search text, emails and credentials are redacted by key so
 * sensitive search data never lands in log storage.
 */
function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level === "debug") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
