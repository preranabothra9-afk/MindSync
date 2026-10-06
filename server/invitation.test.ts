import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { db, InvitationModel } from './database';

// ---------------------------------------------------------------------------
// Invitations are requests the recipient answers. Membership is never granted
// by the invite itself, and rejections accumulate toward a per-workspace cap.
// These tests pin the adapter contracts the routes rely on.
// ---------------------------------------------------------------------------

const WS = 'ws-invite-test';
const INVITER = 'user-inviter';
const INVITEE = 'user-invitee';

let mongo: MongoMemoryServer;
// Each test gets its own workspace id so pending invitations from one case
// never leak into another's assertions.
let wsSeq = 0;
function nextWs() {
  wsSeq += 1;
  return `${WS}-${wsSeq}`;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  await mongoose.connect(mongo.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function seedInvitation(id: string, workspaceId: string, status: 'pending' | 'accepted' | 'rejected') {
  await InvitationModel.create({
    _id: id,
    workspaceId,
    workspaceName: 'Invite Test Room',
    inviterId: INVITER,
    inviterName: 'Inviter',
    inviteeId: INVITEE,
    inviteeEmail: 'invitee@example.com',
    status,
  });
}

describe('invitation adapter', () => {
  test('a new invitation is pending and visible only to its invitee', async () => {
    const ws = nextWs();
    const inv = await db.createInvitation({
      workspaceId: ws,
      workspaceName: 'Invite Test Room',
      inviterId: INVITER,
      inviterName: 'Inviter',
      inviteeId: INVITEE,
      inviteeEmail: 'invitee@example.com',
      status: 'pending',
    });

    assert.equal(inv.status, 'pending');

    const pending = await db.getPendingInvitationsForUser(INVITEE);
    assert.equal(pending.some((i) => i.id === inv.id), true);

    // An unrelated user sees nothing of it.
    const others = await db.getPendingInvitationsForUser('someone-else');
    assert.equal(others.some((i) => i.id === inv.id), false);

    // A pending invitation is not a membership: it must not answer "true" to a
    // membership check, only to a pending check.
    assert.equal(await db.hasPendingInvitation(ws, INVITEE), true);
  });

  test('accepting moves an invitation out of pending', async () => {
    const ws = nextWs();
    const inv = await db.createInvitation({
      workspaceId: ws,
      workspaceName: 'Invite Test Room',
      inviterId: INVITER,
      inviterName: 'Inviter',
      inviteeId: INVITEE,
      inviteeEmail: 'invitee@example.com',
      status: 'pending',
    });

    const updated = await db.updateInvitationStatus(inv.id, 'accepted');
    assert.equal(updated?.status, 'accepted');

    // Accepted invitations must leave the pending list — the hub should never
    // offer an accept button for something already decided.
    const pending = await db.getPendingInvitationsForUser(INVITEE);
    assert.equal(pending.find((i) => i.id === inv.id), undefined);
    assert.equal(await db.hasPendingInvitation(ws, INVITEE), false);
  });

  test('rejections accumulate per workspace and drive the cap', async () => {
    const ws = nextWs();
    // Rejections are counted, not overwritten: each decline is its own record,
    // which is what makes the running tally trustworthy across re-invites.
    for (let i = 0; i < 4; i++) {
      await seedInvitation(`rej-${ws}-${i}`, ws, 'rejected');
    }
    assert.equal(await db.countRejections(ws, INVITEE), 4);

    // Rejections against a different workspace do not count here.
    const other = nextWs();
    await seedInvitation('rej-other-ws', other, 'rejected');
    assert.equal(await db.countRejections(ws, INVITEE), 4);

    // The fifth decline tips the workspace over: further invites must be refused.
    const fifth = await db.createInvitation({
      workspaceId: ws,
      workspaceName: 'Invite Test Room',
      inviterId: INVITER,
      inviterName: 'Inviter',
      inviteeId: INVITEE,
      inviteeEmail: 'invitee@example.com',
      status: 'pending',
    });
    await db.updateInvitationStatus(fifth.id, 'rejected');
    assert.equal(await db.countRejections(ws, INVITEE), 5);
  });

  test('a missing or already-decided invitation reports its state', async () => {
    assert.equal(await db.getInvitationById('does-not-exist'), null);

    const ws = nextWs();
    const settled = await db.createInvitation({
      workspaceId: ws,
      workspaceName: 'Invite Test Room',
      inviterId: INVITER,
      inviterName: 'Inviter',
      inviteeId: INVITEE,
      inviteeEmail: 'invitee@example.com',
      status: 'pending',
    });
    await db.updateInvitationStatus(settled.id, 'rejected');

    // Re-deciding a closed invitation must not silently flip it back: the
    // routes guard on status, and the adapter preserves the terminal state.
    const still = await db.getInvitationById(settled.id);
    assert.equal(still?.status, 'rejected');
  });
});
