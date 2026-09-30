import { describe, expect, it } from "vitest";
import { extractDeadlines } from "@/lib/providers/courtlistener/mappers";

// Descriptions below are verbatim excerpts from the public docket in the demo snapshot (N.D. Cal. 4:20-cv-05640).
describe("extractDeadlines", () => {
  it("labels a date with the phrase right before the trigger, not the preceding citation noise", () => {
    const d = extractDeadlines("(Re 1703 Transcript Order, 1704 Transcript Order ) Release of Transcript Restriction set for 11/16/2026. (Related documents(s) 1703, 1704 )");
    expect(d).toEqual([{ date: "2026-11-16", text: "Release of Transcript Restriction set for 11/16/2026" }]);
  });

  it("keeps the responsible party in the label", () => {
    const d = extractDeadlines("Order Granting 1714 Stipulation Regarding Epic's Response to Apple's Administrative Motion to Seal. Epic's Response due by 8/21/2026. (eac, COURT STAFF)");
    expect(d).toEqual([{ date: "2026-08-21", text: "Epic's Response due by 8/21/2026" }]);
  });

  it("returns nothing when no date is stated", () => {
    expect(extractDeadlines("STATUS REPORT Regarding Apple's Document Production")).toEqual([]);
  });
});
