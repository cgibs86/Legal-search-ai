/**
 * Opaque "load more" tokens. They carry only provider cursors (never URLs), so a
 * tampered token can at worst request a different page of the same query.
 */
export type Cursors = Record<string, string | null>;

const CURSOR_RE = /^[A-Za-z0-9+/=_%-]{1,512}$/;

export function encodePageToken(cursors: Cursors): string | null {
  const clean = Object.fromEntries(Object.entries(cursors).filter(([, v]) => v));
  if (Object.keys(clean).length === 0) return null;
  return Buffer.from(JSON.stringify(clean), "utf8").toString("base64url");
}

export function decodePageToken(token: string | null | undefined): Cursors | null {
  if (!token || token.length > 4096) return null;
  try {
    const obj = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out: Cursors = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!["dockets", "opinions", "filings"].includes(k)) continue;
      if (typeof v === "string" && CURSOR_RE.test(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
