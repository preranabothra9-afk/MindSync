import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { db, ClaimModel, ClaimRelationModel, EvidenceModel } from './database';
import type { Evidence } from '../src/types';

// ---------------------------------------------------------------------------
// The evidence adapter and, more importantly, its cleanup contracts. Evidence
// must never outlive the claim it is attached to, and a contradiction's
// citations must never dangle after the evidence they point at is deleted.
// ---------------------------------------------------------------------------

const CONV = 'conv-evidence-test';

let mongo: MongoMemoryServer;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  await mongoose.connect(mongo.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seedClaim(id: string, text: string, messageId = 'msg-1') {
  await ClaimModel.create({
    _id: id,
    conversationId: CONV,
    messageId,
    modelKey: 'gemini-2.5-flash',
    modelName: 'Gemini 2.5 Flash',
    text,
  });
}

async function seedRelation(id: string, claimAId: string, claimBId: string) {
  await ClaimRelationModel.create({
    _id: id,
    conversationId: CONV,
    claimAId,
    claimBId,
    claimAText: 'A',
    claimBText: 'B',
    claimAModelName: 'M',
    claimBModelName: 'M',
    relationship: 'CONTRADICT',
    confidence: 0.9,
    explanation: 'They disagree.',
  });
}

async function attach(claimId: string, kind: Evidence['kind'], title: string): Promise<Evidence> {
  return db.createEvidence({
    id: `ev-${claimId}-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    claimId,
    conversationId: CONV,
    kind,
    title,
    aiGenerated: kind === 'ai',
    modelName: kind === 'ai' ? 'gemini-2.5-flash' : null,
    authorId: kind === 'ai' ? null : 'user-1',
    authorName: kind === 'ai' ? null : 'Tester',
  } as Evidence);
}

describe('evidence adapter', () => {
  test('creates and reads evidence for a claim, newest first', async () => {
    await seedClaim('c-read', 'Read me.');
    const first = await attach('c-read', 'url', 'First');
    await new Promise((r) => setTimeout(r, 15));
    const second = await attach('c-read', 'user', 'Second');

    const list = await db.getEvidenceForClaim(CONV, 'c-read');
    assert.equal(list.length, 2);
    assert.equal(list[0].id, second.id, 'newest first');
    assert.equal(list[1].id, first.id);
    assert.equal(list[0].kind, 'user');
  });

  test('getEvidenceForClaims batches both sides of a contradiction', async () => {
    await seedClaim('c-batch-a', 'Claim A.');
    await seedClaim('c-batch-b', 'Claim B.');
    await attach('c-batch-a', 'url', 'A link');
    await attach('c-batch-b', 'quote', 'B quote');

    const map = await db.getEvidenceForClaims(CONV, ['c-batch-a', 'c-batch-b']);
    assert.equal(map['c-batch-a'].length, 1);
    assert.equal(map['c-batch-b'].length, 1);
    assert.equal(map['c-batch-a'][0].title, 'A link');
  });

  test('getEvidenceForClaims returns an empty map for no claim ids', async () => {
    assert.deepEqual(await db.getEvidenceForClaims(CONV, []), {});
  });

  test('getEvidenceCounts tallies evidence per claim in one round trip', async () => {
    await seedClaim('c-count-a', 'Count A.');
    await seedClaim('c-count-b', 'Count B.');
    await seedClaim('c-count-c', 'Count C.');
    await attach('c-count-a', 'url', 'A link');
    await attach('c-count-a', 'quote', 'A quote');
    await attach('c-count-b', 'user', 'B note');

    const counts = await db.getEvidenceCounts(CONV, ['c-count-a', 'c-count-b', 'c-count-c']);
    assert.equal(counts['c-count-a'], 2);
    assert.equal(counts['c-count-b'], 1);
    // Claims with no evidence are absent from the map; callers read absence as 0.
    assert.equal(counts['c-count-c'], undefined);
  });

  test('getEvidenceCounts scopes to its room and handles no claim ids', async () => {
    await seedClaim('c-count-scope', 'Scoped count.');
    await attach('c-count-scope', 'url', 'Room evidence');

    assert.deepEqual(await db.getEvidenceCounts(CONV, []), {});
    assert.deepEqual(await db.getEvidenceCounts('conv-other', ['c-count-scope']), {});
  });

  test('scopes evidence to its room', async () => {
    await seedClaim('c-scope', 'Scoped.');
    await attach('c-scope', 'url', 'Room evidence');

    // A different room must not see it.
    const list = await db.getEvidenceForClaim('conv-other', 'c-scope');
    assert.equal(list.length, 0);
  });

  test('lets an author delete their own evidence', async () => {
    await seedClaim('c-del', 'Delete me.');
    const ev = await attach('c-del', 'user', 'Mine');

    const ok = await db.deleteEvidence(CONV, ev.id, 'user-1', false);
    assert.equal(ok, true);
    assert.equal((await EvidenceModel.findById(ev.id).lean()), null);
  });

  test('refuses deletion by a non-author non-moderator', async () => {
    await seedClaim('c-nodel', 'Keep me.');
    const ev = await attach('c-nodel', 'user', 'Someone elses');

    const ok = await db.deleteEvidence(CONV, ev.id, 'user-other', false);
    assert.equal(ok, false);
    assert.ok(await EvidenceModel.findById(ev.id).lean(), 'evidence survives');
  });

  test('lets a moderator delete AI evidence, which has no author', async () => {
    await seedClaim('c-ai', 'AI claim.');
    const ev = await attach('c-ai', 'ai', 'AI reference');

    // Not the author, not a moderator: refused.
    assert.equal(await db.deleteEvidence(CONV, ev.id, 'user-1', false), false);
    // As a moderator: removed.
    assert.equal(await db.deleteEvidence(CONV, ev.id, 'user-1', true), true);
  });

  test('deleting evidence pulls it from any contradiction that cited it', async () => {
    await seedClaim('c-cite', 'Cited claim.');
    await seedClaim('c-cite-other', 'The other side.');
    await seedRelation('rel-cite', 'c-cite', 'c-cite-other');
    const ev = await attach('c-cite', 'url', 'Cited link');

    await db.resolveRelation(CONV, 'rel-cite', {
      status: 'resolved',
      resolution: 'Settled on the evidence.',
      resolvedBy: 'user-1',
      resolvedByName: 'Owner',
      citedEvidenceIds: [ev.id, 'does-not-exist'],
    });

    const closed = (await ClaimRelationModel.findById('rel-cite').lean()) as any;
    assert.deepEqual(closed.citedEvidenceIds, [ev.id], 'unknown ids were dropped');

    // Removing the evidence must not leave a dangling citation behind.
    await db.deleteEvidence(CONV, ev.id, 'user-1', true);
    const after = (await ClaimRelationModel.findById('rel-cite').lean()) as any;
    assert.deepEqual(after.citedEvidenceIds, []);
  });

  test('resolveRelation dedupes cited evidence ids', async () => {
    await seedClaim('c-dedup', 'Dedup.');
    await seedClaim('c-dedup-other', 'Other.');
    await seedRelation('rel-dedup', 'c-dedup', 'c-dedup-other');
    const ev = await attach('c-dedup', 'url', 'Cited');

    await db.resolveRelation(CONV, 'rel-dedup', {
      status: 'resolved',
      resolution: 'Once is enough.',
      resolvedBy: 'user-1',
      resolvedByName: 'Owner',
      citedEvidenceIds: [ev.id, ev.id, ev.id],
    });

    const closed = (await ClaimRelationModel.findById('rel-dedup').lean()) as any;
    assert.deepEqual(closed.citedEvidenceIds, [ev.id]);
  });

  test('deleting a claim cascades to its evidence', async () => {
    await seedClaim('c-cascade', 'Going away.');
    await seedClaim('c-cascade-other', 'Stays.');
    await seedRelation('rel-cascade', 'c-cascade', 'c-cascade-other');
    const ev = await attach('c-cascade', 'url', 'Goes with the claim');

    const ok = await db.deleteClaim(CONV, 'c-cascade');
    assert.equal(ok, true);
    assert.equal(await EvidenceModel.findById(ev.id).lean(), null, 'evidence removed with its claim');
    assert.equal(await ClaimRelationModel.findById('rel-cascade').lean(), null, 'edge removed');
  });

  test('clearing a room removes all its evidence', async () => {
    await seedClaim('c-clear', 'Clearing.');
    await attach('c-clear', 'url', 'Room 1');
    await attach('c-clear', 'user', 'Room 2');

    const n = await db.deleteClaimsByConversation(CONV);
    assert.ok(n >= 1);
    assert.equal(await EvidenceModel.countDocuments({ conversationId: CONV }), 0);
  });
});
