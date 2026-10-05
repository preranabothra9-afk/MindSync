/**
 * Evidence Gate verification probe.
 *
 * Proves the gate is enforced by the route, not by the UI:
 *  - finalize is refused with the blocker list while any condition is unmet,
 *  - finalize succeeds once every condition is satisfied,
 *  - a DIRECT API call that skips the UI gate is refused identically,
 *  - a finalized decision cannot be silently edited, approved, or re-finalized,
 *  - reopening appends to the history instead of erasing the finalization.
 *
 * Runs the real router with the real `requireAuth` (a genuine JWT) against the
 * real database, so the refusal is the one a bypassing client would get.
 */
import './server/env_init';
import express from 'express';
import http from 'http';
import { connectDB, db, UserModel, WorkspaceModel, ConversationModel, ClaimModel, EvidenceModel, ClaimRelationModel, DecisionModel, AuditLogModel } from './server/database';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateUUID } from './server/auth';
import router from './server/routes';
import type { Claim, ClaimRelation } from './src/types';

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

/**
 * Invokes the real Express stack with a synthetic request, so the whole route
 * (auth, validation, gate, DB, broadcast) runs exactly as it would for an HTTP
 * client — including one that never loaded the UI.
 */
function drive(
  app: express.Application,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {}
): Promise<DriveResult> {
  return new Promise<DriveResult>((resolve) => {
    const req = new http.IncomingMessage(null as any);
    req.method = method.toUpperCase();
    req.url = path;
    req.headers = {};
    if (opts.token) req.headers.authorization = `Bearer ${opts.token}`;
    req.headers['content-type'] = 'application/json';
    // body-parser is not mounted on the probe app, so the routes read this.
    (req as any).body = opts.body ?? {};
    (req as any).cookies = {};
    Object.defineProperty(req, 'ip', { value: '127.0.0.1', configurable: true, writable: true });

    const res = new http.ServerResponse(req);
    let payload = '';
    const realEnd = res.end.bind(res);
    (res as any).end = (chunk?: any, ...rest: any[]): http.ServerResponse => {
      if (chunk) payload += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      let parsed: any = payload;
      try { parsed = payload ? JSON.parse(payload) : {}; } catch { /* keep raw */ }
      resolve({ status: res.statusCode, body: parsed });
      // Returning without calling realEnd keeps the (socket-less) response from
      // trying to flush; the result has already been captured above.
      return res;
    };

    // Express applications are themselves request handlers: app(req, res, next)
    // runs the full stack exactly as the HTTP server would.
    (app as any)(req, res, (err: unknown) => resolve({ status: 500, body: { error: String(err) } }));
  });
}

/**
 * Everything this probe created, recorded the instant it exists — so teardown
 * runs whether the run succeeds, throws before the main try-block, or is
 * interrupted. A test workspace must never outlive the test that made it.
 */
let fixture: { convId: string; wsId: string; userIds: string[] } | null = null;

async function teardown(): Promise<void> {
  const f = fixture;
  if (!f) return;
  fixture = null;
  try {
    await DecisionModel.deleteMany({ conversationId: f.convId });
    await EvidenceModel.deleteMany({ conversationId: f.convId });
    await ClaimRelationModel.deleteMany({ conversationId: f.convId });
    await ClaimModel.deleteMany({ conversationId: f.convId });
    await ConversationModel.deleteOne({ _id: f.convId });
    await WorkspaceModel.deleteOne({ _id: f.wsId });
    if (f.userIds.length) {
      await UserModel.deleteMany({ _id: { $in: f.userIds } });
      await AuditLogModel.deleteMany({ userId: { $in: f.userIds } });
    }
  } catch (err) {
    console.error('Probe teardown failed:', err);
  }
}

async function main(): Promise<void> {
  await connectDB();
  console.log('\n=== Evidence Gate probe ===');

  const app = express();
  app.use((req, _res, next) => { (req as any).body = (req as any).body ?? {}; next(); });
  app.use(router);

  // ── fixtures ──────────────────────────────────────────────────────────
  const now = () => new Date().toISOString();
  const suffix = generateUUID().slice(0, 8);
  // Declared here so the finally block can clean it up even if a later step
  // throws before the outsider fixture is created.
  let outsider: { id: string } | null = null;
  const owner = (await db.createUser({
    id: generateUUID(),
    name: 'Gate Owner',
    email: `gate-owner-${suffix}@collabz.test`,
    avatar: 'PROBE',
    role: 'user',
    createdAt: now()
  } as any, bcrypt.hashSync('probe-only', 10))) as any;
  const member = (await db.createUser({
    id: generateUUID(),
    name: 'Gate Member',
    email: `gate-member-${suffix}@collabz.test`,
    avatar: 'PROBE',
    role: 'user',
    createdAt: now()
  } as any, bcrypt.hashSync('probe-only', 10))) as any;
  const ws = await WorkspaceModel.create({
    _id: generateUUID(),
    name: 'Gate Workspace',
    description: 'probe',
    ownerId: owner.id,
    memberIds: [owner.id, member.id],
    createdAt: new Date().toISOString()
  });
  const conv = await ConversationModel.create({
    _id: generateUUID(),
    workspaceId: ws.id,
    title: 'Gate Room',
    createdBy: owner.id,
    createdAt: new Date().toISOString()
  });

  const ownerToken = generateAccessToken(owner as any);
  const memberToken = generateAccessToken(member as any);

  fixture = {
    convId: String(conv._id),
    wsId: String(ws._id),
    userIds: [owner.id, member.id]
  };

  const base = `/messages/${conv.id}/decisions`;

  const makeClaim = async (text: string, modelKey = 'gemini-2.5-flash'): Promise<Claim> => {
    const c = await ClaimModel.create({
      _id: generateUUID(),
      conversationId: conv.id,
      messageId: generateUUID(),
      modelKey,
      modelName: modelKey,
      text,
      createdAt: now()
    });
    return c.toJSON() as any;
  };

  const attachEvidence = async (claimId: string): Promise<void> => {
    await EvidenceModel.create({
      _id: generateUUID(),
      claimId,
      conversationId: conv.id,
      kind: 'url',
      title: 'Supporting source',
      url: 'https://example.com/source',
      aiGenerated: false,
      createdAt: now()
    });
  };

  const makeRelation = async (a: Claim, b: Claim, status: ClaimRelation['status'] = 'detected'): Promise<ClaimRelation> => {
    const [claimAId, claimBId] = [a.id, b.id].sort();
    const r = await ClaimRelationModel.create({
      _id: generateUUID(),
      conversationId: conv.id,
      claimAId,
      claimBId,
      claimAText: a.text,
      claimBText: b.text,
      claimAModelName: a.modelName,
      claimBModelName: b.modelName,
      relationship: 'CONTRADICT',
      confidence: 0.9,
      explanation: 'probe contradiction',
      status,
      createdAt: now()
    });
    return r.toJSON() as any;
  };

  const create = async (token: string, body: unknown): Promise<DriveResult> =>
    drive(app, 'POST', base, { body, token });

  const finalize = async (token: string, decisionId: string): Promise<DriveResult> =>
    drive(app, 'POST', `${base}/${decisionId}/finalize`, { token });

  try {
    // ── 1. The gate blocks while conditions are unmet ───────────────────
    console.log('\n— gate blocks until every condition is met —');

    const created = await create(ownerToken, {
      title: 'Adopt Qwen for extraction',
      statement: 'Move the data-extraction step to Qwen3.8 because it is cheapest per token.'
    });
    check('create succeeds (201)', created.status === 201, JSON.stringify(created.body));
    const decisionId = created.body?.decision?.id;

    // No claims linked → blocked.
    let r = await finalize(ownerToken, decisionId);
    check('finalize with no linked claims → 409', r.status === 409, JSON.stringify(r.body));
    check('blocker names the missing basis', (r.body?.blockers ?? []).some((b: any) => b.kind === 'statement-missing'), JSON.stringify(r.body?.blockers));

    // Link an unevidenced claim → still blocked.
    const claimA = await makeClaim('Qwen3.8 is the cheapest model per token.');
    await drive(app, 'PUT', `${base}/${decisionId}/claims`, { body: { claimIds: [claimA.id] }, token: ownerToken });
    r = await finalize(ownerToken, decisionId);
    check('finalize with an unevidenced claim → 409', r.status === 409, JSON.stringify(r.body));
    check('blocker names the unevidenced claim', (r.body?.blockers ?? []).some((b: any) => b.kind === 'claims-unevidenced'), JSON.stringify(r.body?.blockers));

    // An open contradiction among linked claims → blocked even with evidence.
    const claimB = await makeClaim('Qwen3.8 is the most expensive model per token.', 'qwen3.8-27b');
    await attachEvidence(claimA.id);
    await makeRelation(claimA, claimB);
    await drive(app, 'PUT', `${base}/${decisionId}/claims`, { body: { claimIds: [claimA.id, claimB.id] }, token: ownerToken });
    r = await finalize(ownerToken, decisionId);
    check('finalize with an open contradiction → 409', r.status === 409, JSON.stringify(r.body));
    check('blocker names the open contradiction', (r.body?.blockers ?? []).some((b: any) => b.kind === 'contradictions-open'), JSON.stringify(r.body?.blockers));

    // ── Regression: a SUPPORT / RELATED edge is context, not a contradiction.
    // The Contradictions list only ever shows CONTRADICT edges, so the gate must
    // not demand adjudication of an edge the room cannot see or close — the
    // "Final" decision was once permanently blocked by two RELATED edges.
    console.log('\n— related edges are not contradictions —');
    {
      const claimC = await makeClaim('Postgres stores JSON in JSONB columns.', 'gpt-oss-120b');
      const claimD = await makeClaim('Postgres suits semi-structured workloads.', 'gpt-oss-120b');
      await attachEvidence(claimC.id);
      await makeRelation(claimC, claimD); // CONTRADICT by default
      // Overwrite it to RELATED — the detector saying "thematically linked, no
      // clash". Nobody can close it from the UI, so the gate must ignore it.
      await ClaimRelationModel.updateOne(
        { conversationId: conv.id, claimAId: [claimC.id, claimD.id].sort()[0] },
        { $set: { relationship: 'RELATED' } }
      );
      const made = await create(ownerToken, {
        title: 'Adopt Postgres JSONB',
        statement: 'Store the payload column as JSONB because the schema drifts weekly.'
      });
      const relDecisionId = made.body?.decision?.id;
      await drive(app, 'PUT', `${base}/${relDecisionId}/claims`, { body: { claimIds: [claimC.id] }, token: ownerToken });
      const rr = await finalize(ownerToken, relDecisionId);
      check('a RELATED edge does not block finalize (200)', rr.status === 200, JSON.stringify(rr.body));
      check('no contradictions-open blocker for RELATED edge', !(rr.body?.blockers ?? []).some((b: any) => b.kind === 'contradictions-open'), JSON.stringify(rr.body?.blockers));
      check('status becomes finalized', rr.body?.decision?.status === 'finalized', JSON.stringify(rr.body?.decision?.status));
    }

    // A required approval still outstanding → blocked.
    const rel = await ClaimRelationModel.findOne({ conversationId: conv.id, status: 'detected' });
    await db.resolveRelation(conv.id, rel!._id, {
      status: 'resolved',
      resolution: 'Claim A is correct; the benchmark was misread.',
      resolvedBy: owner.id,
      resolvedByName: owner.name
    });
    await drive(app, 'PUT', `${base}/${decisionId}/approvers`, { body: { requiredApproverIds: [member.id] }, token: ownerToken });
    r = await finalize(ownerToken, decisionId);
    check('finalize with an outstanding approval → 409', r.status === 409, JSON.stringify(r.body));
    check('blocker names the missing approval', (r.body?.blockers ?? []).some((b: any) => b.kind === 'approvals-missing'), JSON.stringify(r.body?.blockers));

    // ── 2. The gate opens once everything is satisfied ──────────────────
    console.log('\n— gate opens when satisfied —');

    r = await drive(app, 'POST', `${base}/${decisionId}/approve`, { token: memberToken });
    check('member approval recorded (200)', r.status === 200, JSON.stringify(r.body));

    const gateRead = await drive(app, 'GET', `${base}/${decisionId}`, { token: ownerToken });
    check('GET reports ready: true', gateRead.body?.gate?.ready === true, JSON.stringify(gateRead.body?.gate));
    check('gate reports per-claim statuses', Array.isArray(gateRead.body?.gate?.claimStatuses) && gateRead.body.gate.claimStatuses.length === 2, JSON.stringify(gateRead.body?.gate?.claimStatuses));
    check('both linked claims are backed', (gateRead.body?.gate?.claimStatuses ?? []).every((s: any) => s.backed === true), JSON.stringify(gateRead.body?.gate?.claimStatuses));

    r = await finalize(ownerToken, decisionId);
    check('finalize succeeds (200)', r.status === 200, JSON.stringify(r.body));
    check('status becomes finalized', r.body?.decision?.status === 'finalized', JSON.stringify(r.body?.decision?.status));
    check('finalization recorded in history', (r.body?.decision?.history ?? []).some((h: any) => h.action === 'finalized'), 'no finalized entry');

    const auditFinalize = await AuditLogModel.findOne({ action: 'DECISION_FINALIZED', userId: owner.id }).lean();
    check('finalization audited', !!auditFinalize);

    // ── 3. A finalized decision cannot be silently changed ─────────────
    console.log('\n— finalized decisions resist silent change —');

    r = await drive(app, 'PATCH', `${base}/${decisionId}`, { body: { statement: 'Sneaky rewrite of the decision.' }, token: ownerToken });
    check('PATCH after finalize → 409', r.status === 409, JSON.stringify(r.body));

    r = await drive(app, 'PUT', `${base}/${decisionId}/claims`, { body: { claimIds: [] }, token: ownerToken });
    check('claim change after finalize → 409', r.status === 409, JSON.stringify(r.body));

    r = await drive(app, 'POST', `${base}/${decisionId}/approve`, { token: ownerToken });
    check('approve after finalize → 409', r.status === 409, JSON.stringify(r.body));

    r = await finalize(ownerToken, decisionId);
    check('redundant finalize → 409', r.status === 409, JSON.stringify(r.body));

    // The document itself is unchanged by any of those attempts.
    const stored = await DecisionModel.findById(decisionId).lean();
    check('statement was not rewritten', stored?.statement === 'Move the data-extraction step to Qwen3.8 because it is cheapest per token.', stored?.statement);
    check('claims were not unlinked', (stored?.claimIds ?? []).length === 2, JSON.stringify(stored?.claimIds));

    // A member (not owner/admin) cannot delete a finalized decision.
    r = await drive(app, 'DELETE', `${base}/${decisionId}`, { token: memberToken });
    check('member cannot delete a finalized decision → 403', r.status === 403, JSON.stringify(r.body));

    // ── 3b. An AI reference alone must not satisfy the gate ─────────────
    console.log('\n— AI references do not count as evidence —');

    const aiClaim = await makeClaim('A 2025 study shows Qwen leads on accuracy.');
    // Only an AI-generated reference backs it — exactly the hallucinated-citation
    // case the gate exists to catch.
    await EvidenceModel.create({
      _id: generateUUID(),
      claimId: aiClaim.id,
      conversationId: conv.id,
      kind: 'ai',
      title: 'Cited by the model',
      excerpt: 'According to a 2025 study…',
      aiGenerated: true,
      modelName: 'gemini-2.5-flash',
      createdAt: now()
    });
    const aiDecision = await create(ownerToken, {
      title: 'Backed only by an AI citation',
      statement: 'This decision rests entirely on a model’s own citation.'
    });
    const aiId = aiDecision.body?.decision?.id;
    await drive(app, 'PUT', `${base}/${aiId}/claims`, { body: { claimIds: [aiClaim.id] }, token: ownerToken });
    r = await finalize(ownerToken, aiId);
    check('AI-only evidence does not open the gate → 409', r.status === 409, JSON.stringify(r.body));
    check('blocker names the unevidenced claim', (r.body?.blockers ?? []).some((b: any) => b.kind === 'claims-unevidenced' && (b.claimIds ?? []).includes(aiClaim.id)), JSON.stringify(r.body?.blockers));
    check('that claim is reported as not backed', (r.body?.gate?.claimStatuses ?? []).some((s: any) => s.claimId === aiClaim.id && s.backed === false && s.evidenceCount === 0), JSON.stringify(r.body?.gate?.claimStatuses));

    // A person attaching one real piece of evidence is what opens it.
    await attachEvidence(aiClaim.id);
    r = await finalize(ownerToken, aiId);
    check('human evidence on the same claim opens the gate → 200', r.status === 200, JSON.stringify(r.body));

    // ── 4. The DIRECT API bypass attempt ────────────────────────────────
    console.log('\n— direct API bypass attempt (no UI involved) —');

    // A second decision left deliberately unready, then a raw POST finalize —
    // exactly what a hand-rolled client would try.
    const raw = await create(ownerToken, {
      title: 'Unready decision',
      statement: 'This decision has no evidence behind it at all.'
    });
    const unreadyId = raw.body?.decision?.id;
    const bypass = await drive(app, 'POST', `${base}/${unreadyId}/finalize`, { token: ownerToken });
    check('raw finalize on an unready decision → 409', bypass.status === 409, JSON.stringify(bypass.body));
    check('raw bypass is told exactly what blocks', Array.isArray(bypass.body?.blockers) && bypass.body.blockers.length > 0, JSON.stringify(bypass.body?.blockers));
    const stillDraft = await DecisionModel.findById(unreadyId).lean();
    check('bypass left the decision a draft', stillDraft?.status === 'draft', stillDraft?.status);

    // ── 5. Reopening is visible, never silent ───────────────────────────
    console.log('\n— reopening is recorded, not erased —');

    r = await drive(app, 'POST', `${base}/${decisionId}/reopen`, { body: { reason: 'The benchmark numbers were updated.' }, token: ownerToken });
    check('reopen succeeds (200)', r.status === 200, JSON.stringify(r.body));
    check('status returns to draft', r.body?.decision?.status === 'draft', JSON.stringify(r.body?.decision?.status));

    const reopened = await DecisionModel.findById(decisionId).lean();
    const actions = (reopened?.history ?? []).map((h: any) => h.action);
    check('history keeps the original finalization', actions.includes('finalized'), JSON.stringify(actions));
    check('history records the reopening', actions.includes('reopened'), JSON.stringify(actions));
    check('history is append-only in length (created+finalized+reopened ≥ 3)', (reopened?.history ?? []).length >= 3, String((reopened?.history ?? []).length));

    r = await drive(app, 'POST', `${base}/${decisionId}/reopen`, { body: { reason: 'x' }, token: ownerToken });
    check('reopen a draft → 409', r.status === 409, JSON.stringify(r.body));

    // Re-finalize, then probe the reason validation on a finalized decision —
    // otherwise the draft-status guard answers first and the 400 is never seen.
    await db.finalizeDecision(conv.id, decisionId, { id: owner.id, name: owner.name });
    r = await drive(app, 'POST', `${base}/${decisionId}/reopen`, { body: {}, token: ownerToken });
    check('reopen without a reason → 400', r.status === 400, JSON.stringify(r.body));

    r = await drive(app, 'POST', `${base}/${decisionId}/reopen`, { body: { reason: 'ab' }, token: ownerToken });
    check('reopen with too short a reason → 400', r.status === 400, JSON.stringify(r.body));

    // A member cannot reopen.
    r = await drive(app, 'POST', `${base}/${decisionId}/reopen`, { body: { reason: 'Member tries to reopen.' }, token: memberToken });
    check('member cannot reopen → 403', r.status === 403, JSON.stringify(r.body));

    // ── 6. Authorization: membership and approver scoping ───────────────
    console.log('\n— authorization —');

    outsider = await db.createUser({
      id: generateUUID(),
      name: 'Gate Outsider',
      email: `gate-outsider-${suffix}@collabz.test`,
      avatar: 'PROBE',
      role: 'user',
      createdAt: now()
    } as any, bcrypt.hashSync('probe-only', 10)) as any;
    // Register it immediately: teardown must remove this account too, even if
    // the very next line throws.
    if (outsider?.id) fixture?.userIds.push(outsider.id);
    const outsiderToken = generateAccessToken(outsider as any);

    r = await drive(app, 'GET', base, { token: outsiderToken });
    check('non-member cannot list decisions → 403', r.status === 403, JSON.stringify(r.body));

    r = await finalize(outsiderToken, decisionId);
    check('non-member cannot finalize → 403', r.status === 403, JSON.stringify(r.body));

    // Approving when not a required approver.
    const owned = await create(ownerToken, {
      title: 'Approval scoping',
      statement: 'Only the designated approver may approve this one.'
    });
    r = await drive(app, 'POST', `${base}/${owned.body?.decision?.id}/approve`, { token: memberToken });
    check('non-required approver refused → 403', r.status === 403, JSON.stringify(r.body));

    // ── 7. The workspace boundary ──────────────────────────────────────
    console.log('\n— workspace boundary —');

    // Every workspace route sits behind requireVerifiedAuth. The gate must
    // block an unconfirmed account holding a perfectly valid token...
    r = await drive(app, 'GET', '/workspaces', { token: ownerToken });
    check('unverified account refused → 403', r.status === 403, JSON.stringify(r.body));

    r = await drive(app, 'GET', '/workspaces');
    check('missing token refused → 401', r.status === 401, JSON.stringify(r.body));

    // ...and then let a verified one through, or the hub would show nobody
    // any workspaces at all. This is the failure a middleware like this is
    // most likely to have: blocking everything instead of the wrong thing.
    await UserModel.findByIdAndUpdate(owner.id, { isVerified: true });
    await UserModel.findByIdAndUpdate(member.id, { isVerified: true });
    if (outsider) await UserModel.findByIdAndUpdate(outsider.id, { isVerified: true });
    r = await drive(app, 'GET', '/workspaces', { token: ownerToken });
    const listed: any[] = Array.isArray(r.body) ? r.body : [];
    check('verified account can list workspaces → 200', r.status === 200, JSON.stringify(r.body));
    check('its own workspace is in the list',
      listed.some((w) => String(w.id ?? w._id) === String(ws._id)));

    // Channels are scoped to a workspace. An outsider must not be able to
    // enumerate them, nor delete one by guessing its id.
    r = await drive(app, 'GET', `/conversations?workspaceId=${ws._id}`, { token: outsiderToken });
    check('non-member cannot list channels → 403', r.status === 403, JSON.stringify(r.body));

    const anyConv = await ConversationModel.findOne({ workspaceId: ws._id }).lean();
    check('the room has a channel to defend', !!anyConv);
    if (anyConv) {
      const convId = String((anyConv as any)._id);
      r = await drive(app, 'DELETE', `/conversations/${convId}`, { token: outsiderToken });
      check('non-member cannot delete a channel → 403', r.status === 403, JSON.stringify(r.body));
      check('the channel is still there', !!(await ConversationModel.findById(convId)));
    }

    // Adding somebody to a workspace decides who can read every room inside
    // it, so it is the owner's call — a plain member may not do it.
    r = await drive(app, 'POST', `/workspaces/${ws._id}/invite`, {
      token: memberToken,
      body: { email: `gate-invited-${suffix}@collabz.test` }
    });
    check('member cannot invite → 403', r.status === 403, JSON.stringify(r.body));
    check('nobody was added', !(await db.getUserByEmail(`gate-invited-${suffix}@collabz.test`)));

    // ── 8. Immutability of the history array ────────────────────────────
    console.log('\n— history immutability —');

    const finalDoc = await DecisionModel.findById(decisionId).lean();
    const beforeCount = (finalDoc?.history ?? []).length;
    // No endpoint exists to edit a history entry; the only writers append. A
    // finalized decision has no mutation path at all, so the array is frozen.
    await drive(app, 'POST', `${base}/${decisionId}/reopen`, { body: { reason: 'Second reopen for the count test.' }, token: ownerToken });
    const afterDoc = await DecisionModel.findById(decisionId).lean();
    check('reopen only appended to history', (afterDoc?.history ?? []).length === beforeCount + 1, `${beforeCount} -> ${(afterDoc?.history ?? []).length}`);
    check('the earlier entries are byte-identical',
      JSON.stringify((finalDoc?.history ?? []).slice(0, beforeCount)) === JSON.stringify((afterDoc?.history ?? []).slice(0, beforeCount)));

    // ── 9. Clearing a room removes its decisions ────────────────────────
    console.log('\n— room teardown —');

    await db.clearConversationMessages(conv.id);
    const leftover = await DecisionModel.countDocuments({ conversationId: conv.id });
    check('clearing the room deletes its decisions', leftover === 0, `${leftover} remaining`);
  } finally {
    // ── cleanup everything this probe touched ───────────────────────────
    await teardown();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
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
