import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const FiltersSchema = z
  .object({
    matchTypes: z.array(z.enum(["party", "mention", "docket", "attorney", "possible_identity"])).max(5).optional(),
    recordKinds: z.array(z.enum(["docket", "opinion", "filing"])).max(3).optional(),
    partyKind: z.enum(["individual", "company"]).optional(),
    jurisdiction: z.enum(["federal", "state"]).optional(),
    courts: z.array(z.string().regex(/^[a-z0-9]{2,20}$/)).max(50).optional(),
    states: z.array(z.string().regex(/^[A-Z]{2}$/)).max(20).optional(),
    categories: z.array(z.enum(["civil", "criminal", "bankruptcy", "appeal", "other", "unknown"])).max(6).optional(),
    status: z.enum(["active", "closed", "unknown"]).optional(),
    filedAfter: date.optional(),
    filedBefore: date.optional(),
    terminatedAfter: date.optional(),
    terminatedBefore: date.optional(),
  })
  .strict();

export const EntityTypeSchema = z.enum(["person", "company", "attorney", "law_firm", "case", "docket_number", "unknown"]);

export const SearchBodySchema = z.object({
  query: z.string().min(1).max(200),
  entityType: EntityTypeSchema.optional(),
  mode: z.enum(["universal", "docket"]).default("universal"),
  filters: FiltersSchema.default({}),
  sort: z.enum(["relevance", "newest", "oldest"]).default("relevance"),
  includeVariants: z.boolean().default(true),
  pageToken: z.string().max(4096).nullish(),
});

export type SearchBody = z.infer<typeof SearchBodySchema>;
