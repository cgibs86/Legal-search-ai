import type { MentionSnippet } from "@/lib/domain/types";

/** Renders provider- or locally-highlighted source text. Never renders generated text. */
export function Snippet({ snippet, className }: { snippet: MentionSnippet; className?: string }) {
  return (
    <p className={className}>
      {snippet.segments.map((s, i) =>
        s.highlight ? (
          <mark key={i} className="mark">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

export const SNIPPET_SOURCE_LABEL: Record<MentionSnippet["source"], string> = {
  provider_highlight: "Highlighted by source search engine",
  local_match: "Matched in source text",
  document_excerpt: "Document excerpt (match location not returned by source)",
};

export const SNIPPET_FIELD_LABEL: Record<MentionSnippet["field"], string> = {
  document_text: "Document text",
  entry_description: "Docket entry text",
  opinion_text: "Opinion text",
  case_name: "Case name",
};
