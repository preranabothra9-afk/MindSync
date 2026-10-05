export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string; // URL or letter code
  role: 'user' | 'admin';
  createdAt: string;
  blocked?: boolean;
  refreshToken?: string | null;
  lastActiveAt?: string;
  isVerified?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  memberIds: string[];
  createdAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  createdBy: string;
  createdAt: string;
}

export interface MessagePart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  promptText: string;
  modelResponses: {
    [modelKey: string]: {
      modelName: string;
      content: string;
      status: 'pending' | 'streaming' | 'completed' | 'stopped' | 'failed';
      durationMs?: number;
      error?: string;
    };
  };
  createdAt: string;
}

export interface SavedResponse {
  id: string;
  workspaceId: string;
  prompt: string;
  modelName: string;
  responseContent: string;
  savedBy: string;
  senderName: string;
  createdAt: string;
}

export interface PresenceUser {
  userId: string;
  userName: string;
  avatar: string;
  activity?: string; // e.g. "typing...", "editing prompt..."
  lastActive: string;
}

export interface BroadcastPromptUpdate {
  workspaceId: string;
  promptText: string;
  updatedBy: string;
  updatedByName: string;
}

/**
 * A durable, quotable statement extracted from an AI response. Claims give the
 * room a persistent memory the next prompt can be grounded in, so models answer
 * with the ongoing discussion in mind instead of treating each prompt in a vacuum.
 */
export interface Claim {
  id: string;
  /** Room the claim belongs to. */
  conversationId: string;
  /** Message the claim was extracted from. */
  messageId: string;
  /** Registry key of the model that produced the source response. */
  modelKey: string;
  /** Display name of the model that produced the source response. */
  modelName: string;
  /** The claim sentence itself. */
  text: string;
  createdAt: string;
}

/**
 * How two claims in the same room relate, as judged by a detector model.
 * The detector classifies the relationship only — it never decides which
 * claim is true.
 */
export type ClaimRelationship = 'SUPPORT' | 'CONTRADICT' | 'RELATED' | 'UNCERTAIN';

/**
 * The kind of evidence a member (or a model) can attach to a claim.
 *
 * - `url` — a link the member asserts is relevant.
 * - `file` — a document stored inline (base64), mirroring MessagePart.inlineData.
 * - `quote` — a verbatim excerpt plus its source attribution.
 * - `user` — free-form evidence the member wrote themselves.
 * - `ai` — a reference produced by a model. Always `aiGenerated: true`, always
 *   labelled unverified, and only ever built from text the source response
 *   actually contains (the generator verifies its quote is verbatim).
 */
export type EvidenceKind = 'url' | 'file' | 'quote' | 'user' | 'ai';

export interface Evidence {
  id: string;
  /** The claim this evidence is attached to. */
  claimId: string;
  /** Room the evidence belongs to (denormalised for scoping and cleanup). */
  conversationId: string;
  kind: EvidenceKind;
  /** Short human label for the evidence. */
  title: string;
  /** `url` — the link itself. */
  url?: string | null;
  /** `file` — original file name. */
  fileName?: string | null;
  /** `file` — MIME type, so the client can render or offer a download. */
  mimeType?: string | null;
  /** `file` — size in bytes, shown and enforced against the upload cap. */
  sizeBytes?: number | null;
  /** `file` — base64 data URI, stored inline like MessagePart.inlineData. */
  data?: string | null;
  /** `quote` | `user` | `ai` — the excerpt or note text. */
  excerpt?: string | null;
  /** `quote` — who/what the quoted text is attributed to. */
  source?: string | null;
  /**
   * True only when a model produced this reference. AI evidence is always
   * labelled unverified: it is the model's reading of the source, never proof.
   */
  aiGenerated: boolean;
  /** The model that produced an AI reference, so the label can name it. */
  modelName?: string | null;
  /** Member who attached the evidence; absent for AI-generated references. */
  authorId?: string | null;
  authorName?: string | null;
  createdAt: string;
}


/**
 * One edge in a room's contradiction graph, linking two claims. Both claim
 * texts are stored on the edge so the pair can be shown without a second
 * lookup, even after one side is deleted elsewhere. The pair is stored in a
 * canonical (sorted) order so the same two claims can only ever form one edge,
 * whichever direction it was detected from.
 */
export interface ClaimRelation {
  id: string;
  /** Room the relationship belongs to. */
  conversationId: string;
  /** First claim of the canonically-sorted pair. */
  claimAId: string;
  /** Second claim of the canonically-sorted pair. */
  claimBId: string;
  /** Text of the first claim, denormalised for display. */
  claimAText: string;
  /** Text of the second claim, denormalised for display. */
  claimBText: string;
  /** Model that produced the first claim. */
  claimAModelName: string;
  /** Model that produced the second claim. */
  claimBModelName: string;
  /** The detector's verdict on the pair. */
  relationship: ClaimRelationship;
  /** Detector's confidence in the verdict, 0 to 1. */
  confidence: number;
  /** One short sentence describing how the two claims relate. */
  explanation: string;
  /**
   * Lifecycle of the edge. `detected` is the only value the detector ever
   * writes. `resolved` and `dismissed` are recorded exclusively by an
   * authorized human closing the discussion — never by the detector, never
   * from the poll tally, and never from the confidence score.
   */
  // 'evidence-needed' is the room declining to pick a side: the poll's
  // "Neither / need more evidence" outcome. It is a closed state (the
  // contradiction no longer needs a human decision), shown in yellow.
  status: 'detected' | 'resolved' | 'evidence-needed' | 'dismissed';
  /** The reason an authorized human recorded when closing the contradiction. */
  resolution?: string | null;
  /** Id of the human who closed the contradiction. */
  resolvedBy?: string | null;
  /** Name of the human who closed the contradiction. */
  resolvedByName?: string | null;
  /** When the contradiction was closed. */
  resolvedAt?: string | null;
  /**
   * Evidence the closer cited while resolving the contradiction. Stored as ids
   * (not the documents) so a deleted piece of evidence doesn't leave a
   * dangling copy behind in the record — the ids are filtered on read.
   */
  citedEvidenceIds?: string[];
  createdAt: string;
}

/**
 * A choice in a contradiction's poll. The poll is advisory signal for the
 * people in the room — its tallies never resolve the contradiction.
 */
export type ContradictionVoteChoice = 'CLAIM_A' | 'CLAIM_B' | 'NEITHER';

/**
 * One user's vote in a contradiction's poll. The (relationId, userId) pair is
 * unique, so voting again changes the choice rather than adding a second vote.
 */
export interface ContradictionVote {
  id: string;
  /** The contradiction edge the vote belongs to. */
  relationId: string;
  conversationId: string;
  userId: string;
  userName: string;
  choice: ContradictionVoteChoice;
  createdAt: string;
}

/**
 * A comment or reply in a contradiction's discussion thread. `parentId` is
 * null for a top-level comment and points at the comment being answered for a
 * reply.
 */
export interface DiscussionComment {
  id: string;
  relationId: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  parentId?: string | null;
  createdAt: string;
}

/** A contradiction's human discussion: the comment thread plus the room poll. */
export interface ContradictionDiscussion {
  comments: DiscussionComment[];
  votes: ContradictionVote[];
}

/**
 * One auditable event in a decision's history. Entries are append-only: nothing
 * in the system ever rewrites or removes one, so the timeline is a trustworthy
 * record of how the decision moved.
 */
export type DecisionAction =
  | 'created'
  | 'statement-edited'
  | 'claim-linked'
  | 'claim-unlinked'
  | 'approver-added'
  | 'approver-removed'
  | 'approval-given'
  | 'approval-withdrawn'
  | 'finalized'
  | 'reopened';

export interface DecisionHistoryEntry {
  action: DecisionAction;
  actorId: string;
  actorName: string;
  /** Human-readable detail of what changed and why. */
  detail: string;
  /** Timestamp the entry was recorded. */
  at: string;
}

/**
 * A room's formal decision — the output the evidence gate protects. A decision
 * moves `draft` → `finalized`, and the transition is only permitted once every
 * gate condition is satisfied (see `server/decisions.ts`).
 *
 * Finalization is irreversible from the data's point of view: `reopened`
 * restores `draft` but leaves the original finalization entry in `history`, so
 * nothing is ever silently undone.
 */
export interface Decision {
  id: string;
  /** Room the decision belongs to. */
  conversationId: string;
  /** Short human title. */
  title: string;
  /** The decision statement itself — what the room is committing to. */
  statement: string;
  /**
   * Claims the room has marked as load-bearing for this decision. These are the
   * claims the gate holds to the evidence requirement: each one must carry
   * evidence or an explicit human resolution before the door opens.
   */
  claimIds: string[];
  /**
   * Workspace members whose sign-off the decision requires. The gate is not
   * satisfied until every one of them has an approval on record.
   */
  requiredApproverIds: string[];
  /** Members who have approved so far, newest-first. */
  approvals: DecisionApproval[];
  /** `draft` while the room is still working; `finalized` once the gate passed. */
  status: 'draft' | 'finalized';
  /** Member who created the decision. */
  createdBy: string;
  createdByName: string;
  /** Set the moment the gate passed and the decision locked. */
  finalizedAt?: string | null;
  finalizedBy?: string | null;
  finalizedByName?: string | null;
  /** Append-only audit trail. Never rewritten, never truncated. */
  history: DecisionHistoryEntry[];
  createdAt: string;
}

/** One member of a workspace, for roster displays. */
export interface WorkspaceMember {
  id: string;
  name: string;
}

/** One member's recorded approval of a decision. */
export interface DecisionApproval {
  userId: string;
  userName: string;
  approvedAt: string;
}

/**
 * One reason the gate is currently closed, in plain language the UI can render
 * directly. `kind` groups blockers for styling; the ids let the UI deep-link to
 * the offending claim or contradiction.
 */
export type DecisionBlockerKind =
  | 'claims-unevidenced'
  | 'contradictions-open'
  | 'approvals-missing'
  | 'statement-missing';

export interface DecisionBlocker {
  kind: DecisionBlockerKind;
  /** Complete sentence, safe to show the user verbatim. */
  message: string;
  /** Claim ids this blocker is about, when it is per-claim. */
  claimIds?: string[];
  /** Relation ids this blocker is about, when it is per-contradiction. */
  relationIds?: string[];
  /** Approver ids still outstanding, when it is about approvals. */
  approverIds?: string[];
}

/**
 * The gate's verdict on a decision at a moment in time. `ready` means every
 * condition passed and finalization is permitted *right now*; `blockers` lists
 * exactly what stands in the way otherwise. The server computes this — the
 * frontend only ever displays it.
 */
export interface DecisionGateResult {
  decisionId: string;
  status: 'draft' | 'finalized';
  /** True only when every gate condition is satisfied. */
  ready: boolean;
  /** Every condition that currently fails, empty when `ready`. */
  blockers: DecisionBlocker[];
  /** Counts the UI shows as a progress summary. */
  claimsTotal: number;
  claimsEvidenced: number;
  /** Per-claim verdict so the UI can badge each linked claim individually. */
  claimStatuses: DecisionClaimStatus[];
  contradictionsOpen: number;
  approvalsRequired: number;
  approvalsGiven: number;
}

/**
 * The gate's verdict on one linked claim: whether it currently counts as
 * backed, how many human-attached pieces of evidence sit on it, and — when a
 * closed contradiction is what backs it — the resolution text a human wrote.
 */
export interface DecisionClaimStatus {
  claimId: string;
  backed: boolean;
  evidenceCount: number;
  humanResolution: string | null;
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Decision Replay
 *
 * The room keeps an append-only event stream alongside its claims, evidence,
 * and contradictions. The replay view is a scrubber over that stream: each
 * position shows what happened and what the decision's state was *at that
 * moment*, reconstructed by replaying the events up to it.
 *
 * Two families of event are recorded:
 *  - room events (a prompt, a model reply, a claim extracted, evidence
 *    attached, a contradiction detected or closed, a comment, a vote) which
 *    are the room's own activity, and
 *  - decision events (created, edited, claim linked, approver added,
 *    approved, finalized, reopened) which are also written to the decision's
 *    `history` — the timeline keeps the same facts plus the ids needed to
 *    reconstruct state.
 * ──────────────────────────────────────────────────────────────────────── */

export type TimelineEventKind =
  | 'prompt'
  | 'ai-response'
  | 'claim-extracted'
  | 'contradiction-detected'
  | 'contradiction-resolved'
  | 'evidence-added'
  | 'evidence-deleted'
  | 'comment-added'
  | 'comment-deleted'
  | 'vote-cast'
  | 'decision-created'
  | 'decision-edited'
  | 'decision-claim-linked'
  | 'decision-claim-unlinked'
  | 'decision-approver-added'
  | 'decision-approver-removed'
  | 'decision-approved'
  | 'decision-approval-withdrawn'
  | 'decision-finalized'
  | 'decision-reopened';

export interface TimelineEvent {
  id: string;
  /** Room the event happened in. */
  conversationId: string;
  /** Decision the event belongs to, for the decision's own lifecycle events;
   *  null for room-level events, which are shared by every decision in the
   *  room and claimed by the timeline only when they touch its claims. */
  decisionId?: string | null;
  kind: TimelineEventKind;
  /** When the event occurred. Events are ordered by this, then by id. */
  at: string;
  /** Who or what caused it — a member, or a model name for model events. */
  actorId?: string | null;
  actorName: string;
  /** Short label, e.g. "Evidence attached". */
  title: string;
  /** One-line description, safe to render verbatim in the timeline. */
  detail: string;
  /** Ids this event refers to, used to reconstruct state and to deep-link. */
  messageId?: string | null;
  claimIds?: string[];
  relationId?: string | null;
  evidenceId?: string | null;
  memberIds?: string[];
  /** Kind-specific extras (a vote's choice, an evidence item's title, the
   *  detector's relationship and confidence…). Renderers read these
   *  defensively: an old event from before a field existed simply lacks it. */
  meta?: Record<string, any>;
}

/**
 * The decision's state at one point in the replay, built by the server from
 * the events up to and including that position. The client indexes into this
 * array as the user scrubs, so stepping through the history is pure
 * presentation — no second copy of the truth client-side.
 */
export interface ReplaySnapshot {
  claimsLinked: { id: string; text: string; modelName: string; backed: boolean }[];
  evidenceAttached: { id: string; claimId: string; title: string; aiGenerated: boolean }[];
  /** Contradictions (CONTRADICT edges only, matching the Contradictions panel)
   *  the room has not faced yet at this point. */
  contradictionsOpen: { id: string; claimAText: string; claimBText: string }[];
  contradictionsClosed: {
    id: string;
    claimAText: string;
    claimBText: string;
    status: string;
    resolution: string | null;
    resolvedByName: string | null;
  }[];
  requiredApproverIds: string[];
  approvalsGiven: { userId: string; userName: string; at: string }[];
  status: 'draft' | 'finalized';
  /** Whether the evidence gate would have opened at this moment. This is a
   *  reconstruction of the same rules, not a stored verdict. */
  gateReady: boolean;
}

export interface DecisionReplay {
  decisionId: string;
  /** Events in chronological order — the timeline the user scrubs. */
  events: TimelineEvent[];
  /** `snapshots[i]` is the state after `events[i]`; `snapshots.length ===
   *  events.length`. Empty for a decision with no recorded history. */
  snapshots: ReplaySnapshot[];
}

/**
 * A final decision summary, assembled entirely from the room's stored record.
 * Every field is derived from data the room produced — nothing is inferred or
 * composed by a model. The optional `narrative` is a model restating these
 * fields in prose under a strict no-invention instruction, so the structured
 * sections below remain the authoritative record.
 */
export interface DecisionSummary {
  decisionId: string;
  status: 'draft' | 'finalized';
  /** The question the decision answers — the decision's own title. */
  question: string;
  /** The room the decision was made in, for context. */
  roomTitle: string | null;
  /** What the room committed to. */
  conclusion: string;
  /** Status line: who finalized it and when, or why it is still open. */
  conclusionNote: string;
  keyClaims: { id: string; modelName: string; text: string }[];
  evidence: {
    id: string;
    claimId: string;
    claimText: string;
    title: string;
    kind: string;
    authorName: string | null;
    aiGenerated: boolean;
    createdAt: string;
  }[];
  disagreements: {
    id: string;
    claimAText: string;
    claimBText: string;
    status: string;
    resolution: string | null;
    resolvedByName: string | null;
    resolvedAt: string | null;
  }[];
  /** Claims the decision rests on that no person attached evidence to — the
   *  room chose to proceed anyway, so these are the decision's assumptions. */
  assumptions: string[];
  /** What is still unresolved: open contradictions, unevidenced claims, and
   *  outstanding approvals. Empty once a decision is finalized. */
  remainingUncertainties: string[];
  participants: { id: string; name: string; role: string }[];
  approvalsGiven: { userId: string; userName: string; approvedAt: string }[];
  approvalsOutstanding: string[];
  /** An AI-restated narrative, present only when one was requested and the
   *  model was reachable. Derived solely from the fields above. */
  narrative: string | null;
  narrativeNote: string | null;
}
