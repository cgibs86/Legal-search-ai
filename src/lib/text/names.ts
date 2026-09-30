/**
 * Name normalization utilities shared by query classification, variant expansion,
 * match classification and identity resolution. Pure functions; no I/O.
 */

const SUFFIX_CLASSES: Record<string, string[]> = {
  inc: ["inc", "inc.", "incorporated"],
  llc: ["llc", "l.l.c.", "l.l.c"],
  corp: ["corp", "corp.", "corporation"],
  co: ["co", "co.", "company"],
  ltd: ["ltd", "ltd.", "limited"],
  lp: ["lp", "l.p.", "l.p"],
  llp: ["llp", "l.l.p.", "l.l.p"],
  pllc: ["pllc", "p.l.l.c."],
  pc: ["pc", "p.c."],
  plc: ["plc", "p.l.c."],
  pa: ["p.a.", "pa"],
  na: ["n.a.", "na"],
  ag: ["ag"],
  gmbh: ["gmbh"],
  sa: ["s.a.", "sa"],
  bv: ["b.v.", "bv"],
  nv: ["n.v.", "nv"],
};

/** Canonical display form for each suffix class, used when generating variants. */
export const SUFFIX_DISPLAY: Record<string, string[]> = {
  inc: ["Inc.", "Inc", "Incorporated"],
  llc: ["LLC", "L.L.C."],
  corp: ["Corporation", "Corp.", "Corp"],
  co: ["Company", "Co."],
  ltd: ["Ltd.", "Limited"],
  lp: ["L.P.", "LP"],
  llp: ["LLP", "L.L.P."],
  pllc: ["PLLC", "P.L.L.C."],
  pc: ["P.C.", "PC"],
  plc: ["PLC", "P.L.C."],
  pa: ["P.A."],
  na: ["N.A."],
  ag: ["AG"],
  gmbh: ["GmbH"],
  sa: ["S.A."],
  bv: ["B.V."],
  nv: ["N.V."],
};

const SUFFIX_LOOKUP = new Map<string, string>();
for (const [cls, forms] of Object.entries(SUFFIX_CLASSES)) for (const f of forms) SUFFIX_LOOKUP.set(f, cls);

const LAW_FIRM_HINTS = /\b(llp|l\.l\.p\.|pllc|p\.l\.l\.c\.|law (?:firm|group|office|offices)|attorneys at law|& associates|legal (?:group|services))\b/i;

const ORG_WORDS =
  /\b(inc|incorporated|llc|l\.l\.c|corp|corporation|company|co|ltd|limited|l\.?p|llp|pllc|plc|p\.c|ag|gmbh|b\.v|n\.v|s\.a|group|holdings|association|assn|committee|institute|university|college|school|foundation|bank|bancorp|trust|fund|services|systems|technologies|technology|entertainment|studios?|games|media|news|government|united states|usa|u\.s\.a|state of|commonwealth|county|city|town|village|department|dept|agency|commission|board|office|district|authority|council|organizations?|press|software|platforms|electronics|interactive|pension|retirement|networks?|labs|partners|capital|ventures|enterprises|industries|international|coalition|union|center|centre|society|league|hospital|health|medical|clinic|church|ministries|republic|tribe|nation|estate of|insurance|financial|securities|mortgage|realty|properties|development|construction|manufacturing|motors|airlines|energy|oil|gas|pharmaceuticals?|communications|telecom|wireless|stores|markets?|restaurants?|foods?|products|solutions|consulting|management|investments?|equity|lending|credit|federal|national|american|global)\b/i;

const PLACEHOLDER = /\b(does?\s*\d|john doe|jane doe|doe\s+\d|unknown (?:party|defendant|plaintiff)s?|et al\.?)\b/i;

const PERSON_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v", "esq", "esq."]);
const GENERATIONAL = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const HONORIFICS = new Set(["mr", "mr.", "mrs", "mrs.", "ms", "ms.", "dr", "dr.", "hon", "hon.", "judge"]);

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Lowercase, strip punctuation except inner hyphens/apostrophes, collapse whitespace. */
export function normalizeName(s: string): string {
  return collapseWhitespace(
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[“”"]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9'\-\s.]/g, " ")
      .replace(/\.(?=\s|$)/g, "")
      .replace(/\./g, ""),
  );
}

export function isPlaceholderParty(name: string): boolean {
  return PLACEHOLDER.test(name);
}

export function looksLikeOrganization(name: string): boolean {
  if (!name) return false;
  return ORG_WORDS.test(name);
}

export function looksLikeLawFirm(name: string): boolean {
  return LAW_FIRM_HINTS.test(name);
}

export interface CompanyName {
  core: string;
  /** Core name with original casing, e.g. "Acme Widgets". */
  coreDisplay: string;
  suffixClass: string | null;
  display: string;
}

/** Splits "Acme Widgets, Inc." into core "acme widgets" and suffix class "inc". */
export function parseCompanyName(raw: string): CompanyName {
  const display = collapseWhitespace(raw.replace(/,\s*$/, ""));
  const tokens = display.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  let suffixClass: string | null = null;
  // Walk from the end, consuming at most two suffix tokens ("Co., Ltd.").
  for (let i = 0; i < 2 && tokens.length > 1; i++) {
    const last = tokens[tokens.length - 1].toLowerCase();
    const cls = SUFFIX_LOOKUP.get(last) ?? SUFFIX_LOOKUP.get(last.replace(/\.$/, ""));
    if (!cls) break;
    suffixClass = suffixClass ?? cls;
    tokens.pop();
  }
  return { core: normalizeName(tokens.join(" ")), coreDisplay: tokens.join(" ").replace(/,+$/, ""), suffixClass, display };
}

export interface PersonName {
  first: string | null;
  middle: string[];
  last: string | null;
  suffix: string | null;
  normalized: string;
}

/**
 * Parses "Robert James Smith", "Smith, Robert J.", "R. J. Smith", "Robert Smith Jr."
 * Returns lowercased components without punctuation.
 */
export function parsePersonName(raw: string): PersonName {
  let s = collapseWhitespace(raw);
  let tokens: string[];
  if (s.includes(",")) {
    const [lastPart, ...rest] = s.split(",");
    const restStr = rest.join(" ").trim();
    const restTokens = restStr.split(/\s+/).filter(Boolean);
    const suffixTokens = restTokens.filter((t) => PERSON_SUFFIXES.has(t.toLowerCase()));
    const given = restTokens.filter((t) => !PERSON_SUFFIXES.has(t.toLowerCase()));
    // "Smith, Jr., Robert" is rare; treat anything after the comma as given names.
    if (given.length === 0 && suffixTokens.length > 0) {
      s = `${lastPart} ${suffixTokens.join(" ")}`;
      tokens = s.split(/\s+/);
    } else {
      tokens = [...given, ...lastPart.trim().split(/\s+/), ...suffixTokens];
    }
  } else {
    tokens = s.split(/\s+/);
  }
  tokens = tokens.map((t) => t.replace(/[,]/g, "")).filter((t) => t && !HONORIFICS.has(t.toLowerCase()));
  let suffix: string | null = null;
  while (tokens.length > 1 && PERSON_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    const t = tokens.pop()!.toLowerCase().replace(/\.$/, "");
    if (GENERATIONAL.has(t)) suffix = suffix ?? t;
  }
  const clean = tokens.map((t) => t.toLowerCase().replace(/\./g, "")).filter(Boolean);
  if (clean.length === 0) return { first: null, middle: [], last: null, suffix, normalized: "" };
  if (clean.length === 1) return { first: null, middle: [], last: clean[0], suffix, normalized: clean[0] };
  const first = clean[0];
  const last = clean[clean.length - 1];
  const middle = clean.slice(1, -1);
  return { first, middle, last, suffix, normalized: [first, ...middle, last].join(" ") };
}

/** Whether two middle-name lists can refer to the same person ("J" ~ "James", "" ~ anything). */
export function middlesCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (x.length === 1 || y.length === 1) {
      if (x[0] !== y[0]) return false;
      continue;
    }
    return false;
  }
  return true;
}

function firstCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return false;
}

export type PersonNameRelation = "identical" | "compatible" | "conflicting";

/**
 * Compares two person names. "identical" = same first, middle(s), last and suffix.
 * "compatible" = could be the same person (missing middle, initials). "conflicting" = cannot be.
 */
export function comparePersonNames(a: PersonName, b: PersonName): PersonNameRelation {
  if (!a.last || !b.last || a.last !== b.last) return "conflicting";
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return "conflicting";
  if (!firstCompatible(a.first, b.first)) return "conflicting";
  if (!middlesCompatible(a.middle, b.middle)) return "conflicting";
  const same =
    a.first === b.first &&
    a.middle.join(" ") === b.middle.join(" ") &&
    (a.suffix ?? "") === (b.suffix ?? "");
  return same ? "identical" : "compatible";
}

/**
 * True when `needle` (a variant) occurs in `haystack` as a whole-word phrase,
 * ignoring case, punctuation and repeated whitespace.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  const h = ` ${normalizeName(haystack)} `;
  const n = normalizeName(needle);
  if (!n) return false;
  return h.includes(` ${n} `);
}

/** Case-insensitive locations of a phrase in raw text, tolerant of punctuation/whitespace differences. */
export function findPhraseRanges(text: string, phrase: string): { start: number; end: number }[] {
  const words = normalizeName(phrase).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s,.'\\-]*");
  const re = new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, "gi");
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Splits a case caption into sides: "A v. B" -> ["A", "B"]. */
export function captionSides(caseName: string): string[] {
  return caseName
    .split(/\s+(?:v\.?|vs\.?|versus)\s+/i)
    .map((s) => collapseWhitespace(s.replace(/,?\s*et al\.?$/i, "")))
    .filter(Boolean);
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

export function slugify(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

const PHONE = /\(?\b\d{3}\)?[-.\s]?\d{3}[-.]\d{4}\b/g;

/**
 * RECAP firm strings often embed contact details: "Direct: 212-474-1000, Cravath, Swaine &
 * Moore, LLP" or "Wisconsin Department of Justice, Firm: 608-266-9945". Keep the name only.
 */
export function cleanFirmName(raw: string): string {
  const s = collapseWhitespace(raw)
    .replace(/^Direct:\s*[^,]*,\s*/i, "")
    .replace(/,?\s*Firm:\s*[\d().\s+-]*$/i, "")
    .replace(PHONE, "")
    .replace(/\s*\([A-Z]{2}\)\s*$/, "")
    .replace(/\s*,\s*(?=,)/g, "")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  return collapseWhitespace(s);
}

/** Grouping key for firms: suffix-insensitive core name ("Munger, Tolles & Olson, LLP" = "Munger Tolles & Olson LLP"). */
export function firmKey(name: string): string {
  const cleaned = cleanFirmName(name);
  return parseCompanyName(cleaned).core || normalizeName(cleaned);
}

const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|hon|honorable)\.?\s+/i;
const GENERATIONAL_RE = /^(?:jr|sr|ii|iii|iv|v)\.?$/i;
const ROLE_TAIL = /^(?:at|atty|attorney|esq\.?|esquire|counsel|pro se|.*\b(?:attorney|general|solicitor|counsel|prosecutor|defender|lead|notice[d]?)\b.*)$/i;

/**
 * Attorney strings from docket search carry honorifics and role tails: "Mr. Scott A. Keller,
 * Attorney", "Amy Hanson, Assistant Attorney General". Returns the name and any stated role
 * (generic "Attorney"/"AT" tails are dropped as noise). Generational suffixes are kept.
 */
export function cleanAttorneyName(raw: string): { name: string; role: string | null } {
  const parts = collapseWhitespace(raw).replace(HONORIFIC, "").split(/\s*,\s*/);
  const roles: string[] = [];
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (GENERATIONAL_RE.test(last) || !ROLE_TAIL.test(last)) break;
    parts.pop();
    if (!/^(?:at|atty|attorney|esq\.?|esquire)$/i.test(last)) roles.unshift(last);
  }
  return { name: parts.join(", "), role: roles.length ? roles.join(", ") : null };
}

/** Rejects judge fields that are fragments ("III", "J.", "Per Curiam" stays valid). */
export function cleanJudgeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = collapseWhitespace(raw).replace(HONORIFIC, "");
  const letters = s
    .split(/[\s,]+/)
    .filter((w) => !GENERATIONAL_RE.test(w))
    .join("")
    .replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 ? s : null;
}
