import { describe, expect, it } from "vitest";
import { runSearch } from "@/lib/search/orchestrator";

describe("demo search smoke", () => {
  it("Epic Games", async () => {
    const r = await runSearch({ query: "Epic Games", mode: "universal", filters: {}, sort: "relevance", includeVariants: true }, { userId: null, plan: "free" });
    console.log(JSON.stringify({ type: r.entityType, status: r.status, n: r.hits.length, variants: r.variants.map(v=>v.text), statuses: r.providerStatuses.map(s=>[s.source,s.status,s.message]) }, null, 1));
    for (const h of r.hits) console.log(h.score, h.record.court.id, h.record.docketNumber, '|', h.record.caseName, '|', h.match.types.join(','), h.match.field, '|', h.match.matchedText, '|', h.record.kinds.join(','), h.record.sources.length);
    expect(r.hits.length).toBeGreaterThan(3);
  });
  it("docket number", async () => {
    const r = await runSearch({ query: "4:20-cv-05640", mode: "universal", filters: {}, sort: "relevance", includeVariants: true }, { userId: null, plan: "free" });
    for (const h of r.hits) console.log(h.record.caseName, h.match.types, h.record.kinds);
    expect(r.entityType).toBe("docket_number");
  });
  it("attorney", async () => {
    const r = await runSearch({ query: "Gary Bornstein", entityType: "attorney", mode: "universal", filters: {}, sort: "relevance", includeVariants: true }, { userId: null, plan: "free" });
    console.log(r.variants.map(v=>v.text));
    for (const h of r.hits) console.log(h.record.caseName, h.match.types, h.match.field, h.match.matchedText);
  });
});
