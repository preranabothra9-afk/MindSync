/**
 * The Evidence Gate — the rule a room must satisfy before one of its decisions
 * can be finalized.
 *
 * The gate is evaluated on the server, from the database, on every finalize
 * attempt. The frontend is given the same verdict to display, but it is never
 * trusted to make the call: a client that skips the check and POSTs directly to
 * the finalize route is still refused by the route's own evaluation.
 *
 * Three conditions, all of which must hold:
 *
 * 1. Every decision-relevant claim is backed — it carries at least one piece of
 *    evidence, or it has been cleared by an explicit human resolution of a
 *    contradiction it was part of. A claim can satisfy the requirement either
 *    way; an unevidenced claim that no human ever adjudicated does not.
 * 2. No open contradictions remain among the decision's claims. A `detected`
 *    edge is an unresolved disagreement the room has not faced yet.
 * 3. Every required approval has been given.
 *
 * The detector's confidence and the poll tally are deliberately not inputs
 * here, for the same reason they cannot close a contradiction: the room decides,
 * the models advise.
 */
import type {
  Claim,
  ClaimRelation,
  Decision,
  DecisionBlocker,
  DecisionGateResult,
  DecisionHistoryEntry,
  DecisionReplay,
  DecisionSummary,
  Evidence,
  ReplaySnapshot,
  TimelineEvent,
  TimelineEventKind,
  WorkspaceMember
} from '../src/types';

/**
 * A claim counts as backed when it carries evidence a person attached — a link,
 * a file, a quote, or a note.
 *
 * AI-generated references deliberately do NOT count. A model's citation is its
 * own reading of a response it wrote, never proof: models hallucinate sources,
 * and the whole point of the gate is to stop a decision from resting on a
 * model's say-so. An AI reference is a lead to check, not evidence the gate
 * accepts. A room that wants to stand behind such a claim has to either attach
 * something real to it or resolve the contradiction around it out loud — both
 * are explicit human acts, which is exactly what the gate is asking for.
 */
function hasEvidence(claim: Claim, evidenceByClaim: Record<string, Evidence[]>): boolean {
  const items = evidenceByClaim[claim.id] ?? [];
  return items.some((e) => !e.aiGenerated);
}

/**
 * A claim counts as human-resolved when a *contradiction* it participates in
 * was closed by a person (resolved / evidence-needed / dismissed). Any closed
 * status is an explicit human act — the room faced the disagreement and decided
 * what to do about it, which is what the gate is asking for.
 *
 * Only CONTRADICT edges count. SUPPORT and RELATED edges are context the graph
 * records, not disagreements: SUPPORT means two claims agree, and RELATED means
 * the detector saw a thematic link without a clash. Neither is something a
 * person adjudicates, so neither can back a claim.
 */
function isHumanResolved(claim: Claim, relations: ClaimRelation[]): boolean {
  const CLOSED = ['resolved', 'evidence-needed', 'dismissed'];
  return relations.some(
    (r) =>
      r.relationship === 'CONTRADICT' &&
      CLOSED.includes(r.status) &&
      (r.claimAId === claim.id || r.claimBId === claim.id)
  );
}

/**
 * The gate verdict for one decision, computed entirely from room state.
 *
 * Returns `ready: true` only when every condition passes and there is at least
 * one claim to decide on — a decision with no claims is not ready because there
 * is nothing to have weighed. Every blocker carries a plain-language message the
 * UI can render verbatim, plus the ids of whatever it is about so the client can
 * deep-link to the offending claim or contradiction.
 */
export function evaluateDecisionGate(
  decision: Decision,
  claims: Claim[],
  relations: ClaimRelation[],
  evidenceByClaim: Record<string, Evidence[]>
): DecisionGateResult {
  const blockers: DecisionBlocker[] = [];

  // A decision rests on its claims; an empty decision has decided nothing.
  const decisionClaims = decision.claimIds
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is Claim => Boolean(c));

  if (decisionClaims.length === 0) {
    blockers.push({
      kind: 'statement-missing',
      message:
        'Link at least one claim from this room — a decision has to state what it rests on.'
    });
  }

  // ── Condition 1: every decision-relevant claim is backed. ──────────────
  // A claim missing from the room (deleted since the decision was drafted) is
  // treated as unevidenced: its support cannot be verified, so the gate stays
  // closed until the decision is re-based on claims that still exist.
  const unevidenced = decisionClaims.filter(
    (c) => !hasEvidence(c, evidenceByClaim) && !isHumanResolved(c, relations)
  );
  if (unevidenced.length > 0) {
    blockers.push({
      kind: 'claims-unevidenced',
      message: `${unevidenced.length} linked claim${unevidenced.length === 1 ? '' : 's'} ${unevidenced.length === 1 ? 'still needs' : 'still need'} evidence (a link, file, quote, or note you attached) or an explicit human resolution. An AI reference alone does not count — verify it first.`,
      claimIds: unevidenced.map((c) => c.id)
    });
  }

  // ── Condition 2: no open contradictions among the decision's claims. ────
  // Only CONTRADICT edges count. SUPPORT and RELATED edges are context the
  // graph records, not disagreements the room must adjudicate: SUPPORT means
  // two claims agree, RELATED means the detector saw a thematic link without a
  // clash. Blocking on one would demand adjudication of something the
  // Contradictions list never presents as a contradiction — an unreachable
  // gate. This mirrors the ClaimsPanel's own definition of a contradiction.
  const decisionClaimIds = new Set(decisionClaims.map((c) => c.id));
  const open = relations.filter(
    (r) =>
      r.relationship === 'CONTRADICT' &&
      r.status === 'detected' &&
      (decisionClaimIds.has(r.claimAId) || decisionClaimIds.has(r.claimBId))
  );
  if (open.length > 0) {
    blockers.push({
      kind: 'contradictions-open',
      message: `${open.length} contradiction${open.length === 1 ? '' : 's'} among the linked claims ${open.length === 1 ? 'is' : 'are'} still unresolved — resolve or dismiss ${open.length === 1 ? 'it' : 'them'} first.`,
      relationIds: open.map((r) => r.id)
    });
  }

  // ── Condition 3: every required approval is on record. ─────────────────
  const approvedIds = new Set(decision.approvals.map((a) => a.userId));
  const outstanding = decision.requiredApproverIds.filter((id) => !approvedIds.has(id));
  if (outstanding.length > 0) {
    blockers.push({
      kind: 'approvals-missing',
      message: `${outstanding.length} required approval${outstanding.length === 1 ? '' : 's'} still outstanding.`,
      approverIds: outstanding
    });
  }

  const claimsTotal = decisionClaims.length;
  const claimsEvidenced = decisionClaims.filter(
    (c) => hasEvidence(c, evidenceByClaim) || isHumanResolved(c, relations)
  ).length;

  // Per-claim verdict, so the UI can mark each linked claim individually rather
  // than only surfacing a count. `backedBy` names what satisfies it, in the
  // room's own words, so a member reading the list knows what stands behind
  // each claim and what still needs work.
  const claimStatuses = decisionClaims.map((c) => {
    const humanEvidence = (evidenceByClaim[c.id] ?? []).filter((e) => !e.aiGenerated);
    // Only a closed *contradiction* counts as a human resolution — see
    // isHumanResolved above.
    const closedRelation = relations.find(
      (r) =>
        r.relationship === 'CONTRADICT' &&
        (r.claimAId === c.id || r.claimBId === c.id) &&
        r.status !== 'detected'
    );
    return {
      claimId: c.id,
      backed: humanEvidence.length > 0 || !!closedRelation,
      evidenceCount: humanEvidence.length,
      humanResolution: closedRelation ? closedRelation.resolution : null
    };
  });

  return {
    decisionId: decision.id,
    status: decision.status,
    ready: blockers.length === 0,
    blockers,
    claimsTotal,
    claimsEvidenced,
    claimStatuses,
    contradictionsOpen: open.length,
    approvalsRequired: decision.requiredApproverIds.length,
    approvalsGiven: decision.approvals.length
  };
}

/* ───────────────────────────────────────────────────────────────────────── *
 * Decision Replay
 *
 * The replay is a presentation layer over the room's append-only event
 * stream. Nothing here mutates the record: `buildDecisionReplay` reads the
 * events the routes already recorded and folds them, in order, into a state
 * at each point. The gate shown in a snapshot is a *reconstruction* of the
 * same rules `evaluateDecisionGate` applies — it is deliberately not stored,
 * so it can never disagree with the room's actual state.
 * ───────────────────────────────────────────────────────────────────────── */

const HISTORY_ACTION_TO_KIND: Record<DecisionHistoryEntry['action'], TimelineEventKind> = {
  'created': 'decision-created',
  'statement-edited': 'decision-edited',
  'claim-linked': 'decision-claim-linked',
  'claim-unlinked': 'decision-claim-unlinked',
  'approver-added': 'decision-approver-added',
  'approver-removed': 'decision-approver-removed',
  'approval-given': 'decision-approved',
  'approval-withdrawn': 'decision-approval-withdrawn',
  'finalized': 'decision-finalized',
  'reopened': 'decision-reopened'
};

const HISTORY_ACTION_LABEL: Record<DecisionHistoryEntry['action'], string> = {
  'created': 'Decision created',
  'statement-edited': 'Decision edited',
  'claim-linked': 'Claim linked',
  'claim-unlinked': 'Claim unlinked',
  'approver-added': 'Approver added',
  'approver-removed': 'Approver removed',
  'approval-given': 'Approved',
  'approval-withdrawn': 'Approval withdrawn',
  'finalized': 'Finalized',
  'reopened': 'Reopened'
};

export function historyActionToTimelineKind(action: DecisionHistoryEntry['action']): TimelineEventKind {
  return HISTORY_ACTION_TO_KIND[action] ?? 'decision-edited';
}

export function historyActionLabel(action: DecisionHistoryEntry['action']): string {
  return HISTORY_ACTION_LABEL[action] ?? action;
}

/**
 * An event belongs on a decision's timeline when it is one of that decision's
 * own lifecycle events, or when it is a room event that touched one of the
 * claims the decision ultimately rests on — the prompt a claim was mined
 * from, the contradiction it was caught in, the evidence a person pinned to
 * it, the vote and the comment on its contradiction. Room events that never
 * touched those claims are another decision's story, not this one's.
 *
 * The story is not clipped at the decision's creation. The claims a decision
 * rests on are usually mined, evidenced and contradicted long before anyone
 * drafts the decision, and the gate at creation already accounted for that
 * evidence and those open contradictions — so excluding them would make the
 * reconstruction disagree with the gate the room actually faced. The upper
 * bound is kept: nothing after a finalization belongs on a closed record,
 * unless the room reopens it (which nulls `finalizedAt` and reopens the
 * window).
 */
function isEventRelevant(
  event: TimelineEvent,
  decision: Decision,
  linkedClaimIds: Set<string>,
  relevantMessageIds: Set<string>,
  relevantRelationIds: Set<string>
): boolean {
  if (event.decisionId === decision.id) return true;
  if (event.decisionId) return false; // another decision's lifecycle event
  const to = decision.finalizedAt;
  if (to && event.at > to) return false;
  if (event.messageId && relevantMessageIds.has(event.messageId)) return true;
  if (event.relationId && relevantRelationIds.has(event.relationId)) return true;
  if (event.claimIds && event.claimIds.some((id) => linkedClaimIds.has(id))) return true;
  return false;
}

/**
 * Folds the events into a state at every position. Each accumulator mirrors
 * one part of the decision: the claims it rests on, the evidence behind them,
 * the contradictions still open or since closed, the approvals it needs. The
 * gate verdict is recomputed per snapshot from those accumulators, so
 * scrubbing shows the room exactly when the door would have opened.
 */
export function buildDecisionReplay(
  decision: Decision,
  claims: Claim[],
  relations: ClaimRelation[],
  events: TimelineEvent[]
): DecisionReplay {
  const claimById = new Map(claims.map((c) => [c.id, c] as const));
  const relationById = new Map(relations.map((r) => [r.id, r] as const));

  const linkedClaimIds = new Set(decision.claimIds);
  const relevantMessageIds = new Set(
    claims.filter((c) => linkedClaimIds.has(c.id)).map((c) => c.messageId)
  );
  const relevantRelationIds = new Set(
    relations
      .filter((r) => linkedClaimIds.has(r.claimAId) || linkedClaimIds.has(r.claimBId))
      .map((r) => r.id)
  );

  const timeline = events
    .filter((e) =>
      isEventRelevant(e, decision, linkedClaimIds, relevantMessageIds, relevantRelationIds)
    )
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));

  // ── accumulators ──────────────────────────────────────────────────────
  // The internal shapes keep the endpoints' *ids* as well as their texts: the
  // ids are what the gate reconstruction matches a closed contradiction on,
  // the texts are what the client renders. Projection at snapshot time keeps
  // the ids server-side, so no claim is ever matched by wording alone.
  const linked = new Map<string, { id: string; text: string; modelName: string }>();
  const evidence = new Map<string, { id: string; claimId: string; title: string; aiGenerated: boolean }>();
  const open = new Map<string, { id: string; claimAId: string; claimBId: string; claimAText: string; claimBText: string }>();
  const closed = new Map<string, {
    id: string;
    claimAId: string;
    claimBId: string;
    claimAText: string;
    claimBText: string;
    status: string;
    resolution: string | null;
    resolvedByName: string | null;
  }>();
  let requiredApproverIds: string[] = [];
  const approvals = new Map<string, { userId: string; userName: string; at: string }>();
  let status: 'draft' | 'finalized' = 'draft';

  const applyEvent = (event: TimelineEvent): void => {
    switch (event.kind) {
      // A decision is created already resting on its claims and already naming
      // its approvers — both ride on the creation event, so the fold starts
      // where the record actually started instead of at an empty room. Without
      // this the replay could never show the claims a decision was built on.
      case 'decision-created':
        for (const id of event.memberIds ?? []) if (!requiredApproverIds.includes(id)) requiredApproverIds.push(id);
      // fallthrough: seed the linked claims exactly as `decision-claim-linked`
      // would, so later link/unlink events compose on top of the starting set.
      case 'decision-claim-linked':
        for (const id of event.claimIds ?? []) {
          const c = claimById.get(id);
          const meta = event.meta?.claims as Array<{ id: string; text: string; modelName: string }> | undefined;
          const fromMeta = meta?.find((m) => m.id === id);
          // Prefer the event's own copy: the claim may have been deleted since,
          // and the record should still say what the room linked.
          linked.set(id, { id, text: fromMeta?.text ?? c?.text ?? 'a deleted claim', modelName: fromMeta?.modelName ?? c?.modelName ?? 'a model' });
        }
        break;
      case 'decision-claim-unlinked':
        for (const id of event.claimIds ?? []) linked.delete(id);
        break;
      case 'decision-approver-added':
        for (const id of event.memberIds ?? []) if (!requiredApproverIds.includes(id)) requiredApproverIds.push(id);
        break;
      case 'decision-approver-removed':
        requiredApproverIds = requiredApproverIds.filter((id) => !(event.memberIds ?? []).includes(id));
        break;
      case 'decision-approved':
        if (event.actorId) approvals.set(event.actorId, { userId: event.actorId, userName: event.actorName, at: event.at });
        break;
      case 'decision-approval-withdrawn':
        if (event.actorId) approvals.delete(event.actorId);
        break;
      case 'decision-finalized':
        status = 'finalized';
        break;
      case 'decision-reopened':
        status = 'draft';
        break;
      case 'evidence-added': {
        const claimId = (event.claimIds ?? [])[0] ?? null;
        evidence.set(event.evidenceId ?? event.id, {
          id: event.evidenceId ?? event.id,
          claimId: claimId ?? '',
          title: (event.meta?.title as string) ?? 'evidence',
          aiGenerated: Boolean(event.meta?.aiGenerated)
        });
        break;
      }
      case 'evidence-deleted':
        evidence.delete(event.evidenceId ?? event.id);
        break;
      case 'contradiction-detected': {
        // Only a CONTRADICT is an open disagreement the room must face. SUPPORT
        // and RELATED are recorded as context but never count against the gate.
        if ((event.meta?.relationship as string) !== 'CONTRADICT') break;
        const rel = event.relationId ? relationById.get(event.relationId) : undefined;
        const [aId, bId] = event.claimIds ?? [rel?.claimAId ?? '', rel?.claimBId ?? ''];
        open.set(event.relationId ?? event.id, {
          id: event.relationId ?? event.id,
          claimAId: aId,
          claimBId: bId,
          claimAText: (event.meta?.claimAText as string) ?? rel?.claimAText ?? 'a deleted claim',
          claimBText: (event.meta?.claimBText as string) ?? rel?.claimBText ?? 'a deleted claim'
        });
        break;
      }
      case 'contradiction-resolved': {
        const key = event.relationId ?? event.id;
        const existing = open.get(key);
        const rel = event.relationId ? relationById.get(event.relationId) : undefined;
        const ids = event.claimIds ??
          (existing ? [existing.claimAId, existing.claimBId] : [rel?.claimAId ?? '', rel?.claimBId ?? '']);
        closed.set(key, {
          id: key,
          claimAId: existing?.claimAId ?? ids[0],
          claimBId: existing?.claimBId ?? ids[1],
          claimAText: (event.meta?.claimAText as string) ?? existing?.claimAText ?? rel?.claimAText ?? 'a deleted claim',
          claimBText: (event.meta?.claimBText as string) ?? existing?.claimBText ?? rel?.claimBText ?? 'a deleted claim',
          status: (event.meta?.status as string) ?? 'resolved',
          resolution: (event.meta?.resolution as string) ?? null,
          resolvedByName: (event.meta?.resolvedByName as string) ?? event.actorName ?? null
        });
        open.delete(key);
        break;
      }
      default:
        // prompt, ai-response, claim-extracted, comment-*, vote-cast,
        // decision-created/edited: context for the timeline, not state change.
        break;
    }
  };

  const snapshotFor = (): ReplaySnapshot => {
    const isHumanResolved = (claimId: string): boolean =>
      [...closed.values()].some((c) => c.claimAId === claimId || c.claimBId === claimId);

    const hasHumanEvidence = (claimId: string): boolean =>
      [...evidence.values()].some((e) => e.claimId === claimId && !e.aiGenerated);

    const claimsLinked = [...linked.values()].map((c) => ({
      ...c,
      backed: hasHumanEvidence(c.id) || isHumanResolved(c.id)
    }));

    const gateReady =
      claimsLinked.length > 0 &&
      claimsLinked.every((c) => c.backed) &&
      open.size === 0 &&
      requiredApproverIds.every((id) => approvals.has(id));

    return {
      claimsLinked,
      evidenceAttached: [...evidence.values()],
      contradictionsOpen: [...open.values()].map((o) => ({
        id: o.id,
        claimAText: o.claimAText,
        claimBText: o.claimBText
      })),
      contradictionsClosed: [...closed.values()].map((c) => ({
        id: c.id,
        claimAText: c.claimAText,
        claimBText: c.claimBText,
        status: c.status,
        resolution: c.resolution,
        resolvedByName: c.resolvedByName
      })),
      requiredApproverIds: [...requiredApproverIds],
      approvalsGiven: [...approvals.values()],
      status,
      gateReady
    };
  };

  const snapshots: ReplaySnapshot[] = [];
  for (const event of timeline) {
    applyEvent(event);
    snapshots.push(snapshotFor());
  }

  return { decisionId: decision.id, events: timeline, snapshots };
}

/* ───────────────────────────────────────────────────────────────────────── *
 * The final decision summary.
 *
 * Every field below is read off the room's stored record — the decision, its
 * claims, the evidence on them, the contradictions between them, the
 * approvals on the decision. Nothing is composed or inferred by a model; a
 * model may only restate these fields, under `buildSummaryNarrationPrompt`.
 * ───────────────────────────────────────────────────────────────────────── */

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'an unrecorded time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) + ' UTC';
}

const CLOSE_LABEL: Record<string, string> = {
  resolved: 'resolved in favour of one side',
  'evidence-needed': 'closed pending more evidence',
  dismissed: 'dismissed as not worth adjudicating'
};

export function buildDecisionSummary(
  decision: Decision,
  roomTitle: string | null,
  claims: Claim[],
  relations: ClaimRelation[],
  evidenceByClaim: Record<string, Evidence[]>,
  members: WorkspaceMember[]
): DecisionSummary {
  const memberName = (id: string): string =>
    members.find((m) => m.id === id)?.name ?? 'a member';

  const linkedClaims = decision.claimIds
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is Claim => Boolean(c));

  const linkedIds = new Set(linkedClaims.map((c) => c.id));

  // Contradictions among the linked claims only — SUPPORT and RELATED edges
  // are context, not disagreements, and never appear as one here.
  const contradictions = relations.filter(
    (r) => r.relationship === 'CONTRADICT' && (linkedIds.has(r.claimAId) || linkedIds.has(r.claimBId))
  );

  const humanEvidence = linkedClaims.flatMap((c) =>
    (evidenceByClaim[c.id] ?? [])
      .filter((e) => !e.aiGenerated)
      .map((e) => ({
        id: e.id,
        claimId: c.id,
        claimText: c.text,
        title: e.title,
        kind: e.kind,
        authorName: e.authorName,
        aiGenerated: false,
        createdAt: e.createdAt
      }))
  );

  const gate = evaluateDecisionGate(decision, claims, relations, evidenceByClaim);
  const finalized = decision.status === 'finalized';

  // Assumptions: claims the decision rests on that no person attached
  // evidence to. The gate passed for them anyway — which can only be because
  // the room closed their contradiction out loud, so each is annotated with
  // how the room cleared it, in the room's own words.
  const assumptions = linkedClaims
    .filter((c) => !(evidenceByClaim[c.id] ?? []).some((e) => !e.aiGenerated))
    .map((c) => {
      const closedRel = contradictions.find(
        (r) => (r.claimAId === c.id || r.claimBId === c.id) && r.status !== 'detected'
      );
      const how = closedRel
        ? `${CLOSE_LABEL[closedRel.status] ?? 'closed'} by ${closedRel.resolvedByName ?? 'a member'}: “${closedRel.resolution ?? 'no reason recorded'}”`
        : 'no evidence on record';
      return `“${c.text}” — accepted without attached evidence (${how}).`;
    });

  // Remaining uncertainties, straight off the gate's blocker list so the
  // summary and the gate can never disagree about what is open. Empty for a
  // finalized decision by construction.
  const remainingUncertainties: string[] = [];
  for (const b of gate.blockers) {
    if (b.kind === 'contradictions-open') {
      for (const rid of b.relationIds ?? []) {
        const r = relations.find((x) => x.id === rid);
        if (r) remainingUncertainties.push(`“${r.claimAText}” and “${r.claimBText}” still contradict each other.`);
      }
    } else if (b.kind === 'claims-unevidenced') {
      for (const cid of b.claimIds ?? []) {
        const c = claims.find((x) => x.id === cid);
        if (c) remainingUncertainties.push(`“${c.text}” has no evidence attached.`);
      }
    } else if (b.kind === 'approvals-missing') {
      const names = (b.approverIds ?? []).map((id) => memberName(id));
      if (names.length) remainingUncertainties.push(`Approval still outstanding from ${names.join(', ')}.`);
    } else if (b.kind === 'statement-missing') {
      remainingUncertainties.push('The decision does not yet rest on any claim.');
    }
  }

  // Participants: everyone whose hand is on the record, each named once with
  // every role they played.
  const byRole = new Map<string, { name: string; roles: Set<string> }>();
  const addParticipant = (id: string | null | undefined, name: string, role: string): void => {
    if (!id && !name) return;
    const key = id ?? name;
    const existing = byRole.get(key);
    if (existing) existing.roles.add(role);
    else byRole.set(key, { name: name || id || 'a member', roles: new Set([role]) });
  };
  addParticipant(decision.createdBy, decision.createdByName, 'Author');
  for (const a of decision.approvals) addParticipant(a.userId, a.userName, 'Approved');
  for (const id of decision.requiredApproverIds) {
    if (!decision.approvals.some((a) => a.userId === id)) addParticipant(id, memberName(id), 'Approver — pending');
  }
  for (const e of humanEvidence) addParticipant(null, e.authorName ?? 'a member', 'Attached evidence');
  for (const r of contradictions) {
    if (r.status !== 'detected' && r.resolvedByName) addParticipant(r.resolvedBy, r.resolvedByName, 'Resolved a disagreement');
  }

  const approvedIds = new Set(decision.approvals.map((a) => a.userId));
  const approvalsOutstanding = decision.requiredApproverIds
    .filter((id) => !approvedIds.has(id))
    .map((id) => memberName(id));

  const conclusionNote = finalized
    ? `Finalized by ${decision.finalizedByName ?? 'a member'} on ${formatWhen(decision.finalizedAt)}.`
    : gate.blockers.length === 0
      ? 'Ready to finalize — every gate condition is satisfied.'
      : `Still a draft; ${gate.blockers.length} gate condition${gate.blockers.length === 1 ? '' : 's'} outstanding.`;

  return {
    decisionId: decision.id,
    status: decision.status,
    question: decision.title,
    roomTitle,
    conclusion: decision.statement,
    conclusionNote,
    keyClaims: linkedClaims.map((c) => ({ id: c.id, modelName: c.modelName, text: c.text })),
    evidence: humanEvidence,
    disagreements: contradictions.map((r) => ({
      id: r.id,
      claimAText: r.claimAText,
      claimBText: r.claimBText,
      status: r.status,
      resolution: r.resolution,
      resolvedByName: r.resolvedByName,
      resolvedAt: r.resolvedAt
    })),
    assumptions,
    remainingUncertainties,
    participants: [...byRole.entries()].map(([key, v]) => ({ id: key, name: v.name, role: [...v.roles].join(', ') })),
    approvalsGiven: decision.approvals.map((a) => ({
      userId: a.userId,
      userName: a.userName,
      approvedAt: a.approvedAt
    })),
    approvalsOutstanding,
    narrative: null,
    narrativeNote: null
  };
}

/**
 * Composes the prompt that asks a model to *restate* a summary in prose.
 *
 * Grounding is structural rather than hoped for: the model receives the
 * summary's own fields as its only allowed source, and an instruction that
 * forbids adding facts, dates, names, evidence, or conclusions. If a section
 * is empty the model must say so plainly rather than fill it in. The
 * resulting text is labelled a restatement, never the record.
 */
export function buildSummaryNarrationPrompt(summary: DecisionSummary): string {
  const lines: string[] = [];
  const push = (heading: string, items: string[]): void => {
    lines.push(heading);
    if (items.length === 0) lines.push('(none recorded)');
    else items.forEach((it, i) => lines.push(`${i + 1}. ${it}`));
    lines.push('');
  };

  lines.push('RECORD (extracted verbatim from the workspace store):');
  lines.push('');
  lines.push(`Question: ${summary.question}`);
  if (summary.roomTitle) lines.push(`Room: ${summary.roomTitle}`);
  lines.push(`Conclusion: ${summary.conclusion}`);
  lines.push(`Status: ${summary.status} — ${summary.conclusionNote}`);
  lines.push('');
  push('Key claims:', summary.keyClaims.map((c) => `[${c.modelName}] ${c.text}`));
  push('Evidence:', summary.evidence.map((e) => `${e.title} (${e.kind}) — attached by ${e.authorName ?? 'a member'} to “${e.claimText}”`));
  push('Disagreements and their resolutions:', summary.disagreements.map((d) => `“${d.claimAText}” vs “${d.claimBText}” — ${d.status}${d.resolution ? `; “${d.resolution}”` : ''}${d.resolvedByName ? ` (by ${d.resolvedByName})` : ''}`));
  push('Assumptions:', summary.assumptions);
  push('Remaining uncertainties:', summary.remainingUncertainties);
  push('Participants:', summary.participants.map((p) => `${p.name} — ${p.role}`));
  push('Approvals given:', summary.approvalsGiven.map((a) => `${a.userName} on ${formatWhen(a.approvedAt)}`));
  if (summary.approvalsOutstanding.length) push('Approvals outstanding:', summary.approvalsOutstanding);

  return [
    'You are restating a team decision record as a short, readable brief.',
    'The RECORD below is the ONLY information you may use — it was read',
    'verbatim from the team\'s stored workspace data.',
    '',
    'ABSOLUTE RULES:',
    '- Restate the record in clear prose. Do NOT add anything.',
    '- Do not invent events, dates, people, claims, evidence, outcomes, or',
    '  reasoning that is not written in the record.',
    '- Do not judge the decision\'s merits or speculate about why people chose',
    '  as they did; report what the record says they did.',
    '- Do not use outside knowledge about any technology or topic mentioned.',
    '- Where the record says "(none recorded)", say plainly that there was',
    '  none. Never fill an empty section in.',
    '- Keep the room\'s own wording for claims, evidence, and resolutions.',
    '- Answer in under 300 words, as prose with short sections headed the same',
    '  way the record is.',
    '',
    lines.join('\n')
  ].join('\n');
}
