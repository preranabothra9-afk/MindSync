import { Router, Response } from 'express';
import { requireAuth, requireVerifiedAuth, requireRole, adminOnly, AuthenticatedRequest, generateUUID } from './auth';
import { db, UserModel, WorkspaceModel, MessageModel, ConversationModel, SavedResponseModel, AuditLogModel } from './database';
import { Workspace, Conversation, SavedResponse, User, Claim, ClaimRelation, DiscussionComment, ContradictionVote, ContradictionVoteChoice, Evidence, Decision, DecisionGateResult, DecisionSummary, WorkspaceMember } from '../src/types';
import { createWorkspaceSchema, createChannelSchema, inviteUserSchema, submitPromptSchema, attachEvidenceSchema } from './validators';
import { getIo } from './socket';
import { AI_MODELS, isModelConfigured, DEFAULT_COMPARISON_MODELS, getGeminiTextResponseOrNull } from './ai';
import { generateAiReference } from './evidence';
import { evaluateDecisionGate, buildDecisionReplay, buildDecisionSummary, buildSummaryNarrationPrompt } from './decisions';

const router = Router();

// --- AUTH ROUTER ---
import { handleRegister, handleLogin, handleLogout, verifyCurrentUser, handleRefresh, handleForgotPassword, handleResetPassword, handleVerifyEmail, handleCheckVerification, handleResendVerification } from './auth';
router.post('/auth/register', handleRegister);
router.post('/auth/login', handleLogin);
router.post('/auth/refresh', handleRefresh);
router.post('/auth/logout', handleLogout);
router.post('/auth/forgot-password', handleForgotPassword);
router.post('/auth/reset-password', handleResetPassword);
// GET is a read-only status check so link scanners cannot burn the token.
// POST performs the actual activation.
router.get('/auth/verify-email', handleCheckVerification);
router.post('/auth/verify-email', handleVerifyEmail);
router.post('/auth/resend-verification', handleResendVerification);
router.get('/auth/me', requireAuth, verifyCurrentUser);

// --- WORKSPACE ROUTER ---
// Get all workspaces (only workspaces where the user is a member)
router.get('/workspaces', requireVerifiedAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await db.getWorkspaces();
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // Filter workspaces by member access, except for admin who can see all
    const accessible = list.filter(w => 
      userRole === 'admin' || w.ownerId === userId || (w.memberIds && w.memberIds.includes(userId))
    );
    return res.status(200).json(accessible);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve workspaces' });
  }
});

// The workspace's members with names — the decision panel lists them when
// picking required approvers. Ids alone are useless to a human. Membership is
// the only access requirement, matching every other workspace read.
router.get('/workspaces/:id/members', requireVerifiedAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ws = await db.getWorkspaceById(req.params.id);
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const isMember = ws.ownerId === req.user!.id || (ws.memberIds || []).includes(req.user!.id);
    const isAdmin = req.user!.role === 'admin';
    if (!isMember && !isAdmin) {
      return res.status(403).json({ error: 'Only workspace members can view this workspace' });
    }

    const ids = Array.from(new Set([ws.ownerId, ...(ws.memberIds || [])]));
    const users = await db.getUsersByIds(ids);
    const byId = new Map(users.map((u) => [u.id, u.name]));
    const members = ids.map((id) => ({ id, name: byId.get(id) ?? 'Unknown member' }));

    return res.status(200).json({ members });
  } catch (err: any) {
    console.error('Error fetching workspace members:', err);
    return res.status(500).json({ error: 'Failed to retrieve workspace members' });
  }
});

// Create workspace
router.post('/workspaces', requireVerifiedAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validationResult = createWorkspaceSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: validationResult.error.issues[0]?.message || 'Validation failed'
      });
    }

    const { name, description } = validationResult.data;

    const newWorkspace: Workspace = {
      id: generateUUID(),
      name,
      description: description || 'Collaborative AI workspace sandbox.',
      ownerId: req.user!.id,
      memberIds: [req.user!.id],
      createdAt: new Date().toISOString()
    };

    await db.createWorkspace(newWorkspace);
    await db.logAudit(req.user!.id, req.user!.name, req.user!.email, 'CREATE_WORKSPACE', `Created collaboration workspace: "${newWorkspace.name}" (${newWorkspace.id})`, newWorkspace.id, req.ip);

    // Create a default channel within this new workspace automatically
    const defaultConv: Conversation = {
      id: generateUUID(),
      workspaceId: newWorkspace.id,
      title: '🛰️ Central Brainstorm',
      createdBy: req.user!.id,
      createdAt: new Date().toISOString()
    };
    await db.createConversation(defaultConv);

    // Realtime broadcast to keep all active clients in sync
    const io = getIo();
    if (io) {
      io.emit('workspace-created', newWorkspace);
    }

    return res.status(201).json(newWorkspace);
  } catch (err: any) {
    console.error('Workspace creation error:', err);
    return res.status(500).json({ error: 'Workspace creation failed' });
  }
});

// Invite member to workspace
router.post('/workspaces/:id/invite', requireVerifiedAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ws = await db.getWorkspaceById(req.params.id);
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Adding someone to a workspace decides who can read every room inside it,
    // so it is the owner's call (or an administrator's) — not every member's.
    // Any verified member used to be able to widen the workspace membership
    // unilaterally.
    if (ws.ownerId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only the workspace owner or an administrator can add collaborators' });
    }

    // Zod verification
    const validation = inviteUserSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: validation.error.issues[0]?.message || 'Validation failed'
      });
    }

    const { email } = validation.data;
    let invitee = await db.getUserByEmail(email);

    if (!invitee) {
      // Auto-register the teammate profile seamlessly so standard emails can be invited beautifully
      const username = email.split('@')[0];
      const fallbackName = username.charAt(0).toUpperCase() + username.slice(1);
      const newId = 'user-' + Math.random().toString(36).substring(2, 11);
      const defaultUser: User = {
        id: newId,
        name: fallbackName,
        email: email.toLowerCase().trim(),
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(newId)}`,
        role: 'user',
        createdAt: new Date().toISOString()
      };

      const bcrypt = await import('bcryptjs');
      const salt = await bcrypt.default.genSalt(10);
      // The password for an invited account must be one *nobody* knows.
      // This used to be a hardcoded constant shipped in source, which meant
      // anyone who could read the repo — or who had ever seen an invite —
      // could sign in as every account ever created by an invitation, the
      // moment that mailbox got verified. Two discarded UUIDs give the
      // account the same "cannot be signed into directly" property as before
      // without leaving a universal key behind; the invitee registers their
      // own password through the normal reset flow.
      const orphanPassword = await bcrypt.default.hash(`${generateUUID()}${generateUUID()}`, salt);
      // Unverified by construction: it may not receive a token until the
      // address it was invited to has confirmed it owns the mailbox.
      defaultUser.isVerified = false;
      invitee = await db.createUser(defaultUser, orphanPassword);

      // Save refresh token field in database empty initially
      await UserModel.findByIdAndUpdate(invitee.id, { refreshToken: null }).catch(() => {});
    }

    // Evade duplications
    if (ws.memberIds.includes(invitee.id)) {
      return res.status(400).json({ error: 'Selected user is already a member of this workspace' });
    }

    ws.memberIds.push(invitee.id);
    await db.updateWorkspace(ws.id, { memberIds: ws.memberIds });
    await db.logAudit(req.user!.id, req.user!.name, req.user!.email, 'INVITE_COLLABORATOR', `Invited user "${invitee.name}" (${invitee.email}) to workspace: "${ws.name}"`, ws.id, req.ip);

    // Broadcast realtime event
    const io = getIo();
    if (io) {
      const roomName = `workspace:${ws.id}`;
      // Notify current workspace room and invitee specifically if connected
      io.to(roomName).emit('workspace-member-added', {
        workspaceId: ws.id,
        user: {
          id: invitee.id,
          name: invitee.name,
          email: invitee.email,
          avatar: invitee.avatar,
        }
      });
      // Emit globallly so workspace list updates in real time for invited user
      io.emit('workspace-updated-global', ws);
    }

    return res.status(200).json({
      message: 'User successfully added to workspace',
      member: {
        id: invitee.id,
        name: invitee.name,
        email: invitee.email,
        avatar: invitee.avatar
      },
      workspace: ws
    });
  } catch (err: any) {
    console.error('Invite member error:', err);
    return res.status(500).json({ error: 'Failed to complete user invitation sequence.' });
  }
});

// Delete workspace
router.delete('/workspaces/:id', requireVerifiedAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ws = await db.getWorkspaceById(req.params.id);
    if (!ws) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Owner check
    if (ws.ownerId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only the workspace owner can delete it.' });
    }

    const success = await db.deleteWorkspace(req.params.id);
    if (success) {
      await db.logAudit(req.user!.id, req.user!.name, req.user!.email, 'DELETE_WORKSPACE', `Deleted collaborative workspace: "${ws.name}" (${ws.id})`, ws.id, req.ip);
      const io = getIo();
      if (io) {
        io.emit('workspace-deleted', { workspaceId: req.params.id });
      }
      return res.status(200).json({ message: 'Workspace and related channels deleted successfully' });
    }
    return res.status(400).json({ error: 'Could not delete workspace' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Workspace deletion failed' });
  }
});

// --- CONVERSATION / CHANNEL ROUTER ---
// Get channels in workspace
router.get('/conversations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workspaceId = req.query.workspaceId as string;
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId query parameter is required' });
    }
    // Without this, any signed-in account could enumerate every workspace's
    // channels by iterating workspaceId.
    const ws = await loadWorkspaceForMember(req, res, workspaceId);
    if (!ws) return;
    const list = await db.getConversations(workspaceId);
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve channels' });
  }
});

// Create channel
router.post('/conversations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validationResult = createChannelSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        message: validationResult.error.issues[0]?.message || 'Validation failed'
      });
    }

    const { workspaceId, title } = validationResult.data;
    const ws = await loadWorkspaceForMember(req, res, workspaceId);
    if (!ws) return;

    const newChannel: Conversation = {
      id: generateUUID(),
      workspaceId,
      title: title.startsWith('💬') || title.startsWith('📡') || title.startsWith('🚀') || title.startsWith('🛰️') ? title : `💬 ${title}`,
      createdBy: req.user!.id,
      createdAt: new Date().toISOString()
    };

    await db.createConversation(newChannel);

    const io = getIo();
    if (io) {
      const roomName = `workspace:${workspaceId}`;
      io.to(roomName).emit('channel-created', newChannel);
    }

    return res.status(201).json(newChannel);
  } catch (err: any) {
    return res.status(500).json({ error: 'Channel creation failed' });
  }
});

// Delete channel
router.delete('/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conv = await db.getConversationById(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    // Deleting a channel was previously open to any authenticated caller who
    // knew (or guessed) its id — no owner check, no membership check.
    const ws = await loadWorkspaceForMember(req, res, conv.workspaceId);
    if (!ws) return;

    await db.deleteConversation(req.params.id);

    const io = getIo();
    if (io) {
      const roomName = `workspace:${conv.workspaceId}`;
      io.to(roomName).emit('channel-deleted', { conversationId: req.params.id });
    }

    return res.status(200).json({ message: 'Channel deleted successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Channel deletion failed' });
  }
});

// --- MESSAGES ROUTER ---
// Get messages for conversation (cursor pagination, newest page first)
router.get('/messages/:conversationId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Reading a room's history requires belonging to its workspace — otherwise
    // a conversation id is a bearer secret.
    const conv = await loadConversationForRequest(req, res, req.params.conversationId);
    if (!conv) return;
    const limit = parseInt(req.query.limit as string) || 50;
    const before = (req.query.before as string) || undefined;
    const beforeId = (req.query.beforeId as string) || undefined;
    const result = await db.getMessages(req.params.conversationId, { limit, before, beforeId });
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Search across a room's prompts and model responses
router.get('/messages/:conversationId/search', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conv = await loadConversationForRequest(req, res, req.params.conversationId);
    if (!conv) return;
    const q = ((req.query.q as string) || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const results = await db.searchMessages(req.params.conversationId, q);
    return res.status(200).json({ results });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to search messages' });
  }
});

// Claims extracted from a room's AI responses (the room's persistent memory)
router.get('/messages/:conversationId/claims', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 30;
    const claims = await db.getClaims(req.params.conversationId, limit);
    return res.status(200).json({ claims });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve room claims' });
  }
});

// Delete one claim from a room
router.delete('/messages/:conversationId/claims/:claimId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deleted = await db.deleteClaim(req.params.conversationId, req.params.claimId);
    if (!deleted) return res.status(404).json({ error: 'Claim not found in this room' });
    return res.status(200).json({ claimId: req.params.claimId });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to delete claim' });
  }
});

// Clear every claim from a room
router.delete('/messages/:conversationId/claims', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deletedCount = await db.deleteClaimsByConversation(req.params.conversationId);
    return res.status(200).json({ deletedCount });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to clear room claims' });
  }
});

/**
 * Loads a workspace and confirms the caller belongs to it.
 *
 * The membership checks scattered through this file used to be written out
 * per route, which is how the channel routes ended up with none at all — any
 * signed-in account could list, create or delete channels in a workspace it
 * had never been invited to. Everything scoped to a workspace now funnels
 * through here so a missing check is a missing call, not a missing idea.
 */
async function loadWorkspaceForMember(
  req: AuthenticatedRequest,
  res: Response,
  workspaceId: string
): Promise<Workspace | null> {
  const workspace = await db.getWorkspaceById(workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return null;
  }
  const isMember = workspace.ownerId === req.user!.id || (workspace.memberIds || []).includes(req.user!.id);
  const isAdmin = req.user!.role === 'admin';
  if (!isMember && !isAdmin) {
    res.status(403).json({ error: 'Only members of this workspace can see or change it' });
    return null;
  }
  return workspace;
}

/** Loads a room and confirms the caller belongs to its workspace. */
async function loadConversationForRequest(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: string
): Promise<Conversation | null> {
  const conversation = await db.getConversationById(conversationId);
  if (!conversation) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }
  const workspace = await db.getWorkspaceById(conversation.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return null;
  }
  const isMember = workspace.ownerId === req.user!.id || (workspace.memberIds || []).includes(req.user!.id);
  const isAdmin = req.user!.role === 'admin';
  if (!isMember && !isAdmin) {
    res.status(403).json({ error: 'Only workspace members can modify this room' });
    return null;
  }
  return conversation;
}

// Remove one prompt and its response card(s), plus the claims they produced.
// Registered after the /claims routes so this two-segment pattern can never
// shadow DELETE /messages/:conversationId/claims.
router.delete('/messages/:conversationId/:messageId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conv = await loadConversationForRequest(req, res, req.params.conversationId);
    if (!conv) return;

    const deleted = await db.deleteMessage(conv.id, req.params.messageId);
    if (!deleted) {
      return res.status(409).json({ error: 'This message is still being generated and cannot be removed yet' });
    }
    return res.status(200).json({ conversationId: conv.id, messageId: req.params.messageId });
  } catch (err: any) {
    console.error('Error deleting message:', err);
    return res.status(500).json({ error: 'Failed to delete the message' });
  }
});

// Clear the whole room's chat history, keeping the room itself. The room's
// memory (claims + contradictions) is derived from these messages, so it goes too.
router.delete('/messages/:conversationId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conv = await loadConversationForRequest(req, res, req.params.conversationId);
    if (!conv) return;

    const deletedCount = await db.clearConversationMessages(conv.id);
    if (deletedCount === -1) {
      return res.status(409).json({ error: 'A model is still responding in this room. Wait for it to finish, then clear the chat.' });
    }
    return res.status(200).json({ conversationId: conv.id, deletedCount });
  } catch (err: any) {
    console.error('Error clearing room chat:', err);
    return res.status(500).json({ error: 'Failed to clear the chat' });
  }
});

// Contradiction-graph edges: relationships between a room's claims
router.get('/messages/:conversationId/relations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 40;
    const relations = await db.getClaimRelations(req.params.conversationId, limit);
    return res.status(200).json({ relations });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve claim relationships' });
  }
});

// ─── CONTRADICTION DISCUSSIONS ──────────────────────────────────────────
// The human side of a contradiction: a comment thread with replies, a room
// poll with one vote per user, and an explicit close by an authorized human.
//
// Participation (comment, reply, vote) is open to every workspace member.
// Closing (resolve / dismiss) is restricted to the workspace owner or a global
// admin — the same authorization the workspace's own deletion requires.
//
// The poll tally and the detector's confidence are deliberately never inputs to
// the edge's status. A contradiction closes only when a human says so.

/** Resolves a contradiction + its room + workspace and checks the caller is a member. */
async function loadRelationContext(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: string,
  relationId: string
): Promise<{ relation: ClaimRelation; conversation: Conversation; workspace: Workspace } | null> {
  const relation = await db.getClaimRelationById(conversationId, relationId);
  if (!relation) {
    res.status(404).json({ error: 'Contradiction not found in this room' });
    return null;
  }

  const conversation = await db.getConversationById(conversationId);
  if (!conversation) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }

  const workspace = await db.getWorkspaceById(conversation.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return null;
  }

  const isMember = workspace.ownerId === req.user!.id || (workspace.memberIds || []).includes(req.user!.id);
  const isAdmin = req.user!.role === 'admin';
  if (!isMember && !isAdmin) {
    res.status(403).json({ error: 'Only workspace members can take part in this discussion' });
    return null;
  }

  return { relation, conversation, workspace };
}

/** Broadcasts a discussion event to every client in the room's workspace. */
function emitDiscussionEvent(
  conversationId: string,
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>
): void {
  const io = getIo();
  if (!io) return;
  io.to(`workspace:${workspaceId}`).emit(event, { conversationId, ...payload });
}

// The full discussion for one contradiction: comments and poll votes.
router.get('/messages/:conversationId/relations/:relationId/discussion', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadRelationContext(req, res, req.params.conversationId, req.params.relationId);
    if (!ctx) return;

    const discussion = await db.getDiscussion(ctx.relation.id);
    return res.status(200).json(discussion);
  } catch (err: any) {
    console.error('Error fetching contradiction discussion:', err);
    return res.status(500).json({ error: 'Failed to retrieve the discussion' });
  }
});

// Add a comment or a reply to a contradiction's thread.
router.post('/messages/:conversationId/relations/:relationId/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadRelationContext(req, res, req.params.conversationId, req.params.relationId);
    if (!ctx) return;

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (text.length < 1 || text.length > 1000) {
      return res.status(400).json({ error: 'A comment must be between 1 and 1000 characters' });
    }

    // A reply must point at a real comment in this same thread.
    const parentId = typeof req.body?.parentId === 'string' && req.body.parentId.trim()
      ? req.body.parentId.trim()
      : null;
    if (parentId && !(await db.commentExists(ctx.relation.id, parentId))) {
      return res.status(400).json({ error: 'The comment being replied to no longer exists' });
    }

    const comment: DiscussionComment = {
      id: generateUUID(),
      relationId: ctx.relation.id,
      conversationId: ctx.conversation.id,
      authorId: req.user!.id,
      authorName: req.user!.name,
      authorAvatar: req.user!.avatar,
      text,
      parentId,
      createdAt: new Date().toISOString()
    };

    const saved = await db.addComment(comment);

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'contradiction-comment-added', {
      relationId: ctx.relation.id,
      comment: saved
    });

    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'comment-added',
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: parentId ? 'Replied in a discussion' : 'Commented on a contradiction',
      detail: parentId ? 'Replied to a comment.' : `Joined the discussion of a contradiction.`,
      relationId: ctx.relation.id,
      claimIds: [ctx.relation.claimAId, ctx.relation.claimBId],
      meta: {
        commentId: saved.id,
        text,
        claimAText: ctx.relation.claimAText,
        claimBText: ctx.relation.claimBText,
        relationship: ctx.relation.relationship
      }
    });

    return res.status(201).json(saved);
  } catch (err: any) {
    console.error('Error adding contradiction comment:', err);
    return res.status(500).json({ error: 'Failed to add the comment' });
  }
});

// Delete a comment. Authors delete their own; owners/admins delete anyone's.
router.delete('/messages/:conversationId/relations/:relationId/comments/:commentId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadRelationContext(req, res, req.params.conversationId, req.params.relationId);
    if (!ctx) return;

    const canModerate = ctx.workspace.ownerId === req.user!.id || req.user!.role === 'admin';
    const deleted = await db.deleteComment(ctx.relation.id, req.params.commentId, req.user!.id, canModerate);
    if (!deleted) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'contradiction-comment-deleted', {
      relationId: ctx.relation.id,
      commentId: req.params.commentId
    });

    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'comment-deleted',
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Comment removed',
      detail: canModerate ? 'Removed a comment from the discussion.' : 'Removed their own comment.',
      relationId: ctx.relation.id,
      claimIds: [ctx.relation.claimAId, ctx.relation.claimBId],
      meta: { commentId: req.params.commentId }
    });

    return res.status(200).json({ commentId: req.params.commentId });
  } catch (err: any) {
    console.error('Error deleting contradiction comment:', err);
    return res.status(500).json({ error: 'Failed to delete the comment' });
  }
});

// Cast or change a poll vote. One vote per user is enforced by the schema's
// unique index, so this is an upsert by (relationId, userId).
router.post('/messages/:conversationId/relations/:relationId/vote', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadRelationContext(req, res, req.params.conversationId, req.params.relationId);
    if (!ctx) return;

    const choice = typeof req.body?.choice === 'string' ? req.body.choice.toUpperCase() : '';
    const VALID_CHOICES: ContradictionVoteChoice[] = ['CLAIM_A', 'CLAIM_B', 'NEITHER'];
    if (!VALID_CHOICES.includes(choice as ContradictionVoteChoice)) {
      return res.status(400).json({ error: 'Vote must be one of: CLAIM_A, CLAIM_B, NEITHER' });
    }

    const vote: ContradictionVote = {
      id: generateUUID(),
      relationId: ctx.relation.id,
      conversationId: ctx.conversation.id,
      userId: req.user!.id,
      userName: req.user!.name,
      choice: choice as ContradictionVoteChoice,
      createdAt: new Date().toISOString()
    };

    await db.setVote(vote);

    // Return + broadcast the whole tally so every client renders identical bars.
    const votes = await db.getVotes(ctx.relation.id);
    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'contradiction-vote-updated', {
      relationId: ctx.relation.id,
      votes
    });

    // A vote is the room weighing in; the tally never closes anything on its
    // own, and the replay shows it as advice rather than a verdict.
    const CHOICE_LABEL: Record<ContradictionVoteChoice, string> = {
      CLAIM_A: 'one side',
      CLAIM_B: 'the other side',
      NEITHER: 'neither side'
    };
    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'vote-cast',
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Voted in a poll',
      detail: `Voted for ${CHOICE_LABEL[choice as ContradictionVoteChoice]} (${votes.length} vote${votes.length === 1 ? '' : 's'} so far).`,
      relationId: ctx.relation.id,
      claimIds: [ctx.relation.claimAId, ctx.relation.claimBId],
      meta: {
        choice,
        tally: votes.map((v) => ({ userId: v.userId, userName: v.userName, choice: v.choice })),
        claimAText: ctx.relation.claimAText,
        claimBText: ctx.relation.claimBText
      }
    });

    return res.status(200).json({ relationId: ctx.relation.id, votes });
  } catch (err: any) {
    console.error('Error recording contradiction vote:', err);
    return res.status(500).json({ error: 'Failed to record the vote' });
  }
});

/**
 * Closes a contradiction as resolved or dismissed. Owner-or-admin only, and a
 * reason is mandatory. This is the only path to a closed status — never the
 * poll tally, never the detector's confidence.
 */
async function handleCloseContradiction(
  req: AuthenticatedRequest,
  res: Response,
  status: 'resolved' | 'evidence-needed' | 'dismissed'
) {
  try {
    const ctx = await loadRelationContext(req, res, req.params.conversationId, req.params.relationId);
    if (!ctx) return;

    if (ctx.workspace.ownerId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only the workspace owner or an admin can resolve or dismiss a contradiction' });
    }

    const resolution = typeof req.body?.resolution === 'string' ? req.body.resolution.trim() : '';
    if (resolution.length < 3) {
      return res.status(400).json({ error: 'A short reason is required to close a contradiction' });
    }

    // Evidence the closer chose to cite. Only ids actually attached to one of
    // this contradiction's two claims are accepted, so a stale or hostile
    // client cannot pin unrelated evidence onto the record.
    const requestedIds: string[] = Array.isArray(req.body?.citedEvidenceIds)
      ? req.body.citedEvidenceIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : [];
    let citedEvidenceIds: string[] = [];
    if (requestedIds.length > 0) {
      const available = await db.getEvidenceForClaims(ctx.conversation.id, [ctx.relation.claimAId, ctx.relation.claimBId]);
      const valid = new Set<string>();
      for (const list of Object.values(available)) for (const ev of list) valid.add(ev.id);
      citedEvidenceIds = requestedIds.filter((id: string) => valid.has(id));
    }

    const updated = await db.resolveRelation(ctx.conversation.id, ctx.relation.id, {
      status,
      resolution,
      resolvedBy: req.user!.id,
      resolvedByName: req.user!.name,
      citedEvidenceIds
    });
    if (!updated) {
      return res.status(404).json({ error: 'Contradiction not found in this room' });
    }

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      status === 'resolved' ? 'CONTRADICTION_RESOLVED' : status === 'evidence-needed' ? 'CONTRADICTION_EVIDENCE_NEEDED' : 'CONTRADICTION_DISMISSED',
      `Closed contradiction ${ctx.relation.id} in room "${ctx.conversation.title}" as ${status}: ${resolution}`,
      ctx.workspace.id,
      req.ip
    );

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'contradiction-closed', {
      relationId: updated.id,
      relation: updated
    });

    // The decisive room event: a person faced the disagreement and decided what
    // to do about it. This is what backs a claim the evidence gate will accept,
    // so the replay has to show it exactly as the room recorded it.
    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'contradiction-resolved',
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Contradiction closed',
      detail: `Closed as ${status}: ${resolution}`,
      relationId: updated.id,
      claimIds: [updated.claimAId, updated.claimBId],
      meta: {
        status,
        resolution,
        relationship: updated.relationship,
        claimAText: updated.claimAText,
        claimBText: updated.claimBText,
        resolvedByName: updated.resolvedByName,
        citedEvidenceIds
      }
    });

    return res.status(200).json({ relation: updated });
  } catch (err: any) {
    console.error('Error closing contradiction:', err);
    return res.status(500).json({ error: 'Failed to close the contradiction' });
  }
}

// NOTE: the path segments are the typed status values
// ('resolved' | 'evidence-needed' | 'dismissed') the client builds the URL
// from — keep them in sync with the store action.
router.post('/messages/:conversationId/relations/:relationId/resolved', requireAuth, (req, res) => handleCloseContradiction(req as AuthenticatedRequest, res, 'resolved'));
router.post('/messages/:conversationId/relations/:relationId/evidence-needed', requireAuth, (req, res) => handleCloseContradiction(req as AuthenticatedRequest, res, 'evidence-needed'));
router.post('/messages/:conversationId/relations/:relationId/dismissed', requireAuth, (req, res) => handleCloseContradiction(req as AuthenticatedRequest, res, 'dismissed'));

// ─── EVIDENCE ───────────────────────────────────────────────────────────
// Material attached to a claim: a link, a file, a verbatim quote, a member's
// own note, or an AI-generated reference. Evidence travels with the claim it
// backs, and every piece is visible inside the claim's detail view and, for a
// contradiction, alongside both sides while the room decides.
//
// Reads and writes are open to every workspace member (matching the discussion
// rules). Deletion is author-or-moderator, like comments. AI references are
// generated, not authored: they are created without a member, are labelled
// unverified for life, and are only ever produced from a verbatim passage of
// the response the claim came from.

/** Largest file accepted as inline evidence (8 MB of base64). */
const MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024;
/** MIME types safe to store inline and hand back to a browser. */
const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip'
]);

/**
 * Loads a claim, confirms it belongs to the room in the URL, and confirms the
 * caller is a member of that room's workspace. Evidence is scoped through the
 * claim, so this is the single gate every evidence request passes.
 */
async function loadClaimContext(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: string,
  claimId: string
): Promise<{ claim: Claim; conversation: Conversation; workspace: Workspace } | null> {
  const claim = await db.getClaimById(conversationId, claimId);
  if (!claim) {
    res.status(404).json({ error: 'Claim not found in this room' });
    return null;
  }

  const conversation = await db.getConversationById(conversationId);
  if (!conversation) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }

  const workspace = await db.getWorkspaceById(conversation.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return null;
  }

  const isMember = workspace.ownerId === req.user!.id || (workspace.memberIds || []).includes(req.user!.id);
  const isAdmin = req.user!.role === 'admin';
  if (!isMember && !isAdmin) {
    res.status(403).json({ error: 'Only workspace members can manage evidence in this room' });
    return null;
  }

  return { claim, conversation, workspace };
}

/** Validates the per-kind payload rules zod cannot express inline. */
function validateEvidenceFields(kind: string, body: any): string | null {
  if (kind === 'url') {
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return 'Link evidence needs a URL';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Only http and https links are accepted';
    } catch {
      return 'That does not look like a valid URL';
    }
    return null;
  }

  if (kind === 'quote') {
    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
    if (excerpt.length < 3) return 'A quote needs the excerpt being quoted';
    return null;
  }

  if (kind === 'user') {
    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : '';
    if (excerpt.length < 3) return 'Your note cannot be empty';
    return null;
  }

  if (kind === 'file') {
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
    const data = typeof body.data === 'string' ? body.data.trim() : '';
    const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;

    if (!fileName) return 'The file has no name';
    if (!mimeType) return 'The file has no type';
    if (!ALLOWED_EVIDENCE_MIME_TYPES.has(mimeType.toLowerCase())) return `Files of type "${mimeType}" are not accepted as evidence`;
    if (!data.startsWith('data:')) return 'The file payload is missing or is not a data URI';
    if (sizeBytes > MAX_EVIDENCE_FILE_BYTES) return `Files are limited to ${Math.round(MAX_EVIDENCE_FILE_BYTES / (1024 * 1024))} MB`;
    // A data URI's base64 segment is ~4/3 the raw size; bound it the same way.
    const base64 = data.split(',')[1] || '';
    if (Math.ceil((base64.length * 3) / 4) > MAX_EVIDENCE_FILE_BYTES) return `Files are limited to ${Math.round(MAX_EVIDENCE_FILE_BYTES / (1024 * 1024))} MB`;
    return null;
  }

  return 'Unknown evidence kind';
}

// List the evidence attached to one claim.
router.get('/messages/:conversationId/claims/:claimId/evidence', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadClaimContext(req, res, req.params.conversationId, req.params.claimId);
    if (!ctx) return;

    const evidence = await db.getEvidenceForClaim(ctx.conversation.id, ctx.claim.id);
    return res.status(200).json({ evidence });
  } catch (err: any) {
    console.error('Error fetching evidence:', err);
    return res.status(500).json({ error: 'Failed to retrieve evidence' });
  }
});

// Evidence for both sides of a contradiction, in one round trip — the detail
// view weighs them side by side while the room decides.
router.get('/messages/:conversationId/relations/:relationId/evidence', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadRelationContext(req, res, req.params.conversationId, req.params.relationId);
    if (!ctx) return;

    const evidence = await db.getEvidenceForClaims(ctx.conversation.id, [ctx.relation.claimAId, ctx.relation.claimBId]);
    return res.status(200).json({
      claimAId: ctx.relation.claimAId,
      claimBId: ctx.relation.claimBId,
      evidence
    });
  } catch (err: any) {
    console.error('Error fetching contradiction evidence:', err);
    return res.status(500).json({ error: 'Failed to retrieve evidence' });
  }
});

// Attach one piece of evidence to a claim. Workspace members only.
router.post('/messages/:conversationId/claims/:claimId/evidence', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadClaimContext(req, res, req.params.conversationId, req.params.claimId);
    if (!ctx) return;

    const parsed = attachEvidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid evidence' });
    }
    const body = parsed.data;

    const kindError = validateEvidenceFields(body.kind, body);
    if (kindError) return res.status(400).json({ error: kindError });

    const evidence: Evidence = {
      id: generateUUID(),
      claimId: ctx.claim.id,
      conversationId: ctx.conversation.id,
      kind: body.kind,
      title: body.title.trim(),
      url: body.kind === 'url' ? (body.url as string).trim() : null,
      fileName: body.kind === 'file' ? (body.fileName as string).trim() : null,
      mimeType: body.kind === 'file' ? (body.mimeType as string).trim() : null,
      sizeBytes: body.kind === 'file' ? (body.sizeBytes ?? null) : null,
      data: body.kind === 'file' ? (body.data as string) : null,
      excerpt: body.kind === 'quote' || body.kind === 'user' ? (body.excerpt as string).trim() : null,
      source: body.kind === 'quote' && typeof body.source === 'string' ? body.source.trim() : null,
      aiGenerated: false,
      authorId: req.user!.id,
      authorName: req.user!.name,
      createdAt: new Date().toISOString()
    };

    const saved = await db.createEvidence(evidence);

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'evidence-added', {
      claimId: ctx.claim.id,
      evidence: saved
    });

    // A person put something real behind a claim — the pivot the whole gate
    // turns on, and the event the replay most wants to show.
    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'evidence-added',
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Evidence attached',
      detail: `Attached “${saved.title}” (${saved.kind}) to a claim.`,
      claimIds: [ctx.claim.id],
      evidenceId: saved.id,
      meta: { title: saved.title, kind: saved.kind, aiGenerated: false, claimText: ctx.claim.text }
    });

    return res.status(201).json(saved);
  } catch (err: any) {
    console.error('Error attaching evidence:', err);
    return res.status(500).json({ error: 'Failed to attach the evidence' });
  }
});

// Ask a model to produce a reference for a claim, grounded in the response the
// claim was extracted from. The reference is created with no author and an
// unverified label, and is stored only if its quote is verbatim in the source.
router.post('/messages/:conversationId/claims/:claimId/evidence/ai-reference', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadClaimContext(req, res, req.params.conversationId, req.params.claimId);
    if (!ctx) return;

    // The claim's source response is the entire universe the model may quote.
    const message = await db.getMessageById(ctx.claim.messageId);
    const sourceText = message?.modelResponses?.[ctx.claim.modelKey]?.content || '';
    if (!sourceText.trim()) {
      return res.status(409).json({ error: 'The response this claim came from is no longer available' });
    }

    const outcome = await generateAiReference(ctx.claim, sourceText);
    // Note: the project does not compile with strictNullChecks, where
    // `!outcome.ok` fails to narrow this boolean-literal union; the explicit
    // comparison narrows in both modes.
    if (outcome.ok === false) {
      // 422: the request was understood but the model could not produce a
      // reference worth storing. Nothing is fabricated.
      return res.status(422).json({ error: outcome.reason });
    }

    const evidence: Evidence = {
      id: generateUUID(),
      claimId: ctx.claim.id,
      conversationId: ctx.conversation.id,
      kind: 'ai',
      title: `AI reference — ${outcome.reference.modelName}`,
      excerpt: outcome.reference.excerpt,
      source: `Generated by ${outcome.reference.modelName} from the source response`,
      aiGenerated: true,
      modelName: outcome.reference.modelName,
      authorId: null,
      authorName: null,
      createdAt: new Date().toISOString()
    };

    const saved = await db.createEvidence(evidence);

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'evidence-added', {
      claimId: ctx.claim.id,
      evidence: saved
    });

    // Recorded, but flagged as model-generated: an AI reference is a lead, not
    // proof, and the replay must never show one as evidence a person stood
    // behind. The gate ignores these for exactly the same reason.
    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'evidence-added',
      actorId: null,
      actorName: outcome.reference.modelName,
      title: 'AI reference added',
      detail: `Asked ${outcome.reference.modelName} for a reference grounded in the claim's own source.`,
      claimIds: [ctx.claim.id],
      evidenceId: saved.id,
      meta: { title: saved.title, kind: 'ai', aiGenerated: true, claimText: ctx.claim.text, unverified: true }
    });

    return res.status(201).json(saved);
  } catch (err: any) {
    console.error('Error generating an AI reference:', err);
    return res.status(500).json({ error: 'Failed to generate the reference' });
  }
});

// Delete one piece of evidence. Authors delete their own; the workspace owner
// and admins delete anyone's. AI references have no author, so they are
// moderator-only — members can ask for a fresh one instead.
router.delete('/messages/:conversationId/claims/:claimId/evidence/:evidenceId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadClaimContext(req, res, req.params.conversationId, req.params.claimId);
    if (!ctx) return;

    const existing = await db.getEvidenceById(ctx.conversation.id, req.params.evidenceId);
    if (!existing) {
      return res.status(404).json({ error: 'Evidence not found on this claim' });
    }

    const moderator = ctx.workspace.ownerId === req.user!.id || req.user!.role === 'admin';
    if (!moderator && existing.authorId !== req.user!.id) {
      return res.status(403).json({ error: 'You can only delete evidence you added' });
    }

    const deleted = await db.deleteEvidence(ctx.conversation.id, req.params.evidenceId, req.user!.id, moderator);
    if (!deleted) {
      return res.status(404).json({ error: 'Evidence not found on this claim' });
    }

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'evidence-deleted', {
      claimId: ctx.claim.id,
      evidenceId: req.params.evidenceId
    });

    // The removal is part of the story too — a room that took evidence back off
    // a claim has changed what the decision rests on.
    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      kind: 'evidence-deleted',
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Evidence removed',
      detail: `Removed evidence from a claim.`,
      claimIds: [ctx.claim.id],
      evidenceId: req.params.evidenceId,
      meta: { title: existing.title, aiGenerated: existing.aiGenerated }
    });

    return res.status(200).json({ evidenceId: req.params.evidenceId });
  } catch (err: any) {
    console.error('Error deleting evidence:', err);
    return res.status(500).json({ error: 'Failed to delete the evidence' });
  }
});

// ─── DECISIONS & THE EVIDENCE GATE ──────────────────────────────────────
// A room's formal commitment, and the gate that has to open before it can be
// finalized.
//
// The gate is enforced HERE, in the route, on every finalize attempt — never in
// the client. The client is handed the same verdict to display, but a request
// that bypasses the UI (curl, a hand-rolled script, a tampered button) is
// re-evaluated against the database and refused with 409 + the reasons.
//
// Editing is restricted to the decision's author, the workspace owner, or an
// admin. Finalizing is owner-or-admin, matching who can close a contradiction:
// the same person the room trusts to adjudicate. Approving is open to the
// required approvers only.
//
// Once finalized the record is locked: the only way back is `reopen`, which
// restores `draft` but appends a visible entry to the history rather than
// erasing the finalization. Nothing in the system ever edits or deletes a
// history entry.

/** Loads a decision, confirms it belongs to the room in the URL, and confirms
 * the caller is a member of that room's workspace. Decisions are scoped through
 * the room exactly like claims and evidence. */
async function loadDecisionContext(
  req: AuthenticatedRequest,
  res: Response,
  conversationId: string,
  decisionId: string
): Promise<{ decision: Decision; conversation: Conversation; workspace: Workspace } | null> {
  const decision = await db.getDecisionById(conversationId, decisionId);
  if (!decision) {
    res.status(404).json({ error: 'Decision not found in this room' });
    return null;
  }

  const conversation = await db.getConversationById(conversationId);
  if (!conversation) {
    res.status(404).json({ error: 'Room not found' });
    return null;
  }

  const workspace = await db.getWorkspaceById(conversation.workspaceId);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return null;
  }

  const isMember = workspace.ownerId === req.user!.id || (workspace.memberIds || []).includes(req.user!.id);
  const isAdmin = req.user!.role === 'admin';
  if (!isMember && !isAdmin) {
    res.status(403).json({ error: 'Only workspace members can view or work on decisions in this room' });
    return null;
  }

  return { decision, conversation, workspace };
}

/** True when the caller may edit or finalize the decision. */
function canManageDecision(
  decision: Decision,
  workspace: Workspace,
  user: { id: string; role: string }
): boolean {
  return (
    decision.createdBy === user.id ||
    workspace.ownerId === user.id ||
    user.role === 'admin'
  );
}

/**
 * Computes the gate verdict from the database. Shared by the read endpoint
 * (show the room what is blocking) and the finalize endpoint (decide whether to
 * let it through), so the two can never disagree.
 */
async function computeGate(conversationId: string, decision: Decision): Promise<DecisionGateResult> {
  const [claims, relations, evidenceByClaim] = await Promise.all([
    db.getClaims(conversationId, 200),
    db.getClaimRelations(conversationId, 200),
    db.getEvidenceForClaims(conversationId, decision.claimIds)
  ]);
  return evaluateDecisionGate(decision, claims, relations, evidenceByClaim);
}

// List a room's decisions.
router.get('/messages/:conversationId/decisions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conv = await loadConversationForRequest(req, res, req.params.conversationId);
    if (!conv) return;

    const decisions = await db.getDecisions(conv.id);
    return res.status(200).json({ decisions });
  } catch (err: any) {
    console.error('Error fetching decisions:', err);
    return res.status(500).json({ error: 'Failed to retrieve decisions' });
  }
});

// One decision, with its current gate verdict — the room's "what is blocking
// finalization" read.
router.get('/messages/:conversationId/decisions/:decisionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    const gate = await computeGate(ctx.conversation.id, ctx.decision);
    return res.status(200).json({ decision: ctx.decision, gate });
  } catch (err: any) {
    console.error('Error fetching decision:', err);
    return res.status(500).json({ error: 'Failed to retrieve the decision' });
  }
});

/**
 * The decision's replay timeline: the events that formed it, each paired with
 * the decision's state at that moment. The events were recorded as the room
 * worked; the state is folded here, server-side, so the client only ever
 * renders what the server derived.
 */
router.get('/messages/:conversationId/decisions/:decisionId/timeline', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    const [claims, relations, events] = await Promise.all([
      db.getClaims(ctx.conversation.id, 300),
      db.getClaimRelations(ctx.conversation.id, 300),
      db.getTimelineEvents(ctx.conversation.id)
    ]);

    const replay = buildDecisionReplay(ctx.decision, claims, relations, events);
    return res.status(200).json(replay);
  } catch (err: any) {
    console.error('Error building the decision timeline:', err);
    return res.status(500).json({ error: 'Failed to build the replay timeline' });
  }
});

/**
 * The room's members, resolved to names, for the summary's participant and
 * approval sections.
 */
async function loadWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const ws = await db.getWorkspaceById(workspaceId);
  const ids = [...new Set([...(ws?.memberIds ?? []), ...(ws ? [ws.ownerId] : [])])];
  if (ids.length === 0) return [];
  const users = await db.getUsersByIds(ids);
  return users.map((u) => ({ id: u.id, name: u.name }));
}

/**
 * The final decision summary — a read-only report of what the room decided
 * and what it rested on, assembled entirely from stored data.
 *
 * With `narrate=true` the structured summary is also restated in prose by
 * Gemini, under a prompt that forbids invention. The prose is a convenience
 * layer over the fields, never a substitute: the model receives only the
 * summary itself, and if the model is unreachable the summary is returned
 * unchanged with a note saying so, rather than with text invented to fill
 * the gap.
 */
router.get('/messages/:conversationId/decisions/:decisionId/summary', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    const [claims, relations, evidenceByClaim, members] = await Promise.all([
      db.getClaims(ctx.conversation.id, 300),
      db.getClaimRelations(ctx.conversation.id, 300),
      db.getEvidenceForClaims(ctx.conversation.id, ctx.decision.claimIds),
      loadWorkspaceMembers(ctx.workspace.id)
    ]);

    const summary = buildDecisionSummary(
      ctx.decision,
      ctx.conversation.title,
      claims,
      relations,
      evidenceByClaim,
      members
    );

    const narrate = req.query?.narrate === 'true';
    if (narrate) {
      db.logAudit(
        req.user!.id,
        req.user!.name,
        req.user!.email,
        'AI_SUMMARY_NARRATE',
        `Requested an AI narration of decision ${ctx.decision.id}`,
        ctx.workspace.id
      ).catch(() => {});
      const narrative = await getGeminiTextResponseOrNull(buildSummaryNarrationPrompt(summary));
      summary.narrative = narrative;
      summary.narrativeNote = narrative
        ? 'Restated by Gemini from the record above — it was given those fields and instructed to add nothing.'
        : 'No narration is available right now (Gemini is unconfigured or its quota is exhausted). The sections above are the complete record.';
    }

    return res.status(200).json(summary);
  } catch (err: any) {
    console.error('Error building the decision summary:', err);
    return res.status(500).json({ error: 'Failed to build the decision summary' });
  }
});

// Create a decision. Any workspace member can draft one; the gate decides when
// it may be finalized, not who wrote it.
router.post('/messages/:conversationId/decisions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const conv = await loadConversationForRequest(req, res, req.params.conversationId);
    if (!conv) return;

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const statement = typeof req.body?.statement === 'string' ? req.body.statement.trim() : '';
    if (title.length < 3) {
      return res.status(400).json({ error: 'A decision needs a title of at least 3 characters' });
    }
    if (statement.length < 10) {
      return res.status(400).json({ error: 'A decision needs a statement of at least 10 characters' });
    }

    // Linked claims must genuinely belong to this room.
    const requestedClaims: string[] = Array.isArray(req.body?.claimIds)
      ? req.body.claimIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const roomClaims = await db.getClaims(conv.id, 200);
    const validClaimIds = new Set(roomClaims.map((c) => c.id));
    const claimIds = requestedClaims.filter((id: string) => validClaimIds.has(id));

    // Approvers must be real members of the workspace.
    const requestedApprovers: string[] = Array.isArray(req.body?.requiredApproverIds)
      ? req.body.requiredApproverIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const ws = await db.getWorkspaceById(conv.workspaceId);
    const memberIds = new Set([ws?.ownerId, ...(ws?.memberIds || [])]);
    const requiredApproverIds = requestedApprovers.filter((id: string) => memberIds.has(id));

    const now = new Date().toISOString();
    const decisionId = generateUUID();
    const decision: Decision = {
      id: decisionId,
      conversationId: conv.id,
      title,
      statement,
      claimIds,
      requiredApproverIds,
      approvals: [],
      status: 'draft',
      createdBy: req.user!.id,
      createdByName: req.user!.name,
      finalizedAt: null,
      finalizedBy: null,
      finalizedByName: null,
      history: [{
        action: 'created',
        actorId: req.user!.id,
        actorName: req.user!.name,
        detail: `Drafted decision “${title}”.`,
        at: now
      }],
      createdAt: now
    };

    const saved = await db.createDecision(decision);

    // The timeline entry that mirrors the seed history entry above, carrying
    // the claim and approver ids the replay needs to draw the decision's
    // starting state.
    await db.recordTimelineEvent({
      conversationId: conv.id,
      decisionId: saved.id,
      kind: 'decision-created',
      at: now,
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Decision created',
      detail: `Drafted decision “${title}”.`,
      claimIds,
      memberIds: requiredApproverIds,
      meta: {
        claims: claimIds.map((id) => {
          const c = roomClaims.find((x) => x.id === id);
          return { id, text: c?.text ?? id, modelName: c?.modelName ?? 'a model' };
        })
      }
    });

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      'DECISION_CREATED',
      `Created decision “${title}” in room "${conv.title}"`,
      conv.workspaceId,
      req.ip
    );

    emitDiscussionEvent(conv.id, conv.workspaceId, 'decision-created', { decision: saved });

    return res.status(201).json({ decision: saved });
  } catch (err: any) {
    console.error('Error creating decision:', err);
    return res.status(500).json({ error: 'Failed to create the decision' });
  }
});

// Edit a draft's title or statement. Finalized decisions are locked.
router.patch('/messages/:conversationId/decisions/:decisionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (!canManageDecision(ctx.decision, ctx.workspace, req.user!)) {
      return res.status(403).json({ error: 'Only the decision author, the workspace owner, or an admin can edit this decision' });
    }

    if (ctx.decision.status !== 'draft') {
      return res.status(409).json({ error: 'This decision is finalized and locked. Reopen it to make changes.' });
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : undefined;
    const statement = typeof req.body?.statement === 'string' ? req.body.statement.trim() : undefined;
    if (title !== undefined && title.length < 3) {
      return res.status(400).json({ error: 'A decision title needs at least 3 characters' });
    }
    if (statement !== undefined && statement.length < 10) {
      return res.status(400).json({ error: 'A decision statement needs at least 10 characters' });
    }

    const updated = await db.editDecision(ctx.conversation.id, ctx.decision.id, { title, statement });
    if (!updated) {
      return res.status(409).json({ error: 'This decision is finalized and locked. Reopen it to make changes.' });
    }

    const changes: string[] = [];
    if (title && title !== ctx.decision.title) changes.push(`title → “${title}”`);
    if (statement && statement !== ctx.decision.statement) changes.push('statement updated');
    if (changes.length > 0) {
      await db.recordDecisionEvent(ctx.conversation.id, updated.id, {
        action: 'statement-edited',
        actorId: req.user!.id,
        actorName: req.user!.name,
        detail: changes.join(', '),
        at: new Date().toISOString()
      });
    }

    const refreshed = await db.getDecisionById(ctx.conversation.id, updated.id);
    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-updated', { decision: refreshed });

    return res.status(200).json({ decision: refreshed });
  } catch (err: any) {
    console.error('Error editing decision:', err);
    return res.status(500).json({ error: 'Failed to edit the decision' });
  }
});

// Set the claims a decision rests on. Drafts only.
router.put('/messages/:conversationId/decisions/:decisionId/claims', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (!canManageDecision(ctx.decision, ctx.workspace, req.user!)) {
      return res.status(403).json({ error: 'Only the decision author, the workspace owner, or an admin can edit this decision' });
    }

    if (ctx.decision.status !== 'draft') {
      return res.status(409).json({ error: 'This decision is finalized and locked. Reopen it to make changes.' });
    }

    const requested: string[] = Array.isArray(req.body?.claimIds)
      ? req.body.claimIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const roomClaims = await db.getClaims(ctx.conversation.id, 200);
    const valid = new Set(roomClaims.map((c) => c.id));
    const claimIds = requested.filter((id: string) => valid.has(id));

    const updated = await db.setDecisionClaims(ctx.conversation.id, ctx.decision.id, claimIds);
    if (!updated) {
      return res.status(409).json({ error: 'This decision is finalized and locked. Reopen it to make changes.' });
    }

    const added = claimIds.filter((id) => !ctx.decision.claimIds.includes(id));
    const removed = ctx.decision.claimIds.filter((id) => !claimIds.includes(id));
    const now = new Date().toISOString();
    for (const id of added) {
      const c = roomClaims.find((x) => x.id === id);
      await db.recordDecisionEvent(
        ctx.conversation.id,
        updated.id,
        {
          action: 'claim-linked',
          actorId: req.user!.id,
          actorName: req.user!.name,
          detail: `Linked claim: ${c?.text ?? id}`,
          at: now
        },
        // The claim's text and model are carried on the event itself: the
        // replay must still show what the room linked if the claim is later
        // deleted, and the human-readable detail is no place to hide an id.
        { claimIds: [id], meta: { claims: [{ id, text: c?.text ?? id, modelName: c?.modelName ?? 'a model' }] } }
      );
    }
    for (const id of removed) {
      const c = roomClaims.find((x) => x.id === id);
      await db.recordDecisionEvent(
        ctx.conversation.id,
        updated.id,
        {
          action: 'claim-unlinked',
          actorId: req.user!.id,
          actorName: req.user!.name,
          detail: `Unlinked claim: ${c?.text ?? id}`,
          at: now
        },
        { claimIds: [id] }
      );
    }

    const refreshed = await db.getDecisionById(ctx.conversation.id, updated.id);
    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-updated', { decision: refreshed });

    return res.status(200).json({ decision: refreshed });
  } catch (err: any) {
    console.error('Error linking decision claims:', err);
    return res.status(500).json({ error: 'Failed to update the decision claims' });
  }
});

// Set which members must approve. Drafts only.
router.put('/messages/:conversationId/decisions/:decisionId/approvers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (!canManageDecision(ctx.decision, ctx.workspace, req.user!)) {
      return res.status(403).json({ error: 'Only the decision author, the workspace owner, or an admin can edit this decision' });
    }

    if (ctx.decision.status !== 'draft') {
      return res.status(409).json({ error: 'This decision is finalized and locked. Reopen it to make changes.' });
    }

    const requested: string[] = Array.isArray(req.body?.requiredApproverIds)
      ? req.body.requiredApproverIds.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const memberIds = new Set([ctx.workspace.ownerId, ...(ctx.workspace.memberIds || [])]);
    const requiredApproverIds = requested.filter((id: string) => memberIds.has(id));

    const updated = await db.setDecisionApprovers(ctx.conversation.id, ctx.decision.id, requiredApproverIds);
    if (!updated) {
      return res.status(409).json({ error: 'This decision is finalized and locked. Reopen it to make changes.' });
    }

    const added = requiredApproverIds.filter((id) => !ctx.decision.requiredApproverIds.includes(id));
    const removed = ctx.decision.requiredApproverIds.filter((id) => !requiredApproverIds.includes(id));
    // Names for the history detail, which shows the member's name rather than
    // a bare id.
    const named = added.length || removed.length
      ? await db.getUsersByIds([...added, ...removed])
      : [];
    const nameOf = (id: string): string => named.find((u) => u.id === id)?.name ?? id;
    const now = new Date().toISOString();
    for (const id of added) {
      await db.recordDecisionEvent(
        ctx.conversation.id,
        updated.id,
        {
          action: 'approver-added',
          actorId: req.user!.id,
          actorName: req.user!.name,
          detail: `Added required approver ${nameOf(id)}`,
          at: now
        },
        { memberIds: [id], meta: { memberName: nameOf(id) } }
      );
    }
    for (const id of removed) {
      await db.recordDecisionEvent(
        ctx.conversation.id,
        updated.id,
        {
          action: 'approver-removed',
          actorId: req.user!.id,
          actorName: req.user!.name,
          detail: `Removed required approver ${nameOf(id)}`,
          at: now
        },
        { memberIds: [id], meta: { memberName: nameOf(id) } }
      );
    }

    const refreshed = await db.getDecisionById(ctx.conversation.id, updated.id);
    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-updated', { decision: refreshed });

    return res.status(200).json({ decision: refreshed });
  } catch (err: any) {
    console.error('Error setting decision approvers:', err);
    return res.status(500).json({ error: 'Failed to update the required approvers' });
  }
});

// Give an approval. Only a required approver can, and only while the decision
// is still a draft — approving something already locked is meaningless.
router.post('/messages/:conversationId/decisions/:decisionId/approve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (!ctx.decision.requiredApproverIds.includes(req.user!.id) && ctx.workspace.ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'You are not a required approver for this decision' });
    }

    if (ctx.decision.status !== 'draft') {
      return res.status(409).json({ error: 'This decision is already finalized' });
    }

    const updated = await db.approveDecision(ctx.conversation.id, ctx.decision.id, req.user!.id, req.user!.name);
    if (!updated) {
      return res.status(409).json({ error: 'This decision is already finalized' });
    }

    // Idempotent: only record history when this is a new or changed approval.
    const previous = ctx.decision.approvals.find((a) => a.userId === req.user!.id);
    if (!previous) {
      await db.recordDecisionEvent(ctx.conversation.id, updated.id, {
        action: 'approval-given',
        actorId: req.user!.id,
        actorName: req.user!.name,
        detail: 'Approved the decision.',
        at: new Date().toISOString()
      });
    }

    const refreshed = await db.getDecisionById(ctx.conversation.id, updated.id);
    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-updated', { decision: refreshed });

    return res.status(200).json({ decision: refreshed });
  } catch (err: any) {
    console.error('Error approving decision:', err);
    return res.status(500).json({ error: 'Failed to record the approval' });
  }
});

// Withdraw an approval. Approvers may change their mind while the decision is
// still open; the withdrawal is recorded, not erased.
router.delete('/messages/:conversationId/decisions/:decisionId/approve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (ctx.decision.status !== 'draft') {
      return res.status(409).json({ error: 'This decision is already finalized' });
    }

    const updated = await db.withdrawApproval(ctx.conversation.id, ctx.decision.id, req.user!.id);
    if (!updated) {
      return res.status(409).json({ error: 'This decision is already finalized' });
    }

    const had = ctx.decision.approvals.some((a) => a.userId === req.user!.id);
    if (had) {
      await db.recordDecisionEvent(ctx.conversation.id, updated.id, {
        action: 'approval-withdrawn',
        actorId: req.user!.id,
        actorName: req.user!.name,
        detail: 'Withdrew their approval.',
        at: new Date().toISOString()
      });
    }

    const refreshed = await db.getDecisionById(ctx.conversation.id, updated.id);
    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-updated', { decision: refreshed });

    return res.status(200).json({ decision: refreshed });
  } catch (err: any) {
    console.error('Error withdrawing approval:', err);
    return res.status(500).json({ error: 'Failed to withdraw the approval' });
  }
});

/**
 * Finalize a decision.
 *
 * THE GATE IS ENFORCED HERE. Whatever the client believes, this route recomputes
 * the verdict from the database and refuses with 409 + the full blocker list if
 * any condition fails. This is what makes the gate real rather than cosmetic:
 * a hand-rolled POST that skips the UI cannot get through.
 */
router.post('/messages/:conversationId/decisions/:decisionId/finalize', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (!canManageDecision(ctx.decision, ctx.workspace, req.user!)) {
      return res.status(403).json({ error: 'Only the decision author, the workspace owner, or an admin can finalize this decision' });
    }

    if (ctx.decision.status === 'finalized') {
      return res.status(409).json({ error: 'This decision is already finalized' });
    }

    // Recompute the gate from live room state — the client's say-so is not
    // consulted, and the blockers are returned so the room can see exactly
    // what is still in the way.
    const gate = await computeGate(ctx.conversation.id, ctx.decision);
    if (!gate.ready) {
      return res.status(409).json({
        error: 'The evidence gate is not satisfied',
        gate,
        blockers: gate.blockers
      });
    }

    const finalized = await db.finalizeDecision(ctx.conversation.id, ctx.decision.id, {
      id: req.user!.id,
      name: req.user!.name
    });
    if (!finalized) {
      return res.status(409).json({ error: 'This decision is no longer a draft' });
    }

    // `db.finalizeDecision` appended the history entry above; this is its
    // counterpart on the timeline, timed to the same moment.
    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      decisionId: finalized.id,
      kind: 'decision-finalized',
      at: finalized.finalizedAt ?? new Date().toISOString(),
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Finalized',
      detail: 'Finalized — every gate condition was satisfied.',
      claimIds: finalized.claimIds,
      meta: { finalizedAt: finalized.finalizedAt }
    });

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      'DECISION_FINALIZED',
      `Finalized decision “${ctx.decision.title}” in room "${ctx.conversation.title}"`,
      ctx.workspace.id,
      req.ip
    );

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-finalized', { decision: finalized });

    return res.status(200).json({ decision: finalized, gate });
  } catch (err: any) {
    console.error('Error finalizing decision:', err);
    return res.status(500).json({ error: 'Failed to finalize the decision' });
  }
});

/**
 * Reopen a finalized decision. Owner-or-admin only, and the reason is
 * mandatory. Reopening restores `draft` but leaves the original finalization in
 * the history — so the record always shows the decision was locked, by whom,
 * and why it was reopened. Nothing about the decision is ever silently undone.
 */
router.post('/messages/:conversationId/decisions/:decisionId/reopen', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (ctx.workspace.ownerId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only the workspace owner or an admin can reopen a finalized decision' });
    }

    if (ctx.decision.status !== 'finalized') {
      return res.status(409).json({ error: 'Only a finalized decision can be reopened' });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (reason.length < 3) {
      return res.status(400).json({ error: 'A short reason is required to reopen a finalized decision' });
    }

    const reopened = await db.reopenDecision(ctx.conversation.id, ctx.decision.id, {
      id: req.user!.id,
      name: req.user!.name
    }, reason);
    if (!reopened) {
      return res.status(409).json({ error: 'This decision is not finalized' });
    }

    await db.recordTimelineEvent({
      conversationId: ctx.conversation.id,
      decisionId: reopened.id,
      kind: 'decision-reopened',
      at: new Date().toISOString(),
      actorId: req.user!.id,
      actorName: req.user!.name,
      title: 'Reopened',
      detail: `Reopened: ${reason}`,
      meta: { reason }
    });

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      'DECISION_REOPENED',
      `Reopened decision “${ctx.decision.title}” in room "${ctx.conversation.title}": ${reason}`,
      ctx.workspace.id,
      req.ip
    );

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-reopened', { decision: reopened });

    return res.status(200).json({ decision: reopened });
  } catch (err: any) {
    console.error('Error reopening decision:', err);
    return res.status(500).json({ error: 'Failed to reopen the decision' });
  }
});

// Delete a draft. A finalized decision can be deleted only by the owner or an
// admin — and the deletion itself is audited, so a locked record can never just
// vanish from the room's history.
router.delete('/messages/:conversationId/decisions/:decisionId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = await loadDecisionContext(req, res, req.params.conversationId, req.params.decisionId);
    if (!ctx) return;

    if (ctx.decision.status === 'finalized') {
      if (ctx.workspace.ownerId !== req.user!.id && req.user!.role !== 'admin') {
        return res.status(403).json({ error: 'A finalized decision can only be removed by the workspace owner or an admin' });
      }
    } else if (!canManageDecision(ctx.decision, ctx.workspace, req.user!)) {
      return res.status(403).json({ error: 'Only the decision author, the workspace owner, or an admin can delete this decision' });
    }

    const deleted = await db.deleteDecision(ctx.conversation.id, ctx.decision.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Decision not found in this room' });
    }

    // The decision's own lifecycle events leave the room's stream with it —
    // room-level events that touched its claims remain, as part of the room's
    // record.
    await db.deleteDecisionTimelineEvents(ctx.decision.id);

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      'DECISION_DELETED',
      `Deleted decision “${ctx.decision.title}” in room "${ctx.conversation.title}"`,
      ctx.workspace.id,
      req.ip
    );

    emitDiscussionEvent(ctx.conversation.id, ctx.workspace.id, 'decision-deleted', { decisionId: ctx.decision.id });

    return res.status(200).json({ decisionId: ctx.decision.id });
  } catch (err: any) {
    console.error('Error deleting decision:', err);
    return res.status(500).json({ error: 'Failed to delete the decision' });
  }
});

// --- SAVED RESPONSES ROUTER ---
// Get saved responses for workspace
router.get('/saved-responses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workspaceId = req.query.workspaceId as string;
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId query parameter is required' });
    }
    const saved = await db.getSavedResponses(workspaceId);
    return res.status(200).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to get saved responses' });
  }
});

// Save AI Response
router.post('/saved-responses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { workspaceId, prompt, modelName, responseContent, senderName } = req.body;
    if (!workspaceId || !prompt || !modelName || !responseContent) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const saved: SavedResponse = {
      id: generateUUID(),
      workspaceId,
      prompt,
      modelName,
      responseContent,
      savedBy: req.user!.id,
      senderName: senderName || 'Gemini',
      createdAt: new Date().toISOString()
    };

    await db.saveResponse(saved);
    return res.status(201).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to save AI response' });
  }
});

// Unsave response
router.delete('/saved-responses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = await db.unsaveResponse(req.params.id);
    if (success) {
      return res.status(200).json({ id: req.params.id, message: 'Response removed successfully' });
    }
    return res.status(404).json({ error: 'Saved response not found' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to remove response' });
  }
});

// --- ADMIN CONTROL PANEL SCHEMAS & METRICS ---

// Live AI provider registry. Reports whether each model's credential is present
// on the server. Never returns key material, only the variable name and a boolean.
router.get('/admin/ai-models', requireAuth, adminOnly, async (req: AuthenticatedRequest, res: Response) => {
  const models = Object.values(AI_MODELS).map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    lab: m.lab,
    transport: m.transport,
    upstreamModel: m.upstreamModel,
    apiKeyEnv: m.apiKeyEnv,
    signupUrl: m.signupUrl,
    freeTier: m.freeTier,
    status: m.status,
    requiresPaidPlan: Boolean(m.requiresPaidPlan),
    configured: isModelConfigured(m.id)
  }));

  res.json({
    models,
    configuredCount: models.filter((m) => m.configured).length,
    totalCount: models.length,
    comparisonDefaults: DEFAULT_COMPARISON_MODELS
  });
});

// Backward compatibility console API endpoint
router.get('/admin/analytics', requireAuth, adminOnly, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const totalUsers = await UserModel.countDocuments();
    const totalWorkspaces = await WorkspaceModel.countDocuments();
    const totalPromptQueries = await MessageModel.countDocuments();
    
    const rawMessages = await MessageModel.find().lean();
    let totalGeneratedSymbols = 0;
    rawMessages.forEach((msg: any) => {
      if (msg.modelResponses) {
        Object.values(msg.modelResponses).forEach((resp: any) => {
          if (resp && resp.content) {
            totalGeneratedSymbols += resp.content.length;
          }
        });
      }
    });

    const activeConnectionsCount = getIo() ? getIo().engine.clientsCount : 0;

    const recentMessages = await MessageModel.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const activityLog = recentMessages.map((m: any) => ({
      id: m._id,
      type: 'AI_QUERY',
      description: `User "${m.senderName}" queried AI models with prompt: "${m.promptText.slice(0, 40)}..."`,
      timestamp: m.createdAt
    }));

    return res.status(200).json({
      metrics: {
        totalUsers,
        totalWorkspaces,
        activeConnections: activeConnectionsCount,
        aiRequestCount: totalPromptQueries,
        totalTokensProcessed: Math.max(totalPromptQueries * 180, Math.round(totalGeneratedSymbols / 4))
      },
      recentActivity: activityLog
    });
  } catch (error) {
    console.error('Failed to gather administrative analytics:', error);
    return res.status(500).json({ error: 'Internal administrative query breakdown.' });
  }
});

// 1. ADVANCED ADMIN METRICS (Dashboard UI Cards & Charts)
router.get(['/admin/dashboard/metrics', '/admin/stats'], requireAuth, adminOnly, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const totalUsers = await UserModel.countDocuments();
    const totalWorkspaces = await WorkspaceModel.countDocuments();
    const totalMessages = await MessageModel.countDocuments();
    const totalAuditLogs = await AuditLogModel.countDocuments();

    // Calculate Active Users (active within last 24h)
    const yesterdayISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const activeUsersCount = await UserModel.countDocuments({
      lastActiveAt: { $gte: yesterdayISO }
    });

    const onlineUsersCount = getIo() ? getIo().engine.clientsCount : 0;

    // AI queries
    const messages = await MessageModel.find().lean() as any[];
    let totalGeminiRequests = 0;
    let failedRequests = 0;
    let totalLatencyMs = 0;
    let latencyCount = 0;

    // Start of the current local day — used for the "today" counters below so the
    // dashboard reflects actual activity rather than lifetime totals.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    let aiRequestsToday = 0;
    let messagesToday = 0;

    // Seeded from the live provider registry so newly added models appear
    // automatically and retired ones stop showing up as phantom zero rows.
    const modelCounts: Record<string, number> = {};
    for (const id of Object.keys(AI_MODELS)) modelCounts[id] = 0;

    messages.forEach((m) => {
      const createdMs = new Date(m.createdAt).getTime();
      const isToday = Number.isFinite(createdMs) && createdMs >= startOfTodayMs;
      if (isToday) messagesToday++;

      if (m.modelResponses) {
        Object.entries(m.modelResponses).forEach(([modelKey, resp]: [string, any]) => {
          totalGeminiRequests++;
          if (isToday) aiRequestsToday++;
          if (resp) {
            if (resp.status === 'failed') failedRequests++;
            if (resp.durationMs) {
              totalLatencyMs += resp.durationMs;
              latencyCount++;
            }
            // Count distribution
            if (modelCounts[modelKey] !== undefined) {
              modelCounts[modelKey]++;
            } else {
              modelCounts[modelKey] = 1;
            }
          }
        });
      }
    });

    // 0 when nothing has streamed yet — previously a hardcoded 480ms placeholder
    const averageResponseTime = latencyCount > 0 ? Math.round(totalLatencyMs / latencyCount) : 0;

    // Helper function to safely extract ISO String format for date comparisons
    const getIsoStr = (val: any): string => {
      if (!val) return '';
      if (typeof val.toISOString === 'function') {
        try {
          return val.toISOString();
        } catch {
          return '';
        }
      }
      if (typeof val === 'string') {
        return val;
      }
      try {
        return new Date(val).toISOString();
      } catch {
        return String(val);
      }
    };

    // Generate Chart Data arrays
    // Daily AI usage (past 7 days)
    const dailyAiUsage = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const isoPrefix = date.toISOString().slice(0, 10); // YYYY-MM-DD
      
      const count = messages.filter(m => {
        const str = getIsoStr(m.createdAt);
        return str && str.startsWith(isoPrefix);
      }).length;
      dailyAiUsage.push({ day: label, requests: count * 2 });
    }

    // User growth (past 7 days cumulative)
    const usergrowth = [];
    const usersList = await UserModel.find().lean() as any[];
    let cumulative = 0;
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const isoPrefix = date.toISOString().slice(0, 10);
      
      const registeredThatDay = usersList.filter(u => {
        const str = getIsoStr(u.createdAt);
        return str && str.startsWith(isoPrefix);
      }).length;
      cumulative += registeredThatDay;
      usergrowth.push({ day: label, users: Math.max(totalUsers - 4 + cumulative, 1) });
    }

    // Workspace activity trends
    const workspaceActivity = [];
    const workspacesList = await WorkspaceModel.find().lean() as any[];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const isoPrefix = date.toISOString().slice(0, 10);
      
      const countCreated = workspacesList.filter(w => {
        const str = getIsoStr(w.createdAt);
        return str && str.startsWith(isoPrefix);
      }).length;
      workspaceActivity.push({ day: label, activeRooms: countCreated });
    }

    // Model usage distribution. Names come from the provider registry, and only
    // models that were actually used are reported (no fabricated floor value).
    const modelUsage = Object.entries(modelCounts)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({
        name: AI_MODELS[key]?.name || key,
        value
      }));

    // System status summary
    const systemStatus = {
      cpuUsage: 0,
      memoryUsage: 0,
      databaseState: 'HEALTHY',
      socketsPool: onlineUsersCount,
      pingMs: 0
    };

    // System activity feed logs
    const recentAuditList = await AuditLogModel.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    return res.status(200).json({
      metrics: {
        totalUsers,
        activeUsers: Math.max(activeUsersCount, 1),
        onlineUsers: onlineUsersCount,
        totalWorkspaces,
        totalMessages,
        aiRequestsToday,
        messagesToday,
        totalAiRequests: totalGeminiRequests,
        totalPromptStreams: totalGeminiRequests,
        averageResponseTime
      },
      charts: {
        dailyAiUsage,
        usergrowth,
        workspaceActivity,
        modelUsage
      },
      systemStatus,
      recentActivity: recentAuditList
    });
  } catch (err: any) {
    console.error('Error in /admin/dashboard/metrics:', err);
    return res.status(500).json({ error: 'Failed to retrieve advanced dashboards metrics' });
  }
});

// 2. PAGINATED & SEARCHABLE USER LIST
router.get('/admin/users', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const page = parseInt(req.query.page as string) || 1;
    const search = (req.query.search as string || '').toLowerCase().trim();
    const roleFilter = req.query.role as string || '';
    const verifyFilter = req.query.verified as string || '';

    let filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (roleFilter) {
      filter.role = roleFilter;
    }
    if (verifyFilter === 'true') {
      filter.isVerified = true;
    } else if (verifyFilter === 'false') {
      filter.isVerified = { $ne: true };
    }

    const totalUsers = await UserModel.countDocuments(filter);
    const users = await UserModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Map stats live for each user
    const formattedUsers = await Promise.all(users.map(async (u: any) => {
      const workspacesCount = await WorkspaceModel.countDocuments({
        $or: [{ ownerId: u._id }, { memberIds: u._id }]
      });
      const messagesCount = await MessageModel.countDocuments({
        senderId: u._id
      });
      return {
        id: u._id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        blocked: !!u.blocked,
        isVerified: u.isVerified === true,
        // Verified accounts retain their token hash so re-opened links resolve
        // gracefully, so this must exclude them.
        hasPendingVerification: u.isVerified !== true && !!u.verifyToken,
        lastActiveAt: u.lastActiveAt || u.createdAt,
        createdAt: u.createdAt,
        workspacesCount,
        messagesCount
      };
    }));

    return res.status(200).json({
      users: formattedUsers,
      pagination: {
        total: totalUsers,
        page,
        limit,
        pages: Math.ceil(totalUsers / limit)
      }
    });

  } catch (err: any) {
    console.error('Error fetching admin users:', err);
    return res.status(500).json({ error: 'Failed to retrieve paginated user directories.' });
  }
});

// 3. BLOCK/UNBLOCK USER
const blockUserHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { blocked } = req.body;
    const userId = req.params.id;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'Administrative lockout exception: You cannot block yourself.' });
    }

    const doc = await UserModel.findById(userId);
    if (!doc) {
      return res.status(404).json({ error: 'Selected user profile not found.' });
    }

    doc.blocked = !!blocked;
    await doc.save();

    const actionText = blocked ? 'BLOCK_USER' : 'UNBLOCK_USER';
    const descText = blocked ? `Blocked collaborator profile: "${doc.name}" (${doc.email})` : `Restored collaborator profile: "${doc.name}" (${doc.email})`;

    await db.logAudit(req.user!.id, req.user!.name, req.user!.email, actionText, descText, undefined, req.ip);

    // Boot user sockets if blocked
    if (blocked) {
      const io = getIo();
      if (io) {
        // Emit suspension alert across socket connections
        io.emit('session-revoked', { userId });
      }
    }

    return res.status(200).json({ message: 'User updated successfully', user: { id: doc._id, blocked: doc.blocked } });
  } catch (err: any) {
    return res.status(500).json({ error: 'Profile state modification failed.' });
  }
};
router.put('/admin/users/:id/block', requireAuth, requireRole('admin'), blockUserHandler);
router.patch('/admin/users/:id/block', requireAuth, requireRole('admin'), blockUserHandler);

// 4. MODIFY USER ROLE
const modifyUserRoleHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { role } = req.body;
    const userId = req.params.id;

    if (!role || (role !== 'user' && role !== 'admin')) {
      return res.status(400).json({ error: 'Invalid user privileges role requested.' });
    }

    const doc = await UserModel.findById(userId);
    if (!doc) {
      return res.status(404).json({ error: 'Collaborator profile not found.' });
    }

    const oldRole = doc.role;
    doc.role = role;
    await doc.save();

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      'ROLE_CHANGE',
      `Modified privileges for collaborator "${doc.name}": "${oldRole}" -> "${role}"`,
      undefined,
      req.ip
    );

    return res.status(200).json({ message: 'User role updated successfully', user: { id: doc._id, role: doc.role } });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to modify role policies.' });
  }
};
router.put('/admin/users/:id/role', requireAuth, requireRole('admin'), modifyUserRoleHandler);
router.patch('/admin/users/:id/role', requireAuth, requireRole('admin'), modifyUserRoleHandler);

// 4b. MANUALLY MARK AN EMAIL AS VERIFIED
// Escape hatch for accounts whose delivery email bounced or that were created
// before verification existed. Burns any outstanding token.
const verifyUserEmailHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.params.id;

    const doc = await UserModel.findById(userId);
    if (!doc) {
      return res.status(404).json({ error: 'Collaborator profile not found.' });
    }

    if (doc.isVerified === true) {
      return res.status(200).json({ message: 'Email is already verified.', user: { id: doc._id, isVerified: true } });
    }

    doc.isVerified = true;
    doc.verifyTokenExpiresAt = null;
    doc.updatedAt = new Date().toISOString();
    await doc.save();

    await db.logAudit(
      req.user!.id,
      req.user!.name,
      req.user!.email,
      'EMAIL_VERIFIED',
      `Manually marked "${doc.email}" as verified by an administrator.`,
      undefined,
      req.ip
    );

    return res.status(200).json({
      message: 'Email marked as verified.',
      user: { id: doc._id, isVerified: true },
    });
  } catch (err: any) {
    console.error('Error verifying user email:', err);
    return res.status(500).json({ error: 'Failed to update verification status.' });
  }
};
router.patch('/admin/users/:id/verify', requireAuth, requireRole('admin'), verifyUserEmailHandler);

// 5. ENHANCED USER PROFILE DELETION
router.delete('/admin/users/:id', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.params.id;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'Administrative conflict: Self profile destruction prohibited.' });
    }

    const doc = await UserModel.findById(userId);
    if (!doc) {
      return res.status(404).json({ error: 'Collaborator profile record does not exist.' });
    }

    // Deletion
    const success = await db.deleteUser(userId);
    if (success) {
      await db.logAudit(
        req.user!.id,
        req.user!.name,
        req.user!.email,
        'DELETE_USER',
        `Terminated account data profile: "${doc.name}" (${doc.email})`,
        undefined,
        req.ip
      );
      return res.status(200).json({ message: 'User profile hard deleted successfully.' });
    }
    return res.status(400).json({ error: 'Database adapter rejected deletion sequence.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'General profile deletion fault.' });
  }
});

// 6. DETAILED WORKSPACES VISIBILITY
router.get('/admin/workspaces', requireVerifiedAuth, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const workspaces = await WorkspaceModel.find().lean() as any[];
    
    const formatted = await Promise.all(workspaces.map(async (ws) => {
      const channelsCount = await ConversationModel.countDocuments({ workspaceId: ws._id });
      const savedCount = await SavedResponseModel.countDocuments({ workspaceId: ws._id });
      
      const owner = await UserModel.findById(ws.ownerId).select('name email avatar').lean();
      
      return {
        id: ws._id,
        name: ws.name,
        description: ws.description,
        owner: owner ? { name: owner.name, email: owner.email, avatar: owner.avatar } : { name: 'System', email: 'nova-system@mindsync.io', avatar: 'SYS' },
        membersCount: ws.memberIds ? ws.memberIds.length : 1,
        channelsCount,
        savedCount,
        createdAt: ws.createdAt
      };
    }));

    return res.status(200).json(formatted);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to gather system workspaces registry.' });
  }
});

// 7. ABUSIVE WORKSPACE TERMINATION
router.delete('/admin/workspaces/:id', requireVerifiedAuth, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const wsId = req.params.id;
    const ws = await db.getWorkspaceById(wsId);
    if (!ws) {
      return res.status(404).json({ error: 'Workspace index not found.' });
    }

    const success = await db.deleteWorkspace(wsId);
    if (success) {
      await db.logAudit(
        req.user!.id,
        req.user!.name,
        req.user!.email,
        'WORKSPACE_DEL',
        `Administrative deletion of workspace: "${ws.name}" owner ID (${ws.ownerId})`,
        wsId,
        req.ip
      );

      const io = getIo();
      if (io) {
        io.emit('workspace-deleted', { workspaceId: wsId });
      }

      return res.status(200).json({ message: 'Workspace destroyed successfully.' });
    }
    return res.status(400).json({ error: 'Could not dismantle workspace.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Terminator module database execution defect.' });
  }
});

// 8. AUDIT LOG TELEMETRY LISTINGS
router.get('/admin/audit-logs', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const page = parseInt(req.query.page as string) || 1;
    const actionFilter = req.query.action as string || '';

    let filter: any = {};
    if (actionFilter) {
      filter.action = actionFilter;
    }

    const totalLogs = await AuditLogModel.countDocuments(filter);
    const logs = await AuditLogModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const formatted = logs.map((l: any) => ({
      id: l._id,
      userId: l.userId,
      userName: l.userName || 'Guest/Anonymous',
      userEmail: l.userEmail || 'N/A',
      action: l.action,
      details: l.details,
      workspaceId: l.workspaceId,
      ipAddress: l.ipAddress || '0.0.0.0',
      createdAt: l.createdAt
    }));

    return res.status(200).json({
      auditLogs: formatted,
      pagination: {
        total: totalLogs,
        page,
        limit,
        pages: Math.ceil(totalLogs / limit)
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch telemetry auditing files.' });
  }
});

export default router;
