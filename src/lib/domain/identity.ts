export type ClusterConfidence = "strong" | "possible" | "weak" | "unresolved";

export type IdentitySignalKind =
  | "exact_full_name"
  | "compatible_middle"
  | "same_suffix_class"
  | "shared_attorney"
  | "shared_firm"
  | "shared_co_party"
  | "same_court"
  | "same_state"
  | "related_docket"
  | "user_confirmed";

export interface IdentitySignal {
  kind: IdentitySignalKind;
  label: string;
  weight: number;
}

export interface IdentityEdge {
  a: string;
  b: string;
  score: number;
  signals: IdentitySignal[];
}

export interface IdentityCluster {
  id: string;
  label: string;
  confidence: ClusterConfidence;
  confidenceExplanation: string;
  memberHitIds: string[];
  nameForms: string[];
  courts: string[];
  states: string[];
  dateRange: { from: string | null; to: string | null };
  /** Plain-language summaries, e.g. "Same full name + same attorney (Jane Roe) + same court (N.D. Cal.)". */
  groupingReasons: string[];
  edges: IdentityEdge[];
  userAdjusted: boolean;
}

export interface IdentityResolution {
  entityKey: string;
  algorithmVersion: string;
  clusters: IdentityCluster[];
  unresolvedHitIds: string[];
  rejectedHitIds: string[];
  disclaimer: string;
}

export type IdentityCorrectionAction = "confirm" | "reject" | "move" | "split" | "merge";

export interface IdentityCorrection {
  entityKey: string;
  recordKey: string;
  action: IdentityCorrectionAction;
  /** For move: destination cluster. For merge: the cluster merged into. */
  targetClusterId: string | null;
  /** For merge: the cluster being merged away. */
  sourceClusterId: string | null;
  createdAt: string;
}
