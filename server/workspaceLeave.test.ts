import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { db, WorkspaceModel } from './database';

// ---------------------------------------------------------------------------
// Leaving a workspace is a membership write, and for an owner it is an
// ownership transfer followed by that write. These pin the data transitions
// the leave route performs, so the route can stay a thin layer over them.
// ---------------------------------------------------------------------------

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

async function seedWorkspace(id: string, ownerId: string, memberIds: string[]) {
  await WorkspaceModel.create({
    _id: id,
    name: `Room ${id}`,
    description: 'test',
    ownerId,
    memberIds,
  });
}

describe('workspace membership on leave', () => {
  test('a departing member is removed from the roster and others remain', async () => {
    const wsId = 'ws-leave-member';
    await seedWorkspace(wsId, 'owner-a', ['owner-a', 'member-b', 'member-c']);

    const ws = (await db.getWorkspaceById(wsId))!;
    ws.memberIds = ws.memberIds.filter((id) => id !== 'member-b');
    await db.updateWorkspace(wsId, { memberIds: ws.memberIds });

    const after = (await db.getWorkspaceById(wsId))!;
    assert.deepEqual(after.memberIds.sort(), ['member-c', 'owner-a']);
    // Ownership is untouched: leaving a room you don't own never reassigns it.
    assert.equal(after.ownerId, 'owner-a');
  });

  test('an owner transfer + leave hands the room over and removes the old owner', async () => {
    const wsId = 'ws-leave-owner';
    await seedWorkspace(wsId, 'owner-a', ['owner-a', 'member-b', 'member-c']);

    const ws = (await db.getWorkspaceById(wsId))!;
    // The route validates the successor against the membership before this
    // write, so member-b is known to be a current member here.
    ws.ownerId = 'member-b';
    ws.memberIds = ws.memberIds.filter((id) => id !== 'owner-a');
    await db.updateWorkspace(wsId, { ownerId: ws.ownerId, memberIds: ws.memberIds });

    const after = (await db.getWorkspaceById(wsId))!;
    assert.equal(after.ownerId, 'member-b');
    assert.deepEqual(after.memberIds.sort(), ['member-b', 'member-c']);
    // The departed owner is no longer on the roster.
    assert.equal(after.memberIds.includes('owner-a'), false);
  });

  test('a member who already left is not re-removed or duplicated', async () => {
    const wsId = 'ws-leave-idempotent';
    await seedWorkspace(wsId, 'owner-a', ['owner-a', 'member-b']);

    const ws = (await db.getWorkspaceById(wsId))!;
    for (let i = 0; i < 2; i++) {
      ws.memberIds = ws.memberIds.filter((id) => id !== 'member-b');
      await db.updateWorkspace(wsId, { memberIds: ws.memberIds });
    }

    const after = (await db.getWorkspaceById(wsId))!;
    // Filtering an absent id is stable: no phantom entries, owner preserved.
    assert.deepEqual(after.memberIds, ['owner-a']);
    assert.equal(after.ownerId, 'owner-a');
  });
});
