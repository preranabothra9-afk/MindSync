/**
 * Decision Replay verification probe.
 *
 * Proves the replay is a faithful presentation of the room's stored record
 * rather than a second, drift-prone copy of it:
 *
 *  - every material action the room takes lands on the timeline (decision
 *    lifecycle, evidence, contradiction resolution),
 *  - the endpoint folds those events into a state at each position that
 *    matches the gate's own rules — closed when it should be, open when it
 *    should not be,
 *  - SUPPORT and RELATED edges never count as open contradictions (the same
 *    definition the Contradictions panel and the gate use),
 *  - the summary's sections are read off the stored record, and the narration
 *    prompt carries only those fields,
 *  - events belonging to another decision's claims do not leak into this
 *    decision's timeline.
 */
import './server/env_init';
import express from 'express';
import http from 'http';
import {
  connectDB,
  db,
  WorkspaceModel,
  ConversationModel,
  ClaimModel,
  EvidenceModel,
  ClaimRelationModel,
  TimelineEventModel,
  DecisionModel
} from './server/database';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateUUID } from './server/auth';
import router from './server/routes';
import { buildDecisionReplay, buildDecisionSummary, buildSummaryNarrationPrompt } from './server/decisions';
import type { Claim, ClaimRelation, Decision } from './src/types';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

interface DriveResult {
  status: number;
  body: any;
}

function drive(
  app: express.Application,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<DriveResult> {
  return new Promise<DriveResult>((resolve) => {
    const req = new http.IncomingMessage(null as any);
    req.method = method.toUpperCase();
    req.url = path;
    req.headers = {};
    if (opts.token) req.headers.authorization = `Bearer ${opts.token}`;
    req.headers['content-type'] = 'application/json';
    (req as any).body = opts.body ?? {};
    (req as any).cookies = {};
    Object.defineProperty(req, 'ip', { value: '127.0.0.1', configurable: true, writable: true });

    const res = new http.ServerResponse(req);
    let payload = '';
    (res as any).end = (chunk?: any): http.ServerResponse => {
      if (chunk) payload += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      let parsed: any = payload;
      try { parsed = payload ? JSON.parse(payload) : {}; } catch { /* keep raw */ }
      resolve({ status: res.statusCode, body: parsed });
      return res;
    };

    (app as any)(req, res, (err: unknown) => resolve({ status: 500, body: { error: String(err) } }));
  });
}

/**
 * Everything this probe created, recorded the instant it exists.
 *
 * A probe must never leave a workspace behind: leaked test rooms are exactly
 * the kind of residue this project is trying to be rid of. Holding the ids at
 * module scope lets teardown run whether the run succeeds, throws, or is
 * interrupted.
 */
let fixture: { convId: string; wsId: string; userId: string } | null = null;

async function teardown(): Promise<void> {
  const f = fixture;
  if (!f) return;
  fixture = null;
  try {
    await TimelineEventModel.deleteMany({ conversationId: f.convId });
    await EvidenceModel.deleteMany({ conversationId: f.convId });
    await ClaimRelationModel.deleteMany({ conversationId: f.convId });
    await ClaimModel.deleteMany({ conversationId: f.convId });
    await DecisionModel.deleteMany({ conversationId: f.convId });
    await ConversationModel.deleteOne({ _id: f.convId });
    await WorkspaceModel.deleteOne({ _id: f.wsId });
    await db.deleteUser(f.userId);
  } catch (err) {
    console.error('Probe teardown failed:', err);
  }
}

async function main(): Promise<void> {
  await connectDB();
  console.log('\n=== Decision Replay probe ===');

  const app = express();
  app.use((req, _res, next) => { (req as any).body = (req as any).body ?? {}; next(); });
  app.use(router);

  // ── fixtures ──────────────────────────────────────────────────────────
  const now = () => new Date().toISOString();
  const suffix = generateUUID().slice(0, 8);
  const owner = (await db.createUser({
    id: generateUUID(),
    name: 'Replay Owner',
    email: `replay-owner-${suffix}@collabz.test`,
    avatar: 'PROBE',
    role: 'user',
    createdAt: now()
  } as any, bcrypt.hashSync('probe-only', 10))) as any;

  const ws = await WorkspaceModel.create({
    _id: generateUUID(),
    name: 'Replay Workspace',
    description: 'probe',
    ownerId: owner.id,
    memberIds: [owner.id],
    createdAt: new Date().toISOString()
  });
  const conv = await ConversationModel.create({
    _id: generateUUID(),
    workspaceId: ws.id,
    title: 'Replay Room',
    createdBy: owner.id,
    createdAt: new Date().toISOString()
  });

  const token = generateAccessToken(owner as any);
  const base = `/messages/${conv.id}/decisions`;

  // From here on, any failure must still clean up.
  fixture = { convId: String(conv._id), wsId: String(ws._id), userId: owner.id };

  let decisionId: string | null = null;
  let linkedClaim: Claim;
  let otherClaim: Claim;
  let thirdClaim: Claim;
  let contradiction: ClaimRelation;
  let relatedEdge: ClaimRelation;

  // ── 1. The room's own activity is recorded as it happens ─────────────
  console.log('\n-- recording --');

  linkedClaim = (await ClaimModel.create({
    _id: generateUUID(),
    conversationId: conv.id,
    messageId: generateUUID(),
    modelKey: 'gemini-2.5-flash',
    modelName: 'gemini-2.5-flash',
    text: 'PostgreSQL gives strong consistency guarantees.',
    createdAt: now()
  }).then((d) => d.toJSON())) as any;

  otherClaim = (await ClaimModel.create({
    _id: generateUUID(),
    conversationId: conv.id,
    messageId: generateUUID(),
    modelKey: 'llama-3.3-70b',
    modelName: 'llama-3.3-70b',
    text: 'MongoDB trades consistency for availability.',
    createdAt: now()
  }).then((d) => d.toJSON())) as any;

  // A genuinely open contradiction between the two claims.
  const [aId, bId] = [linkedClaim.id, otherClaim.id].sort();
  contradiction = (await ClaimRelationModel.create({
    _id: generateUUID(),
    conversationId: conv.id,
    claimAId: aId,
    claimBId: bId,
    claimAText: aId === linkedClaim.id ? linkedClaim.text : otherClaim.text,
    claimBText: aId === linkedClaim.id ? otherClaim.text : linkedClaim.text,
    claimAModelName: 'gemini-2.5-flash',
    claimBModelName: 'llama-3.3-70b',
    relationship: 'CONTRADICT',
    confidence: 0.9,
    explanation: 'probe contradiction',
    status: 'detected',
    createdAt: now()
  }).then((d) => d.toJSON())) as any;

  // A SUPPORT/RELATED edge touching the linked claim — context, never a
  // contradiction the gate or the panel would ask the room to adjudicate.
  // The schema allows one edge per claim pair, so this runs against a third
  // claim rather than trying to add a second edge to the same pair.
  thirdClaim = (await ClaimModel.create({
    _id: generateUUID(),
    conversationId: conv.id,
    messageId: generateUUID(),
    modelKey: 'gpt-oss-120b',
    modelName: 'gpt-oss-120b',
    text: 'Both databases support JSON documents.',
    createdAt: now()
  }).then((d) => d.toJSON())) as any;

  relatedEdge = (await ClaimRelationModel.create({
    _id: generateUUID(),
    conversationId: conv.id,
    claimAId: linkedClaim.id,
    claimBId: thirdClaim.id,
    claimAText: linkedClaim.text,
    claimBText: thirdClaim.text,
    claimAModelName: 'gemini-2.5-flash',
    claimBModelName: 'gpt-oss-120b',
    relationship: 'RELATED',
    confidence: 0.6,
    explanation: 'both concern databases',
    status: 'detected',
    createdAt: now()
  }).then((d) => d.toJSON())) as any;

  // The detector records every edge it reports. This is the exact shape
  // socket.ts writes, and it predates the decision — as it normally would,
  // since a room accumulates claims and contradictions before anyone drafts a
  // decision on top of them.
  for (const rel of [contradiction, relatedEdge]) {
    await db.recordTimelineEvent({
      conversationId: conv.id,
      kind: 'contradiction-detected',
      actorId: null,
      actorName: 'Contradiction detector',
      title: rel.relationship === 'CONTRADICT' ? 'Contradiction detected' : `Claims marked ${rel.relationship}`,
      detail: rel.explanation,
      relationId: rel.id,
      claimIds: [rel.claimAId, rel.claimBId],
      meta: {
        relationship: rel.relationship,
        confidence: rel.confidence,
        explanation: rel.explanation,
        claimAText: rel.claimAText,
        claimBText: rel.claimBText
      }
    });
  }

  // Create the decision resting on the linked claim.
  const created = await drive(app, 'POST', base, {
    token,
    body: { title: 'Adopt PostgreSQL', statement: 'We will standardize on PostgreSQL for the primary store.', claimIds: [linkedClaim.id] }
  });
  check('decision created', created.status === 201, JSON.stringify(created.body));
  decisionId = created.body?.decision?.id ?? null;
  check('create recorded on the timeline', !!(decisionId && (await TimelineEventModel.exists({ conversationId: conv.id, decisionId, kind: 'decision-created' }))));

  // Attach human evidence to the linked claim.
  const ev = await drive(app, 'POST', `/messages/${conv.id}/claims/${linkedClaim.id}/evidence`, {
    token,
    body: { kind: 'url', title: 'PostgreSQL docs — durability', url: 'https://example.com/pg' }
  });
  check('evidence attached', ev.status === 201, JSON.stringify(ev.body));
  check('evidence recorded as a room event', !!(await TimelineEventModel.exists({
    conversationId: conv.id,
    kind: 'evidence-added',
    evidenceId: ev.body?.id
  })));

  // Close the contradiction as resolved, with a reason.
  const closed = await drive(app, 'POST', `/messages/${conv.id}/relations/${contradiction.id}/resolved`, {
    token,
    body: { resolution: 'PostgreSQL is the right call for our consistency needs.' }
  });
  check('contradiction resolved', closed.status === 200, JSON.stringify(closed.body));
  const closedEvent = await TimelineEventModel.findOne({
    conversationId: conv.id,
    kind: 'contradiction-resolved',
    relationId: contradiction.id
  }).lean();
  check('resolution recorded with its status and reason', !!closedEvent
    && (closedEvent as any).meta?.status === 'resolved'
    && String((closedEvent as any).meta?.resolution).includes('PostgreSQL'));

  // ── 2. The replay fold: state at each point, server-side truth ────────
  console.log('\n-- replay fold --');

  const timeline = await drive(app, 'GET', `${base}/${decisionId}/timeline`, { token });
  check('timeline reachable', timeline.status === 200, JSON.stringify(timeline.body));

  const events: any[] = timeline.body?.events ?? [];
  const snapshots: any[] = timeline.body?.snapshots ?? [];
  check('every event has a matching snapshot', events.length === snapshots.length && events.length > 0);
  const kinds = events.map((e) => e.kind);
  check('decision lifecycle is on the timeline', kinds.includes('decision-created'));
  check('room events are on the timeline', kinds.includes('evidence-added') && kinds.includes('contradiction-resolved'));
  // The detector ran before the decision was drafted; its edges are part of
  // this decision's story and the gate at creation already accounted for the
  // open one, so the timeline must not be clipped at the decision's birth.
  check('detections predating the decision appear on the timeline', kinds.includes('contradiction-detected'));

  const indexOf = (kind: string): number => kinds.indexOf(kind);

  // Right after the decision is created with its claim linked, the claim is
  // unevidenced and the contradiction is still open — the gate is shut.
  const afterCreate = snapshots[indexOf('decision-created')];
  check('claim linked at creation', afterCreate?.claimsLinked?.length === 1);
  check('claim unbacked before evidence', afterCreate?.claimsLinked?.[0]?.backed === false);
  check('contradiction open before resolution', afterCreate?.contradictionsOpen?.length === 1);
  check('gate closed at creation', afterCreate?.gateReady === false);

  // Once evidence lands the claim is backed, but the open contradiction still
  // holds the gate shut.
  const afterEvidence = snapshots[indexOf('evidence-added')];
  check('claim backed once evidence lands', afterEvidence?.claimsLinked?.[0]?.backed === true);
  check('gate still closed while a contradiction is open', afterEvidence?.gateReady === false);

  // Resolving the contradiction was the last blocker.
  const afterResolve = snapshots[Math.max(0, indexOf('contradiction-resolved'))];
  check('contradiction closed after resolution', afterResolve?.contradictionsOpen?.length === 0);
  check('resolution carries its reason', !!afterResolve?.contradictionsClosed?.[0]?.resolution);
  check('gate opens once every condition is met', afterResolve?.gateReady === true);

  // A RELATED edge must never appear as an open contradiction — the same
  // definition the Contradictions panel and the gate use.
  check('related edge is not an open contradiction',
    !snapshots.some((s) => s.contradictionsOpen?.some((c: any) => c.id === relatedEdge.id)));

  // ── 3. RELATED edges in the fold itself, not just the endpoint ────────
  console.log('\n-- related edges --');

  const syntheticDecision: Decision = {
    id: 'synthetic',
    conversationId: conv.id,
    title: 'Synthetic',
    statement: 'Probe statement.',
    claimIds: [linkedClaim.id],
    requiredApproverIds: [],
    approvals: [],
    status: 'draft',
    createdBy: 'u',
    createdByName: 'U',
    finalizedAt: null,
    finalizedBy: null,
    finalizedByName: null,
    history: [],
    createdAt: now()
  };
  const withRelated = buildDecisionReplay(syntheticDecision, [linkedClaim, otherClaim, thirdClaim], [relatedEdge], [
    {
      id: 'e1',
      conversationId: conv.id,
      decisionId: null,
      kind: 'contradiction-detected',
      at: now(),
      actorId: null,
      actorName: 'Contradiction detector',
      title: 'Claims marked RELATED',
      detail: 'both concern databases',
      relationId: relatedEdge.id,
      claimIds: [relatedEdge.claimAId, relatedEdge.claimBId],
      meta: { relationship: 'RELATED', confidence: 0.6, claimAText: relatedEdge.claimAText, claimBText: relatedEdge.claimBText }
    }
  ]);
  check('a RELATED edge never opens a contradiction', withRelated.snapshots.every((s) => s.contradictionsOpen.length === 0));
  check('a RELATED edge alone does not close the gate', withRelated.snapshots.every((s) => s.gateReady === false));

  // And a CONTRADICT edge does count.
  const withContradict = buildDecisionReplay(syntheticDecision, [linkedClaim, otherClaim], [contradiction], [
    {
      id: 'e2',
      conversationId: conv.id,
      decisionId: null,
      kind: 'contradiction-detected',
      at: now(),
      actorId: null,
      actorName: 'Contradiction detector',
      title: 'Contradiction detected',
      detail: 'clash',
      relationId: contradiction.id,
      claimIds: [contradiction.claimAId, contradiction.claimBId],
      meta: { relationship: 'CONTRADICT', confidence: 0.9, claimAText: contradiction.claimAText, claimBText: contradiction.claimBText }
    }
  ]);
  check(' a CONTRADICT edge opens a contradiction', withContradict.snapshots.some((s) => s.contradictionsOpen.length === 1));

  // ── 4. The summary is read off the record ─────────────────────────────
  console.log('\n-- summary --');

  const summaryRes = await drive(app, 'GET', `${base}/${decisionId}/summary`, { token });
  check('summary reachable', summaryRes.status === 200, JSON.stringify(summaryRes.body));
  const s = summaryRes.body;
  check('question is the decision title', s?.question === 'Adopt PostgreSQL');
  check('conclusion is the decision statement', s?.conclusion?.includes('standardize on PostgreSQL'));
  check('key claims list the linked claim', s?.keyClaims?.some((c: any) => c.text === linkedClaim.text));
  check('evidence lists the human evidence', s?.evidence?.some((e: any) => e.title === 'PostgreSQL docs — durability' && e.aiGenerated === false));
  check('disagreements list the closed contradiction', s?.disagreements?.some((d: any) => d.status === 'resolved'));
  check('a backed claim is not an assumption', (s?.assumptions ?? []).length === 0);
  check('a finalized decision leaves nothing open', (s?.remainingUncertainties ?? []).length === 0);
  check('participants include the author', s?.participants?.some((p: any) => p.role.includes('Author')));
  check('narration is absent until requested', s?.narrative === null && s?.narrativeNote === null);
  check('the narration prompt carries only the record', buildSummaryNarrationPrompt(s).includes('RECORD')
    && buildSummaryNarrationPrompt(s).includes('Do NOT add anything'));

  // ── 5. Relevance: another decision's story is not this one's ──────────
  console.log('\n-- relevance --');

  // A claim the decision does NOT rest on, with evidence pinned to it.
  const stray = (await ClaimModel.create({
    _id: generateUUID(),
    conversationId: conv.id,
    messageId: generateUUID(),
    modelKey: 'qwen-qwq-32b',
    modelName: 'qwen-qwq-32b',
    text: 'Redis is a cache, not a store of record.',
    createdAt: now()
  }).then((d) => d.toJSON())) as any;
  await EvidenceModel.create({
    _id: generateUUID(),
    claimId: stray.id,
    conversationId: conv.id,
    kind: 'url',
    title: 'Stray evidence',
    url: 'https://example.com/stray',
    aiGenerated: false,
    createdAt: now()
  });
  await db.recordTimelineEvent({
    conversationId: conv.id,
    kind: 'evidence-added',
    actorId: owner.id,
    actorName: owner.name,
    title: 'Evidence attached',
    detail: 'Attached “Stray evidence” to a claim.',
    claimIds: [stray.id],
    evidenceId: 'stray-evidence-id',
    meta: { title: 'Stray evidence', kind: 'url', aiGenerated: false, claimText: stray.text }
  });

  const replay2 = await drive(app, 'GET', `${base}/${decisionId}/timeline`, { token });
  const strayLeak = (replay2.body?.events ?? []).some((e: any) => (e.claimIds ?? []).includes(stray.id));
  check('evidence on an unlinked claim stays off the timeline', !strayLeak);

  // ── 6. Finalization appears on the timeline, and reopen restores draft ─
  console.log('\n-- finalize and reopen --');

  const finalizeRes = await drive(app, 'POST', `${base}/${decisionId}/finalize`, { token });
  check('finalized', finalizeRes.status === 200, JSON.stringify(finalizeRes.body));
  const replay3 = await drive(app, 'GET', `${base}/${decisionId}/timeline`, { token });
  const snap3 = (replay3.body?.snapshots ?? []).pop();
  check('the final snapshot is locked', snap3?.status === 'finalized');
  check('finalize is on the timeline', (replay3.body?.events ?? []).some((e: any) => e.kind === 'decision-finalized'));

  const reopenRes = await drive(app, 'POST', `${base}/${decisionId}/reopen`, {
    token,
    body: { reason: 'Reconsidering after new information.' }
  });
  check('reopened', reopenRes.status === 200, JSON.stringify(reopenRes.body));
  const replay4 = await drive(app, 'GET', `${base}/${decisionId}/timeline`, { token });
  const snap4 = (replay4.body?.snapshots ?? []).pop();
  check('reopen restores draft on the timeline', snap4?.status === 'draft');
  check('reopen keeps the earlier finalization', (replay4.body?.events ?? []).some((e: any) => e.kind === 'decision-finalized'));

  // ── cleanup ───────────────────────────────────────────────────────────
  await teardown();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Probe crashed:', err);
  // Clean up before exiting — a crashed run must not leak a workspace.
  await teardown();
  process.exit(2);
});

// Ctrl+C mid-run should not leave the fixtures behind either.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await teardown();
    process.exit(130);
  });
}
