/**
 * Decision context — the bounded slice of a room's record a model is allowed
 * to answer record questions from.
 *
 * The room already stores everything a "what did we decide" question needs:
 * messages, claims, contradictions and their discussions, polls, evidence,
 * resolutions, approvals, and decision state. Until now the model only ever saw
 * a handful of chat excerpts and claims, so a question like "what did we
 * disagree about?" had almost no grounding — the record existed, it just was
 * never read.
 *
 * This module reads it and renders it as one prompt block. Three properties
 * matter, and they are enforced structurally rather than hoped for:
 *
 * 1. **Relevant.** Only sections the question asks for are guaranteed a
 *    showing; anything else contributes only items whose own text overlaps the
 *    question. A room that asks about its disagreements does not also get
 *    shipped every decision it ever made.
 * 2. **Bounded.** Each section has an item count cap and the whole block has a
 *    character budget. Sections that lose the budget race are dropped from the
 *    least-relevant end, and truncation is announced ("showing 3 of 12") so the
 *    model can say the record was sliced instead of implying it is complete.
 * 3. **Grounded.** Every line is assembled from stored fields, quoted in the
 *    room's own words, under instructions that forbid inventing anything or
 *    filling an empty section.
 *
 * Nothing here is model-generated. There is no LLM call on this path — the
 * block is a deterministic projection of the database, which is why it can be
 * trusted to be true.
 */
import { db } from './database';
import { evaluateDecisionGate } from './decisions';
import type {
  Claim,
  ClaimRelation,
  ContradictionDiscussion,
  Decision,
  Evidence,
  WorkspaceMember
} from '../src/types';

/** Everything the renderer is given. Already bounded by the loader. */
export interface DecisionMemory {
  decisions: Decision[];
  claims: Claim[];
  relations: ClaimRelation[];
  evidenceByClaim: Record<string, Evidence[]>;
  discussions: Record<string, ContradictionDiscussion>;
  members: WorkspaceMember[];
}

/** Character budget for the whole block, rules header included. */
export const MAX_DECISION_CONTEXT_CHARS = 2600;

/** Per-section item caps. Small on purpose: ranking decides *which*, never how many. */
const MAX_DECISIONS = 3;
const MAX_CONTRADICTIONS = 3;
const MAX_EVIDENCE = 4;
const MAX_OPEN = 4;
const MAX_CLAIMS = 4;
const MAX_COMMENTS_PER_THREAD = 2;
const MAX_EXCERPT = 240;
const MAX_CLAIM_EXCERPT = 200;

/** Query bounds, so a huge room costs the same as a small one. */
const MAX_QUERY_DECISIONS = 8;
const MAX_QUERY_CLAIMS = 40;
const MAX_QUERY_RELATIONS = 60;

/**
 * The four things a room's record holds that people actually ask about. These
 * are *intent* classes derived from the question's own words, not from the
 * stored data — which is what lets the block answer "What did we disagree
 * about?" even when the room never wrote the word "disagree" anywhere.
 */
export type MemoryIntent = 'disagreement' | 'evidence' | 'decision' | 'uncertainty';

const INTENT_PATTERNS: ReadonlyArray<readonly [MemoryIntent, RegExp]> = [
  [
    'disagreement',
    /\b(disagree\w*|disput\w*|conflict\w*|contradict\w*|clash\w*|debate\w*|argument\w*|objection\w*|differ\w*|inconsisten\w*|objections?)\b/i
  ],
  [
    'evidence',
    /\b(evidence|evidenc\w*|proof|sources?|sources|cited?|cites|citation[s]?|backed|backing|resolve[sd]?|resolution[s]?|support(ed|ing|s)?|verif\w+|corroborat\w*|disprove[ds]?)\b/i
  ],
  [
    'decision',
    /\b(decid\w*|choose|chose|chosen|choices?|why|because|rationale|justif\w+|final\w*|approv\w*|conclusions?|consensus|agree[ds]?|settled?)\b/i
  ],
  [
    'uncertainty',
    /\b(uncertain\w*|unclear|unknown[sd]?|assum\w*|risks?|pending|outstanding|unresolved|remaining|remain\w*|still|uncertain|gaps?|doubt[s]?|unsure)\b/i
  ]
];

/**
 * Word tokens that carry no meaning for matching. Length is already doing a
 * lot of work (see `termSet`), so this list only needs to catch the frequent
 * words that survive the length filter.
 */
const STOP_WORDS = new Set(
  (
    'the and for with this that these those what when where which while whom about into ' +
    'from then than them they their there here have has had been being was were are you ' +
    'your yours our ours my mine me it its not but or if as at by to of in on an a can ' +
    'could would should will shall may might must do does did done just also very more most ' +
    'some any all each other such same so does didnt dont'
  ).split(' ')
);

/** Tokens of a question worth matching against stored text: length >= 4, no stopwords. */
export function termSet(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [];
  return new Set(words.filter((w) => !STOP_WORDS.has(w)));
}

/** Which record intents this question is asking for. May be empty. */
export function detectIntents(question: string): MemoryIntent[] {
  const found: MemoryIntent[] = [];
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(question) && !found.includes(intent)) found.push(intent);
  }
  return found;
}

/** How many of the question's terms appear in this text. Cheap lexical overlap. */
function overlap(haystack: string, terms: Set<string>): number {
  if (terms.size === 0) return 0;
  const words = new Set(haystack.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? []);
  let hits = 0;
  for (const t of terms) if (words.has(t)) hits += 1;
  return hits;
}

interface Scored<T> {
  item: T;
  score: number;
  at: string;
}

/** Most relevant first; ties broken by newest, so an old argument doesn't outrank a fresh one. */
function rank<T>(items: T[], textOf: (item: T) => string, atOf: (item: T) => string, terms: Set<string>): Scored<T>[] {
  return items
    .map((item) => ({ item, score: overlap(textOf(item), terms), at: atOf(item) || '' }))
    .sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * Keeps up to `limit` of an already-ranked list.
 *
 * `ensure` decides whether the section is filled even when the question's words
 * do not appear in it. Without that, "What did we disagree about?" could come
 * back empty purely because the room never wrote the word "disagree" in any
 * claim — so a section the question asked for is always filled (recency
 * breaking ties), and a section it did not ask for only contributes items the
 * question actually touches.
 */
function pick<T>(ranked: Scored<T>[], limit: number, ensure: boolean): T[] {
  const kept = ensure ? ranked : ranked.filter((r) => r.score > 0);
  return kept.slice(0, limit).map((r) => r.item);
}

/** Truncates at a word boundary; excerpts never cut mid-word. */
function clip(text: string, limit = MAX_EXCERPT): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0, limit);
  const space = slice.lastIndexOf(' ');
  return (space > limit * 0.6 ? slice.slice(0, space) : slice).trimEnd() + '…';
}

function day(iso?: string | null): string {
  if (!iso) return 'date not recorded';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'date not recorded' : d.toISOString().slice(0, 10);
}

/** Human labels for an edge's lifecycle. `detected` is the only open state. */
const EDGE_STATUS: Record<string, string> = {
  detected: 'OPEN — nobody has closed it yet',
  resolved: 'resolved',
  'evidence-needed': 'closed by the room as "we need more evidence"',
  dismissed: 'dismissed'
};

const RELATIONSHIP: Record<string, string> = {
  CONTRADICT: 'contradicts',
  SUPPORT: 'supports',
  RELATED: 'is related to'
};

/** Only CONTRADICT edges are disagreements — same definition the panel and the gate use. */
function isContradiction(r: ClaimRelation): boolean {
  return r.relationship === 'CONTRADICT';
}

interface Section {
  name: string;
  /** True when the question asked for this section, so it is guaranteed a showing. */
  requested: boolean;
  /** How many items of this kind the room holds, for honest "showing N of M". */
  total: number;
  items: string[];
  order: number;
}

const RULES: string[] = [
  "## Decision record (read verbatim from this room's MindSync store)",
  '',
  'The blocks below are the ONLY source of truth about what this room decided,',
  'disagreed about, evidenced, or left open.',
  '',
  'ABSOLUTE RULES:',
  '- Answer from this record alone. Never invent earlier events, claims,',
  '  evidence, disagreements, approvals, people, dates, or decisions.',
  '- Do not use outside knowledge about the topic, and do not guess what',
  '  anyone "probably" thought or intended.',
  "- Keep the room's own wording for claims, evidence, and resolutions.",
  '- If the record does not contain the answer, say plainly that it is not',
  '  recorded here rather than filling the gap with a plausible story.',
  '- A section reading "(none recorded)" was genuinely empty. Report it empty.',
  '- "showing N of M" means the record was sliced for relevance; say so',
  '  instead of implying M is irrelevant or that N is everything.',
  '- A poll tally is the room advice, never the outcome. Only a recorded',
  '  resolution, dismissal, or finalization is an outcome.'
];

function renderDecision(d: Decision, mem: DecisionMemory): string {
  const gate = evaluateDecisionGate(d, mem.claims, mem.relations, mem.evidenceByClaim);

  const approved = d.approvals.map((a) => a.userName);
  const outstanding = d.requiredApproverIds
    .filter((id) => !d.approvals.some((a) => a.userId === id))
    .map((id) => mem.members.find((m) => m.id === id)?.name ?? 'an unnamed member');

  const lines: string[] = [];
  lines.push(`**${d.title}** — ${clip(d.statement, 320)}`);
  lines.push(
    d.status === 'finalized'
      ? `status: finalized by ${d.finalizedByName ?? 'a member'} on ${day(d.finalizedAt)}`
      : 'status: still a draft — never finalized'
  );
  lines.push(
    d.claimIds.length === 0
      ? 'rests on: no linked claim'
      : `rests on ${d.claimIds.length} linked claim(s)`
  );
  lines.push(
    d.requiredApproverIds.length === 0
      ? 'approvals: none required'
      : `approvals: ${approved.length} of ${d.requiredApproverIds.length}` +
        (approved.length ? ` — ${approved.join(', ')} approved` : '') +
        (outstanding.length ? `; still outstanding from ${outstanding.join(', ')}` : '')
  );
  lines.push(
    gate.ready
      ? 'gate: every condition satisfied, ready to finalize'
      : `gate: ${gate.blockers.length} condition(s) outstanding`
  );

  // The newest history entry is the room's own account of how the decision
  // moved, and it is written by a person — the closest thing to "why" that is
  // actually on the record rather than inferred.
  const last = d.history?.[d.history.length - 1];
  if (last) lines.push(`last recorded step: ${day(last.at)} — ${last.actorName}: ${clip(last.detail, 180)}`);

  return lines.join('\n');
}

function renderContradiction(r: ClaimRelation, mem: DecisionMemory): string {
  const lines: string[] = [];
  lines.push(
    `- "${clip(r.claimAText, MAX_CLAIM_EXCERPT)}" vs "${clip(r.claimBText, MAX_CLAIM_EXCERPT)}"`
  );
  lines.push(
    `  status: ${EDGE_STATUS[r.status] ?? r.status}` +
      (r.resolution ? `; ${r.resolvedByName ? `closed by ${r.resolvedByName}` : 'closed'} on ${day(r.resolvedAt)}: "${clip(r.resolution, 200)}"` : '')
  );
  if (r.explanation) lines.push(`  detector said: ${clip(r.explanation, 200)}`);

  const cited = (r.citedEvidenceIds ?? [])
    .map((id) => {
      for (const list of Object.values(mem.evidenceByClaim)) {
        const hit = list.find((e) => e.id === id);
        if (hit) return hit;
      }
      return null;
    })
    .filter((e): e is Evidence => Boolean(e));
  if (cited.length) {
    lines.push(`  evidence cited when closing it: ${cited.map((e) => `"${e.title}"`).join(', ')}`);
  }

  const thread = mem.discussions[r.id];
  if (thread?.votes?.length) {
    const tally: Record<string, number> = { CLAIM_A: 0, CLAIM_B: 0, NEITHER: 0 };
    for (const v of thread.votes) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
    lines.push(
      `  poll (advice only, never the outcome): claim A ${tally.CLAIM_A}, claim B ${tally.CLAIM_B}, neither / need more evidence ${tally.NEITHER}`
    );
  }
  if (thread?.comments?.length) {
    for (const c of thread.comments.slice(-MAX_COMMENTS_PER_THREAD)) {
      lines.push(`  ${c.authorName}: "${clip(c.text, 180)}"`);
    }
    if (thread.comments.length > MAX_COMMENTS_PER_THREAD) {
      lines.push(`  (${thread.comments.length} comments in total on this thread)`);
    }
  }

  return lines.join('\n');
}

function renderEvidence(e: Evidence, claim: Claim | undefined): string {
  let head = `- "${e.title}" (${e.kind}`;
  if (e.kind === 'url' && e.url) head += `: ${e.url}`;
  head += ')';

  const bits: string[] = [head];
  if (e.excerpt) bits.push(`  ${clip(e.excerpt, 180)}`);
  bits.push(
    e.aiGenerated
      ? `  from a model (${e.modelName ?? 'unspecified'}) — UNVERIFIED, a lead to check, never proof`
      : `  attached by ${e.authorName ?? 'a member'}`
  );
  if (claim) bits.push(`  on the claim: "${clip(claim.text, MAX_CLAIM_EXCERPT)}"`);
  return bits.join('\n');
}

/**
 * Everything the record still shows as unresolved. Straight off the gate's own
 * blockers first, so this block and the Evidence Gate can never disagree about
 * what is open — then any contradiction the gate does not cover because no
 * decision is built on it.
 */
function openItems(mem: DecisionMemory): string[] {
  const items: string[] = [];
  const covered = new Set<string>();

  for (const d of mem.decisions.slice(0, 2)) {
    const gate = evaluateDecisionGate(d, mem.claims, mem.relations, mem.evidenceByClaim);
    for (const b of gate.blockers) {
      items.push(`- ${d.title}: ${b.message}`);
      for (const rid of b.relationIds ?? []) covered.add(rid);
    }
  }

  for (const r of mem.relations) {
    if (!isContradiction(r) || covered.has(r.id)) continue;
    if (r.status === 'detected') {
      items.push(`- Unresolved contradiction: "${clip(r.claimAText, 160)}" vs "${clip(r.claimBText, 160)}".`);
    } else if (r.status === 'evidence-needed') {
      items.push(
        `- The room closed "${clip(r.claimAText, 120)}" vs "${clip(r.claimBText, 120)}" as needing more evidence — still not settled either way.`
      );
    }
  }
  return items;
}

/**
 * Renders a room's record as the prompt block, or `''` when the question has
 * nothing to do with it.
 *
 * Pure: same input, same output, no database, no model. That is what makes it
 * testable line by line, and what makes "the model cannot have invented this"
 * a checkable property rather than a hope.
 */
export function renderDecisionMemory(mem: DecisionMemory, question: string): string {
  const terms = termSet(question);
  const intents = detectIntents(question);
  const hasRecord = mem.decisions.length > 0 || mem.claims.length > 0 || mem.relations.length > 0;

  // Nothing stored, and nothing asked about it: say nothing at all rather than
  // ship an empty block of rules the model would then feel obliged to use.
  if (!hasRecord && intents.length === 0) return '';

  // Sections the question asked for are guaranteed a showing; the rest only
  // contribute items whose text actually overlaps the question.
  const wantsDisagreement =
    intents.includes('disagreement') || intents.includes('evidence') || intents.includes('decision');
  const wantsEvidence = intents.includes('evidence') || intents.includes('decision');
  const wantsOpen = intents.includes('uncertainty') || intents.includes('decision');

  const contradictionsAll = mem.relations.filter(isContradiction);
  const evidenceAll = Object.values(mem.evidenceByClaim).flat();

  const decisions = pick(
    rank(mem.decisions, (d) => `${d.title} ${d.statement}`, (d) => d.createdAt, terms),
    MAX_DECISIONS,
    intents.includes('decision')
  );
  const contradictions = pick(
    rank(
      contradictionsAll,
      (r) => `${r.claimAText} ${r.claimBText} ${r.explanation} ${r.resolution ?? ''}`,
      (r) => r.createdAt,
      terms
    ),
    MAX_CONTRADICTIONS,
    wantsDisagreement
  );

  const evidence = pick(
    rank(
      evidenceAll,
      (e) => {
        const claim = mem.claims.find((c) => c.id === e.claimId);
        return `${e.title} ${e.excerpt ?? ''} ${e.url ?? ''} ${claim?.text ?? ''}`;
      },
      (e) => e.createdAt,
      terms
    ),
    MAX_EVIDENCE,
    wantsEvidence
  );

  const claims = pick(
    rank(mem.claims, (c) => c.text, (c) => c.createdAt, terms),
    MAX_CLAIMS,
    intents.length > 0
  );

  const openAll = openItems(mem);
  const open = pick(rank(openAll, (s) => s, () => '', terms), MAX_OPEN, wantsOpen);

  const sections: Section[] = [
    {
      name: 'Decisions',
      requested: intents.includes('decision'),
      total: mem.decisions.length,
      items: decisions.map((d) => renderDecision(d, mem)),
      order: 0
    },
    {
      name: 'Disagreements (contradictions between claims)',
      requested: wantsDisagreement,
      total: contradictionsAll.length,
      items: contradictions.map((r) => renderContradiction(r, mem)),
      order: 1
    },
    { name: 'Still open or unresolved', requested: wantsOpen, total: openAll.length, items: open, order: 2 },
    {
      name: 'Evidence on record',
      requested: wantsEvidence,
      total: evidenceAll.length,
      items: evidence.map((e) => renderEvidence(e, mem.claims.find((c) => c.id === e.claimId))),
      order: 3
    },
    {
      name: 'Claims stated in this room',
      requested: intents.length > 0,
      total: mem.claims.length,
      items: claims.map((c) => `- "${clip(c.text, MAX_CLAIM_EXCERPT)}" — *${c.modelName}*`),
      order: 4
    }
  ];

  // Sections the question asked for win the character budget; among equals the
  // fixed reading order stands.
  sections.sort((a, b) => Number(b.requested) - Number(a.requested) || a.order - b.order);

  // One block per item, each tagged with the heading it belongs under, so the
  // assembler can drop individual items without orphaning a heading — and can
  // emit a heading only once at least one of its items survived the budget.
  const blocks: Array<{ heading: string; content: string }> = [];
  for (const s of sections) {
    if (!s.requested && s.items.length === 0) continue;
    const heading =
      s.items.length > 0 && s.items.length < s.total
        ? `### ${s.name} (showing ${s.items.length} of ${s.total})`
        : `### ${s.name}`;
    if (s.items.length === 0) {
      blocks.push({ heading, content: '(none recorded)' });
      continue;
    }
    for (const content of s.items) blocks.push({ heading, content });
  }

  if (blocks.length === 0) return '';

  const out: string[] = [...RULES];
  let used = out.join('\n').length;
  let currentHeading: string | null = null;
  for (const b of blocks) {
    const headingCost = b.heading === currentHeading ? 0 : b.heading.length + 2;
    const cost = headingCost + b.content.length + 1;
    if (used + cost > MAX_DECISION_CONTEXT_CHARS) continue;
    if (b.heading !== currentHeading) {
      out.push(b.heading);
      currentHeading = b.heading;
    }
    out.push(b.content);
    used += cost;
  }

  return out.join('\n');
}

/**
 * Loads a room's record and renders it for this question.
 *
 * Queries are bounded (a huge room costs the same as a small one) and the
 * result is bounded again at render time, so the block can never swamp the
 * prompt regardless of how much history a room has accumulated.
 */
export async function buildDecisionContext(
  conversationId: string,
  question: string
): Promise<{ section: string; hasDecisionContext: boolean }> {
  const [decisions, claims, relations] = await Promise.all([
    db.getDecisions(conversationId, MAX_QUERY_DECISIONS),
    db.getClaims(conversationId, MAX_QUERY_CLAIMS),
    db.getClaimRelations(conversationId, MAX_QUERY_RELATIONS)
  ]);

  // Empty room: there is no record to be relevant to, and no point paying for
  // the follow-up queries.
  if (decisions.length === 0 && claims.length === 0 && relations.length === 0) {
    return { section: '', hasDecisionContext: false };
  }

  const claimIds = Array.from(
    new Set([
      ...decisions.flatMap((d) => d.claimIds),
      ...claims.map((c) => c.id)
    ])
  );
  const contradictions = relations.filter(isContradiction).map((r) => r.id);
  const approverIds = Array.from(
    new Set(decisions.flatMap((d) => d.requiredApproverIds))
  );

  const [evidenceByClaim, discussions, approverUsers] = await Promise.all([
    claimIds.length > 0 ? db.getEvidenceForClaims(conversationId, claimIds) : Promise.resolve({}),
    contradictions.length > 0 ? db.getDiscussionsForRelations(contradictions) : Promise.resolve({}),
    approverIds.length > 0 ? db.getUsersByIds(approverIds) : Promise.resolve([])
  ]);

  const mem: DecisionMemory = {
    decisions,
    claims,
    relations,
    evidenceByClaim,
    discussions,
    members: approverUsers.map((u) => ({ id: u.id, name: u.name }))
  };

  const section = renderDecisionMemory(mem, question);
  return { section, hasDecisionContext: section.length > 0 };
}
