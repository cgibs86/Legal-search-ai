"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly extra: { requiredPlan?: string; resetAt?: string; used?: number; limit?: number } = {},
  ) {
    super(message);
  }
  get needsUpgrade() {
    return this.code === "upgrade" || this.code === "sign_in" || this.code === "limit";
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("Network connection lost. Check your connection and try again.", 0, "network");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; requiredPlan?: string; resetAt?: string; used?: number; limit?: number } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status}).`, res.status, err?.code ?? "http_error", { requiredPlan: err?.requiredPlan, resetAt: err?.resetAt, used: err?.used, limit: err?.limit });
  }
  return data as T;
}

export function track(name: string, props?: Record<string, string | number | boolean | null>) {
  try {
    void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, props }), keepalive: true });
  } catch {
    /* analytics must never break the UI */
  }
}

export async function downloadPost(path: string, body: unknown, fallbackName: string) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error?.message ?? "Export failed.", res.status, data?.error?.code ?? "export_failed", { requiredPlan: data?.error?.requiredPlan });
  }
  const blob = await res.blob();
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
