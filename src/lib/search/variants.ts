import type { EntityType, NameVariant } from "@/lib/domain/types";
import { collapseWhitespace, parseCompanyName, parsePersonName, SUFFIX_DISPLAY, titleCase } from "@/lib/text/names";

/**
 * Conservative search expansion. Every variant is shown to the user with an explanation,
 * and matches found only through a weaker variant are labeled "Possible identity match".
 */

function cap(s: string): string {
  return s.length <= 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1);
}

function dedupe(vs: NameVariant[]): NameVariant[] {
  const seen = new Set<string>();
  return vs.filter((v) => {
    const k = v.text.toLowerCase().replace(/[.,]/g, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function personVariants(raw: string, expand: boolean): NameVariant[] {
  const exact = collapseWhitespace(raw);
  const out: NameVariant[] = [{ text: exact, kind: "exact", strength: "exact", explanation: "Exactly as entered" }];
  const n = parsePersonName(raw);
  if (!n.first || !n.last) return out;
  const first = cap(n.first);
  const last = n.last.split("-").map(cap).join("-");
  const suffix = n.suffix ? ` ${n.suffix === "jr" || n.suffix === "sr" ? cap(n.suffix) + "." : n.suffix.toUpperCase()}` : "";
  const middleFull = n.middle.map(cap).join(" ");
  const middleInitials = n.middle.map((m) => `${m[0].toUpperCase()}.`).join(" ");

  out.push({
    text: `${last}, ${first}${middleFull ? " " + middleFull : ""}${suffix}`,
    kind: "last_first",
    strength: "equivalent",
    explanation: "Same name in last-name-first order (common on dockets)",
  });
  if (!expand) return dedupe(out);

  if (n.middle.length && n.middle.some((m) => m.length > 1)) {
    out.push({ text: `${first} ${middleInitials} ${last}${suffix}`, kind: "middle_initial", strength: "weaker", explanation: "Middle name reduced to an initial" });
  }
  if (n.middle.length) {
    out.push({ text: `${first} ${last}${suffix}`, kind: "no_middle", strength: "weaker", explanation: "Without the middle name — broader, may include other people" });
    out.push({ text: `${first[0]}. ${middleInitials} ${last}${suffix}`, kind: "initials", strength: "weaker", explanation: "First and middle initials only — broader" });
  }
  return dedupe(out);
}

export function companyVariants(raw: string, expand: boolean): NameVariant[] {
  const exact = collapseWhitespace(raw);
  const out: NameVariant[] = [{ text: exact, kind: "exact", strength: "exact", explanation: "Exactly as entered" }];
  const c = parseCompanyName(raw);
  if (!c.suffixClass) return out;
  if (!expand) return out;
  const coreDisplay = c.coreDisplay || titleCase(c.core);
  for (const form of SUFFIX_DISPLAY[c.suffixClass] ?? []) {
    out.push({ text: `${coreDisplay} ${form}`, kind: "suffix_equivalent", strength: "equivalent", explanation: `Same entity suffix written as "${form}"` });
    out.push({ text: `${coreDisplay}, ${form}`, kind: "suffix_equivalent", strength: "equivalent", explanation: `Same entity suffix written as ", ${form}"` });
  }
  return dedupe(out).slice(0, 7);
}

/** The broadening suggestion shown (not searched) when a company query had a suffix. */
export function coreNameSuggestion(raw: string): NameVariant | null {
  const c = parseCompanyName(raw);
  if (!c.suffixClass || !c.core) return null;
  return { text: titleCase(c.core), kind: "core_name", strength: "weaker", explanation: "Without the entity suffix — may match different companies" };
}

export function buildVariants(raw: string, type: EntityType, expand: boolean): NameVariant[] {
  switch (type) {
    case "person":
    case "attorney":
      return personVariants(raw, expand);
    case "company":
    case "law_firm":
      return companyVariants(raw, expand);
    case "unknown":
      return [{ text: collapseWhitespace(raw), kind: "exact", strength: "exact", explanation: "Exactly as entered" }];
    default:
      return [{ text: collapseWhitespace(raw), kind: "exact", strength: "exact", explanation: "Exactly as entered" }];
  }
}
