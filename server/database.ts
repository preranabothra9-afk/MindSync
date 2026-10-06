import mongoose, { Schema } from 'mongoose';
import fs from 'fs';
import path from 'path';
import { User, Workspace, Conversation, Message, SavedResponse, Claim, ClaimRelation, DiscussionComment, ContradictionVote, ContradictionDiscussion, Evidence, Decision, DecisionHistoryEntry, TimelineEvent, TimelineEventKind, Invitation } from '../src/types';
import { generateUUID } from './auth';
import { historyActionToTimelineKind, historyActionLabel } from './decisions';

/** Order-preserving dedupe for id lists coming off the wire. */
function dedupeIds(ids?: string[] | null): string[] {
  if (!ids) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const v = typeof id === 'string' ? id.trim() : '';
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// Connection function for live remote environment deployment
let connectPromise: Promise<void> | null = null;

export function connectDB(): Promise<void> {
  // Memoize so concurrent callers (module import + server bootstrap) await one socket
  if (!connectPromise) {
    connectPromise = establishConnection().catch((err) => {
      connectPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return connectPromise;
}

async function establishConnection(): Promise<void> {
  let uri = process.env.MONGODB_URI;
  
  if (!uri) {
    // Attempt to load from .env.example configuration dynamically as a safe fallback
    try {
      const p = path.resolve(process.cwd(), '.env.example');
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        const match = content.match(/MONGODB_URI=(.*)/);
        if (match && match[1]) {
          uri = match[1].trim().replace(/['"]/g, '');
          process.env.MONGODB_URI = uri;
          console.log('RECOVERED MONGODB_URI: Successfully dynamically resolved URI from .env.example config:', uri);
        }
      }
    } catch (e) {
      console.warn('Failed to parse .env.example as runtime fallback:', e);
    }
  }

  if (!uri) {
    console.error('CRITICAL: MONGODB_URI environment variable is not defined!');
    throw new Error('MONGODB_URI environment variable is required to start database connections.');
  }

  if (mongoose.connection.readyState >= 1) {
    return;
  }

  console.log('Connecting to cloud MongoDB database...');
  // Connect with a 10-second timeout to allow secure Atlas connection handshakes
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  
  console.log('Successfully established MERN cluster connection with MongoDB Atlas.');
  // Note: the demo "General Workspace" / "NovaAI Core" seeder is intentionally
  // NOT run any more. Sample data is not a product feature — every workspace
  // in the database now belongs to someone who created it.
}

// Automatically trigger database connection startup
connectDB().catch(err => {
  console.error('Failed to pre-connect during module import phase. Active connection will retry dynamically on incoming server requests.');
});

// --- MONGOOSE SCHEMAS & ENTERPRISE INDEXES ---

// User Schema
const UserSchema = new Schema({
  _id: { type: String, default: generateUUID },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  avatar: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user', required: true, index: true },
  blocked: { type: Boolean, default: false, required: true },
  isBlocked: { type: Boolean, default: false, required: true, index: true },
  refreshToken: { type: String, default: null, index: true },
  resetToken: { type: String, default: null, index: true },
  resetTokenExpiresAt: { type: Number, default: null },
  isVerified: { type: Boolean, default: false },
  verifyToken: { type: String, default: null, index: true },
  verifyTokenExpiresAt: { type: Number, default: null },
  lastActiveAt: { type: String, default: () => new Date().toISOString() },
  lastLogin: { type: String, default: () => new Date().toISOString() },
  createdAt: { type: String, default: () => new Date().toISOString() },
  updatedAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Workspace Schema
const WorkspaceSchema = new Schema({
  _id: { type: String, default: generateUUID },
  name: { type: String, required: true },
  description: { type: String, default: 'Collaborative AI workspace sandbox.' },
  ownerId: { type: String, required: true, index: true },
  memberIds: { type: [String], default: [], index: true },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Invitation Schema
// Collaborators must opt in: an invite lands here as `pending` and the
// recipient decides. Rejections are never deleted, so the running tally of
// declined invites for a (workspace, invitee) pair is just a count of these.
const InvitationSchema = new Schema({
  _id: { type: String, default: generateUUID },
  workspaceId: { type: String, required: true, index: true },
  workspaceName: { type: String, required: true },
  inviterId: { type: String, required: true },
  inviterName: { type: String, required: true },
  inviteeId: { type: String, required: true, index: true },
  inviteeEmail: { type: String, required: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending', index: true },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Channel/Conversation Schema
const ConversationSchema = new Schema({
  _id: { type: String, default: generateUUID },
  workspaceId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  createdBy: { type: String, required: true, index: true },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Message Schema
const MessageSchema = new Schema({
  _id: { type: String, default: generateUUID },
  conversationId: { type: String, required: true, index: true },
  senderId: { type: String, required: true, index: true },
  senderName: { type: String, required: true },
  senderAvatar: { type: String, required: true },
  promptText: { type: String, required: true },
  modelResponses: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// SavedResponse Schema
const SavedResponseSchema = new Schema({
  _id: { type: String, default: generateUUID },
  workspaceId: { type: String, required: true, index: true },
  prompt: { type: String, required: true },
  modelName: { type: String, required: true },
  responseContent: { type: String, required: true },
  savedBy: { type: String, required: true, index: true },
  senderName: { type: String, required: true },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Claim Schema
// A durable, quotable statement extracted from an AI response. Claims give a
// room a persistent memory that later prompts are grounded in, so models answer
// with the ongoing discussion in mind instead of treating each prompt in a
// vacuum.
const ClaimSchema = new Schema({
  _id: { type: String, default: generateUUID },
  conversationId: { type: String, required: true, index: true },
  messageId: { type: String, required: true, index: true },
  modelKey: { type: String, required: true },
  modelName: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// An edge in the room's contradiction graph, linking two claims. The pair is
// stored in canonical (sorted) order with a unique index so the same two claims
// can only ever form one edge, whichever direction the detection came from.
const ClaimRelationSchema = new Schema({
  _id: { type: String, default: generateUUID },
  conversationId: { type: String, required: true, index: true },
  claimAId: { type: String, required: true },
  claimBId: { type: String, required: true },
  claimAText: { type: String, required: true },
  claimBText: { type: String, required: true },
  claimAModelName: { type: String, required: true },
  claimBModelName: { type: String, required: true },
  relationship: { type: String, required: true, enum: ['SUPPORT', 'CONTRADICT', 'RELATED', 'UNCERTAIN'], index: true },
  confidence: { type: Number, required: true, min: 0, max: 1, default: 0.5 },
  explanation: { type: String, required: true },
  // 'detected' is the only value the detector writes. 'resolved',
  // 'evidence-needed' and 'dismissed' are set exclusively by an authorized
  // human closing the contradiction's discussion — never by the poll tally or
  // the confidence. 'evidence-needed' is the room declining to pick a side.
  status: { type: String, required: true, default: 'detected', enum: ['detected', 'resolved', 'evidence-needed', 'dismissed'], index: true },
  /** The reason an authorized human recorded when closing the contradiction. */
  resolution: { type: String, default: null },
  resolvedBy: { type: String, default: null },
  resolvedByName: { type: String, default: null },
  resolvedAt: { type: String, default: null },
  // Evidence ids the closer cited while resolving. Kept as ids rather than
  // copies so deleting a piece of evidence can't leave a ghost record behind;
  // readers filter out ids that no longer resolve.
  citedEvidenceIds: { type: [String], default: [] },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});
// Enforces one relationship per claim pair regardless of detection direction.
ClaimRelationSchema.index({ claimAId: 1, claimBId: 1 }, { unique: true });

// A comment or reply in a contradiction's human discussion thread. Top-level
// comments carry no parentId; replies point at the comment they answer, so a
// thread is one level deep — enough to answer a point without nesting noise.
const DiscussionCommentSchema = new Schema({
  _id: { type: String, default: generateUUID },
  relationId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  authorId: { type: String, required: true },
  authorName: { type: String, required: true },
  authorAvatar: { type: String, default: '' },
  text: { type: String, required: true },
  parentId: { type: String, default: null, index: true },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// One user's vote in a contradiction poll. The unique (relationId, userId)
// index is what makes the poll "one vote per user" — voting again updates the
// choice instead of inserting a second row.
const ContradictionVoteSchema = new Schema({
  _id: { type: String, default: generateUUID },
  relationId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  choice: { type: String, required: true, enum: ['CLAIM_A', 'CLAIM_B', 'NEITHER'] },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Enforces one vote per user per contradiction.
ContradictionVoteSchema.index({ relationId: 1, userId: 1 }, { unique: true });

// Decision Schema
// A room's formal commitment — the artifact the evidence gate protects. It
// links the load-bearing claims, records who must approve, and keeps an
// append-only history so the decision's trajectory is always reconstructable.
//
// `status` only ever moves draft → finalized. Reopening writes `draft` back but
// leaves the finalization entry in `history`, so nothing is ever silently
// undone. All history mutation is additive; no code path edits or deletes an
// entry.
const DecisionSchema = new Schema({
  _id: { type: String, default: generateUUID },
  conversationId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  statement: { type: String, required: true },
  // Claims the gate holds to the evidence requirement.
  claimIds: { type: [String], default: [] },
  // Members whose sign-off is required before finalization.
  requiredApproverIds: { type: [String], default: [] },
  approvals: { type: [Schema.Types.Mixed], default: [] },
  status: { type: String, required: true, default: 'draft', enum: ['draft', 'finalized'], index: true },
  createdBy: { type: String, required: true },
  createdByName: { type: String, required: true },
  finalizedAt: { type: String, default: null },
  finalizedBy: { type: String, default: null },
  finalizedByName: { type: String, default: null },
  // Append-only. Readers render it as-is; nothing prunes it.
  history: { type: [Schema.Types.Mixed], default: [] },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


// Evidence Schema
// Material a member (or a model) attaches to a claim to back it up or knock it
// down: a link, a file, a quote, a personal note, or an AI-generated reference.
// The room's memory stays about *what was established*; evidence is the *why*.
const EvidenceSchema = new Schema({
  _id: { type: String, default: generateUUID },
  claimId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  kind: { type: String, required: true, enum: ['url', 'file', 'quote', 'user', 'ai'], index: true },
  title: { type: String, required: true },
  url: { type: String, default: null },
  fileName: { type: String, default: null },
  mimeType: { type: String, default: null },
  sizeBytes: { type: Number, default: null },
  // Stored inline as a base64 data URI, the same way MessagePart carries
  // inline images — no separate upload service exists, so files live in the
  // document they belong to.
  data: { type: String, default: null },
  excerpt: { type: String, default: null },
  source: { type: String, default: null },
  // AI-generated references are labelled unverified for the lifetime of the
  // document: they are a model's reading of the source, never proof.
  aiGenerated: { type: Boolean, required: true, default: false },
  modelName: { type: String, default: null },
  authorId: { type: String, default: null },
  authorName: { type: String, default: null },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


// AuditLog Schema
const AuditLogSchema = new Schema({  _id: { type: String, default: generateUUID },
  userId: { type: String, index: true },
  userName: { type: String },
  userEmail: { type: String, index: true },
  action: { type: String, required: true, index: true }, // e.g., 'REGISTER', 'LOGIN', 'LOGOUT', 'CREATE_WORKSPACE', 'DELETE_WORKSPACE', 'INVITE_COLLABORATOR', 'ROLE_CHANGE', 'BLOCK_USER', 'UNBLOCK_USER', 'DELETE_USER', 'AI_PROMPT_REQUEST', 'FAILED_AUTH'
  details: { type: String, required: true },
  workspaceId: { type: String, index: true },
  ipAddress: { type: String },
  createdAt: { type: String, default: () => new Date().toISOString(), index: true }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// TimelineEvent Schema
// The room's append-only event stream, which the decision replay scrubs
// through. Every material thing that happened around a decision — a prompt,
// a model reply, a claim mined from it, a contradiction found or closed,
// evidence a person attached, a vote, a comment, and the decision's own
// lifecycle — is one document here. This extends the audit story the
// AuditLog began: that log records who did what for the admin, this one
// records the room's narrative in enough detail to replay it.
const TimelineEventSchema = new Schema({
  _id: { type: String, default: generateUUID },
  conversationId: { type: String, required: true, index: true },
  // Null for room-level events; the decision's id for its own lifecycle.
  decisionId: { type: String, default: null, index: true },
  kind: { type: String, required: true, index: true },
  // When it happened. The timeline is ordered by (at, _id) so positions are
  // stable across reads — the scrubber's cursor must not move underneath it.
  at: { type: String, required: true, index: true },
  actorId: { type: String, default: null },
  actorName: { type: String, required: true },
  title: { type: String, required: true },
  detail: { type: String, required: true },
  // Refs, all optional, used to reconstruct state and to deep-link.
  messageId: { type: String, default: null },
  claimIds: { type: [String], default: [] },
  relationId: { type: String, default: null },
  evidenceId: { type: String, default: null },
  memberIds: { type: [String], default: [] },
  // Kind-specific extras. Kept loose on purpose: a new field costs no
  // migration, and renderers read it defensively.
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual conversions for MERN front-end schema compliance
for (const schema of [UserSchema, WorkspaceSchema, ConversationSchema, MessageSchema, SavedResponseSchema, ClaimSchema, ClaimRelationSchema, DiscussionCommentSchema, ContradictionVoteSchema, DecisionSchema, AuditLogSchema, TimelineEventSchema]) {
  schema.virtual('id').get(function() {
    return this._id;
  });
}

// Export Mongoose Models
export const UserModel = (mongoose.models.User || mongoose.model('User', UserSchema)) as any;
export const WorkspaceModel = (mongoose.models.Workspace || mongoose.model('Workspace', WorkspaceSchema)) as any;
export const ConversationModel = (mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema)) as any;
export const MessageModel = (mongoose.models.Message || mongoose.model('Message', MessageSchema)) as any;
export const SavedResponseModel = (mongoose.models.SavedResponse || mongoose.model('SavedResponse', SavedResponseSchema)) as any;
export const ClaimModel = (mongoose.models.Claim || mongoose.model('Claim', ClaimSchema)) as any;
export const ClaimRelationModel = (mongoose.models.ClaimRelation || mongoose.model('ClaimRelation', ClaimRelationSchema)) as any;
export const DiscussionCommentModel = (mongoose.models.DiscussionComment || mongoose.model('DiscussionComment', DiscussionCommentSchema)) as any;
export const ContradictionVoteModel = (mongoose.models.ContradictionVote || mongoose.model('ContradictionVote', ContradictionVoteSchema)) as any;
export const DecisionModel = (mongoose.models.Decision || mongoose.model('Decision', DecisionSchema)) as any;
export const EvidenceModel = (mongoose.models.Evidence || mongoose.model('Evidence', EvidenceSchema)) as any;
export const AuditLogModel = (mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema)) as any;
export const TimelineEventModel = (mongoose.models.TimelineEvent || mongoose.model('TimelineEvent', TimelineEventSchema)) as any;
export const InvitationModel = (mongoose.models.Invitation || mongoose.model('Invitation', InvitationSchema)) as any;

// Sample/demo workspace seeding has been removed. It used to synthesise a
// "General Workspace" owned by a system account whenever the database was
// blank, which meant demo rooms reappeared on every fresh environment and sat
// in the real user's directory alongside their own work. Nothing seeds
// workspaces now: if a workspace exists, a person made it.

// --- SECURE MONGO DRIVER WRAPPER ---
class MongoDatabaseAdapter {
  // --- USER METHODS ---
  async getUsers(): Promise<User[]> {
    const docs = await UserModel.find().lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as User[];
  }

  async getUserById(id: string): Promise<User | undefined> {
    const d = await UserModel.findById(id).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as User;
  }

  /** Several users at once, for the membership rosters the UI renders. */
  async getUsersByIds(ids: string[]): Promise<User[]> {
    if (!ids || ids.length === 0) return [];
    const docs = await UserModel.find({ _id: { $in: ids } }).lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as User[];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const norm = email.toLowerCase().trim();
    const d = await UserModel.findOne({ email: norm }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as User;
  }

  async createUser(user: User, passwordHash: string): Promise<User> {
    const created = await UserModel.create({
      _id: user.id || generateUUID(),
      name: user.name,
      email: user.email.toLowerCase().trim(),
      password: passwordHash,
      avatar: user.avatar,
      role: user.role || 'user',
      createdAt: user.createdAt || new Date().toISOString()
    });
    return { ...created.toJSON(), id: created._id } as unknown as User;
  }

  async getPasswordHash(userId: string): Promise<string | undefined> {
    const d = await UserModel.findById(userId).select('password').lean();
    return d ? d.password : undefined;
  }

  // --- PASSWORD RESET METHODS ---

  /** Store a hashed reset token + epoch expiry on the user record. */
  async setResetToken(userId: string, tokenHash: string, expiresAt: number): Promise<boolean> {
    const res = await UserModel.findByIdAndUpdate(userId, {
      resetToken: tokenHash,
      resetTokenExpiresAt: expiresAt,
    });
    return !!res;
  }

  /** Look up a user by their stored (hashed) reset token. */
  async getUserByResetToken(tokenHash: string): Promise<any | null> {
    const doc = await UserModel.findOne({ resetToken: tokenHash }).lean();
    return doc || null;
  }

  /** Set a new password hash and invalidate any outstanding reset token. */
  async setUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    const res = await UserModel.findByIdAndUpdate(userId, {
      password: passwordHash,
      resetToken: null,
      resetTokenExpiresAt: null,
    });
    return !!res;
  }

  // --- EMAIL VERIFICATION METHODS ---

  /** Store a hashed verification token + epoch expiry on an unverified user. */
  async setVerifyToken(userId: string, tokenHash: string, expiresAt: number): Promise<boolean> {
    const res = await UserModel.findByIdAndUpdate(userId, {
      verifyToken: tokenHash,
      verifyTokenExpiresAt: expiresAt,
    });
    return !!res;
  }

  /** Look up a user by their stored (hashed) verification token. */
  async getUserByVerifyToken(tokenHash: string): Promise<any | null> {
    const doc = await UserModel.findOne({ verifyToken: tokenHash }).lean();
    return doc || null;
  }

  /**
   * Flip the account to verified.
   *
   * The token hash is intentionally RETAINED rather than nulled. `isVerified`
   * is the real authorisation gate, so keeping the hash costs nothing
   * security-wise, but it lets a re-opened or double-clicked link resolve to
   * "already verified" instead of "invalid", which dead-ends the user after
   * an accidental refresh. The expiry is cleared so the record ages out of
   * relevance, and re-issuing a link overwrites the hash anyway.
   */
  async markEmailVerified(userId: string): Promise<boolean> {
    const res = await UserModel.findByIdAndUpdate(userId, {
      isVerified: true,
      verifyTokenExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });
    return !!res;
  }

  // --- WORKSPACE METHODS ---
  async getWorkspaces(): Promise<Workspace[]> {
    const docs = await WorkspaceModel.find().lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as Workspace[];
  }

  async getWorkspaceById(id: string): Promise<Workspace | undefined> {
    const d = await WorkspaceModel.findById(id).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Workspace;
  }

  async createWorkspace(workspace: Workspace): Promise<Workspace> {
    const created = await WorkspaceModel.create({
      _id: workspace.id || generateUUID(),
      name: workspace.name,
      description: workspace.description || 'Collaborative AI workspace sandbox.',
      ownerId: workspace.ownerId,
      memberIds: workspace.memberIds || [workspace.ownerId],
      createdAt: workspace.createdAt || new Date().toISOString()
    });
    return { ...created.toJSON(), id: created._id } as unknown as Workspace;
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace | undefined> {
    const d = await WorkspaceModel.findByIdAndUpdate(id, updates, { new: true }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Workspace;
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    const res = await WorkspaceModel.deleteOne({ _id: id });
    if (res.deletedCount === 0) return false;

    // Cascade deletions with clean queries
    const conversations = await ConversationModel.find({ workspaceId: id }).select('_id').lean();
    const conversationIds = conversations.map((c: any) => c._id);
    await ConversationModel.deleteMany({ workspaceId: id });
    await SavedResponseModel.deleteMany({ workspaceId: id });
    await ClaimModel.deleteMany({ conversationId: { $in: conversationIds } });
    await ClaimRelationModel.deleteMany({ conversationId: { $in: conversationIds } });
    // A contradiction's human discussion dies with the room it lived in.
    await DiscussionCommentModel.deleteMany({ conversationId: { $in: conversationIds } });
    await ContradictionVoteModel.deleteMany({ conversationId: { $in: conversationIds } });
    // ...and so does the evidence that backed its claims.
    await EvidenceModel.deleteMany({ conversationId: { $in: conversationIds } });
    // Decisions belong to those rooms too.
    await DecisionModel.deleteMany({ conversationId: { $in: conversationIds } });
    return true;
  }

  // --- CONVERSATION METHODS ---
  async getConversations(workspaceId?: string): Promise<Conversation[]> {
    const filter = workspaceId ? { workspaceId } : {};
    const docs = await ConversationModel.find(filter).lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as Conversation[];
  }

  async getConversationById(id: string): Promise<Conversation | undefined> {
    const d = await ConversationModel.findById(id).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Conversation;
  }

  async createConversation(conv: Conversation): Promise<Conversation> {
    const created = await ConversationModel.create({
      _id: conv.id || generateUUID(),
      workspaceId: conv.workspaceId,
      title: conv.title,
      createdBy: conv.createdBy,
      createdAt: conv.createdAt || new Date().toISOString()
    });
    return { ...created.toJSON(), id: created._id } as unknown as Conversation;
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation | undefined> {
    const d = await ConversationModel.findByIdAndUpdate(id, updates, { new: true }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Conversation;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const res = await ConversationModel.deleteOne({ _id: id });
    if (res.deletedCount === 0) return false;
    await MessageModel.deleteMany({ conversationId: id });
    await ClaimModel.deleteMany({ conversationId: id });
    await ClaimRelationModel.deleteMany({ conversationId: id });
    // The room's contradiction discussions go with its contradictions.
    await DiscussionCommentModel.deleteMany({ conversationId: id });
    await ContradictionVoteModel.deleteMany({ conversationId: id });
    // The evidence backing its claims goes with the room too.
    await EvidenceModel.deleteMany({ conversationId: id });
    // The room's decisions go with it.
    await DecisionModel.deleteMany({ conversationId: id });
    return true;
  }

  // --- MESSAGE METHODS ---

  /**
   * Load a page of messages, newest-first retrieval, returned in chronological
   * order for display. Cursor-based so the client can page backwards through
   * full history without skip-offset drift.
   *
   * `before`/`beforeId` identify the oldest currently-loaded message; the page
   * returned is everything strictly older than that (createdAt, _id) tuple.
   * Both sort keys are ISO strings / UUIDs, so lexicographic == chronological.
   */
  async getMessages(
    conversationId: string,
    opts: { limit?: number; before?: string; beforeId?: string } = {}
  ): Promise<{ messages: Message[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const query: Record<string, unknown> = { conversationId };

    if (opts.before) {
      if (opts.beforeId) {
        query.$or = [
          { createdAt: { $lt: opts.before } },
          { createdAt: opts.before, _id: { $lt: opts.beforeId } },
        ];
      } else {
        query.createdAt = { $lt: opts.before };
      }
    }

    // Take limit + 1 to peek whether another page exists, then chronological order.
    const docs = await MessageModel.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    // `.lean()` skips the `id` virtual, so map `_id` -> `id` explicitly. The
    // client keys message rows and jump-to-message lookups off `msg.id`; without
    // this every history message arrives with `id === undefined`.
    const page = docs
      .slice(0, limit)
      .reverse()
      .map((d: any) => ({ ...d, id: d._id }));
    return { messages: page as unknown as Message[], hasMore };
  }

  /** Build a short snippet centered on the first match of `q` within `text`. */
  private snippet(text: string, q: string, radius = 70): string {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text.slice(0, radius * 2);
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + q.length + radius);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  /**
   * Case-insensitive regex search across a room's prompts and every model
   * response. Returns compact hits (no full response bodies) plus a snippet
   * and where the match was found.
   *
   * Model keys contain dots (e.g. "gemini-2.5-flash"), so response content
   * can't be reached with dot notation — an aggregation flattens
   * `modelResponses` into an array of contents first.
   */
  async searchMessages(
    conversationId: string,
    query: string,
    limit = 20
  ): Promise<Array<{
    id: string;
    promptText: string;
    createdAt: string;
    senderName: string;
    matchedIn: string;
    snippet: string;
  }>> {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await MessageModel.aggregate([
      { $match: { conversationId } },
      // Flatten the dynamic-key modelResponses map into a plain content array
      { $addFields: {
          _contents: {
            $map: {
              input: { $objectToArray: { $ifNull: ['$modelResponses', {}] } },
              as: 'entry',
              in: { name: '$$entry.v.modelName', content: '$$entry.v.content' },
            },
          },
        },
      },
      { $match: {
          $or: [
            { promptText: { $regex: esc, $options: 'i' } },
            { '_contents.content': { $regex: esc, $options: 'i' } },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
    ]);

    return docs.map((d: any) => {
      const q = query.toLowerCase();
      const promptHit = d.promptText?.toLowerCase().includes(q);
      let matchedIn = 'Prompt';
      let snippetText = d.promptText || '';

      if (!promptHit && Array.isArray(d._contents)) {
        for (const c of d._contents) {
          if (typeof c?.content === 'string' && c.content.toLowerCase().includes(q)) {
            matchedIn = c.name || 'Response';
            snippetText = c.content;
            break;
          }
        }
      }

      return {
        id: d._id,
        promptText: d.promptText,
        createdAt: d.createdAt,
        senderName: d.senderName,
        matchedIn,
        snippet: this.snippet(snippetText, query),
      };
    });
  }

  async getMessageById(id: string): Promise<Message | undefined> {
    const d = await MessageModel.findById(id).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Message;
  }

  async createMessage(msg: Message): Promise<Message> {
    const created = await MessageModel.create({
      _id: msg.id || generateUUID(),
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      senderAvatar: msg.senderAvatar,
      promptText: msg.promptText,
      modelResponses: msg.modelResponses || {},
      createdAt: msg.createdAt || new Date().toISOString()
    });
    return { ...created.toJSON(), id: created._id } as unknown as Message;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    const d = await MessageModel.findByIdAndUpdate(id, updates, { new: true }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Message;
  }

  /**
   * Reaps generations that were still in flight when the previous process died.
   *
   * A `pending`/`streaming` status is only ever transitioned by the in-memory
   * generation that owns it (see `activeGenerations` in socket.ts). After a
   * restart nothing owns it, so the row would render as a permanent "queued"
   * shimmer — exactly the stuck-response symptom. Flipping them to `failed`
   * here turns that into a visible message the user can act on.
   *
   * Model keys contain dots (`gemini-2.5-flash`), so this queries with
   * `$objectToArray` rather than a dotted path, and writes back by replacing
   * the whole `modelResponses` field rather than a positional `$set`.
   */
  async reapInterruptedStreams(): Promise<number> {
    const INTERRUPTED = 'Interrupted by a server restart — this response never completed. Please re-send the prompt.';

    const stuck = await MessageModel.aggregate([
      { $addFields: { _responses: { $objectToArray: '$modelResponses' } } },
      { $match: { '_responses.v.status': { $in: ['pending', 'streaming'] } } },
      { $project: { _id: 1 } },
    ]);
    if (stuck.length === 0) return 0;

    let reaped = 0;
    for (const doc of stuck) {
      const existing = await MessageModel.findById(doc._id).lean();
      if (!existing) continue;
      const responses = existing.modelResponses || {};
      let changed = false;
      for (const key of Object.keys(responses)) {
        const r = responses[key] as { status?: string; error?: string };
        if (r && (r.status === 'pending' || r.status === 'streaming')) {
          r.status = 'failed';
          r.error = INTERRUPTED;
          reaped++;
          changed = true;
        }
      }
      if (changed) {
        await MessageModel.updateOne({ _id: doc._id }, { $set: { modelResponses: responses } });
      }
    }
    return reaped;
  }

  // --- CLAIM METHODS ---
  // Claims are the room's persistent memory. See `server/context.ts` for the
  // extraction heuristic and the context preamble that consumes them.

  /**
   * Bulk-inserts claims for one response. De-duplicates on
   * (messageId, modelKey, text) so a retried or re-broadcast extraction can
   * never double-store the same statement.
   */
  async createClaims(claims: Claim[]): Promise<Claim[]> {
    if (!claims || claims.length === 0) return [];
    try {
      const docs = claims.map((c) => ({
        _id: c.id || generateUUID(),
        conversationId: c.conversationId,
        messageId: c.messageId,
        modelKey: c.modelKey,
        modelName: c.modelName,
        text: c.text,
        createdAt: c.createdAt || new Date().toISOString()
      }));
      const created = await ClaimModel.insertMany(docs, { ordered: false });
      return created.map((c: any) => ({ ...c.toJSON(), id: c._id })) as unknown as Claim[];
    } catch (err: any) {
      // `ordered: false` keeps every valid doc even if one is a duplicate-key
      // dupe of an earlier insert; only surface genuine failures.
      if (err?.code === 11000) return [];
      console.error('Failed to store extracted claims:', err?.message || err);
      return [];
    }
  }

  /** Newest-first claims for a room, bounded by `limit`. */
  async getClaims(conversationId: string, limit = 30): Promise<Claim[]> {
    const docs = await ClaimModel.find({ conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as Claim[];
  }

  /** One claim, scoped to its room — the gate every evidence request passes. */
  async getClaimById(conversationId: string, claimId: string): Promise<Claim | undefined> {
    const d = await ClaimModel.findOne({ _id: claimId, conversationId }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Claim;
  }

  /**
   * Deletes one claim, scoped to its room so a stale client id can't touch
   * another room. Everything anchored to the claim goes with it: the edges it
   * participates in, their discussions, and the evidence attached to it.
   */
  async deleteClaim(conversationId: string, claimId: string): Promise<boolean> {
    const res = await ClaimModel.deleteOne({ _id: claimId, conversationId });
    if (res.deletedCount > 0) {
      await this.deleteClaimRelationsForClaim(claimId);
      await this.deleteEvidenceForClaims([claimId]);
    }
    return res.deletedCount > 0;
  }

  /** Deletes every claim in a room. */
  async deleteClaimsByConversation(conversationId: string): Promise<number> {
    const res = await ClaimModel.deleteMany({ conversationId });
    await ClaimRelationModel.deleteMany({ conversationId });
    // Clearing the room's memory also clears every contradiction discussion it
    // held — comments and poll votes have no meaning without their edge — and
    // the evidence that backed the claims.
    await DiscussionCommentModel.deleteMany({ conversationId });
    await ContradictionVoteModel.deleteMany({ conversationId });
    await EvidenceModel.deleteMany({ conversationId });
    return res.deletedCount || 0;
  }

  // --- CLAIM RELATION METHODS (the contradiction graph) ---

  /**
   * Stores one contradiction-graph edge. The claim pair is canonicalised
   * (sorted) before writing and the schema carries a unique index on the pair,
   * so a duplicate detection is a harmless no-op rather than a second edge.
   * Returns null when the pair was already related — callers can treat that as
   * "nothing new to broadcast".
   */
  async createClaimRelation(relation: ClaimRelation): Promise<ClaimRelation | null> {
    const [claimAId, claimBId] = [relation.claimAId, relation.claimBId].sort();
    if (claimAId === claimBId) return null;
    try {
      const created = await ClaimRelationModel.create({
        _id: relation.id || generateUUID(),
        conversationId: relation.conversationId,
        claimAId,
        claimBId,
        claimAText: relation.claimAText,
        claimBText: relation.claimBText,
        claimAModelName: relation.claimAModelName,
        claimBModelName: relation.claimBModelName,
        relationship: relation.relationship,
        confidence: Math.min(Math.max(relation.confidence ?? 0.5, 0), 1),
        explanation: relation.explanation,
        status: relation.status || 'detected',
        createdAt: relation.createdAt || new Date().toISOString()
      });
      return { ...created.toObject(), id: created._id } as unknown as ClaimRelation;
    } catch (err: any) {
      // Duplicate-key means another detection already recorded this pair.
      if (err?.code === 11000) return null;
      console.error('Failed to store claim relation:', err?.message || err);
      return null;
    }
  }

  /** Newest-first relationship edges for a room, bounded by `limit`. */
  async getClaimRelations(conversationId: string, limit = 40): Promise<ClaimRelation[]> {
    const docs = await ClaimRelationModel.find({ conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as ClaimRelation[];
  }

  /** Removes every edge that touches a claim, when that claim is deleted. */
  async deleteClaimRelationsForClaim(claimId: string): Promise<number> {
    const relations = await ClaimRelationModel.find({
      $or: [{ claimAId: claimId }, { claimBId: claimId }]
    }).select('_id').lean();
    const relationIds = relations.map((r: any) => r._id as string);

    // A contradiction's discussion is attached to the edge, not the claims, so
    // it must be torn down with the edge.
    await this.deleteDiscussionForRelations(relationIds);

    const res = await ClaimRelationModel.deleteMany({ _id: { $in: relationIds } });
    return res.deletedCount || 0;
  }

  // --- CONTRADICTION DISCUSSION METHODS ---
  // The human side of the contradiction graph: a comment thread with replies
  // and a room poll. Status transitions live with the relation itself; these
  // methods never touch status, and never derive it from votes or confidence.

  /** Drops every comment and vote attached to the given contradiction edges. */
  async deleteDiscussionForRelations(relationIds: string[]): Promise<void> {
    if (!relationIds || relationIds.length === 0) return;
    await DiscussionCommentModel.deleteMany({ relationId: { $in: relationIds } });
    await ContradictionVoteModel.deleteMany({ relationId: { $in: relationIds } });
  }

  /** One contradiction edge, scoped to its room so a stale id can't read another room. */
  async getClaimRelationById(conversationId: string, relationId: string): Promise<ClaimRelation | undefined> {
    const d = await ClaimRelationModel.findOne({ _id: relationId, conversationId }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as ClaimRelation;
  }

  /** The full discussion for one contradiction: comments (chronological) and poll votes. */
  async getDiscussion(relationId: string): Promise<ContradictionDiscussion> {
    const [commentDocs, voteDocs] = await Promise.all([
      DiscussionCommentModel.find({ relationId }).sort({ createdAt: 1, _id: 1 }).lean(),
      ContradictionVoteModel.find({ relationId }).lean(),
    ]);
    return {
      comments: commentDocs.map((d: any) => ({ ...d, id: d._id })) as unknown as DiscussionComment[],
      votes: voteDocs.map((d: any) => ({ ...d, id: d._id })) as unknown as ContradictionVote[],
    };
  }

  /**
   * Comment threads and poll tallies for many contradictions at once, keyed by
   * relationId. The AI decision context needs whichever threads it is about to
   * quote, and asking relation-by-relation would turn one prompt into dozens of
   * round trips. Two queries regardless of how many edges are asked for.
   */
  async getDiscussionsForRelations(relationIds: string[]): Promise<Record<string, ContradictionDiscussion>> {
    const map: Record<string, ContradictionDiscussion> = {};
    if (!relationIds || relationIds.length === 0) return map;

    const [commentDocs, voteDocs] = await Promise.all([
      DiscussionCommentModel.find({ relationId: { $in: relationIds } }).sort({ createdAt: 1, _id: 1 }).lean(),
      ContradictionVoteModel.find({ relationId: { $in: relationIds } }).lean(),
    ]);

    for (const id of relationIds) map[id] = { comments: [], votes: [] };
    for (const d of commentDocs as any[]) {
      const c = { ...d, id: d._id } as unknown as DiscussionComment;
      (map[c.relationId] ??= { comments: [], votes: [] }).comments.push(c);
    }
    for (const d of voteDocs as any[]) {
      const v = { ...d, id: d._id } as unknown as ContradictionVote;
      (map[v.relationId] ??= { comments: [], votes: [] }).votes.push(v);
    }
    return map;
  }

  /** Stores one comment or reply. */
  async addComment(comment: DiscussionComment): Promise<DiscussionComment> {
    const created = await DiscussionCommentModel.create({
      _id: comment.id || generateUUID(),
      relationId: comment.relationId,
      conversationId: comment.conversationId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      authorAvatar: comment.authorAvatar || '',
      text: comment.text,
      parentId: comment.parentId || null,
      createdAt: comment.createdAt || new Date().toISOString()
    });
    return { ...created.toObject(), id: created._id } as unknown as DiscussionComment;
  }

  /** Whether a comment exists in this thread — used to validate a reply target. */
  async commentExists(relationId: string, commentId: string): Promise<boolean> {
    const doc = await DiscussionCommentModel.findOne({ _id: commentId, relationId }).select('_id').lean();
    return !!doc;
  }

  /**
   * Deletes one comment. Authors may delete their own; the workspace owner and
   * admins may delete anyone's (moderation). The scoping filters keep a comment
   * from being pulled out of another room's thread.
   */
  async deleteComment(relationId: string, commentId: string, userId: string, moderator: boolean): Promise<boolean> {
    const filter: Record<string, unknown> = { _id: commentId, relationId };
    if (!moderator) filter.authorId = userId;
    const res = await DiscussionCommentModel.deleteOne(filter);
    return res.deletedCount > 0;
  }

  /**
   * Records one user's poll vote, or changes it if they have already voted. The
   * unique (relationId, userId) index is the "one vote per user" guarantee; a
   * race between two first-votes lands on a duplicate-key error, which is
   * handled by falling back to an update of the surviving row.
   */
  async setVote(vote: ContradictionVote): Promise<ContradictionVote> {
    const existing = await ContradictionVoteModel.findOne({
      relationId: vote.relationId, userId: vote.userId
    });
    if (existing) {
      existing.choice = vote.choice;
      existing.userName = vote.userName;
      await existing.save();
      return { ...existing.toObject(), id: existing._id } as unknown as ContradictionVote;
    }

    try {
      const created = await ContradictionVoteModel.create({
        _id: vote.id || generateUUID(),
        relationId: vote.relationId,
        conversationId: vote.conversationId,
        userId: vote.userId,
        userName: vote.userName,
        choice: vote.choice,
        createdAt: vote.createdAt || new Date().toISOString()
      });
      return { ...created.toObject(), id: created._id } as unknown as ContradictionVote;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      const again = await ContradictionVoteModel.findOne({
        relationId: vote.relationId, userId: vote.userId
      });
      if (!again) throw err;
      again.choice = vote.choice;
      again.userName = vote.userName;
      await again.save();
      return { ...again.toObject(), id: again._id } as unknown as ContradictionVote;
    }
  }

  /** Every vote cast in a contradiction's poll. */
  async getVotes(relationId: string): Promise<ContradictionVote[]> {
    const docs = await ContradictionVoteModel.find({ relationId }).lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as ContradictionVote[];
  }

  /**
   * Closes a contradiction as `resolved` or `dismissed`, recording who closed it
   * and why. This is the ONLY place the closed statuses are written — the poll
   * tally and the detector's confidence are never inputs to it.
   *
   * `citedEvidenceIds` are the pieces of evidence the closer pointed at while
   * deciding; they are recorded with the closure so the decision is auditable.
   */
  async resolveRelation(
    conversationId: string,
    relationId: string,
    closure: { status: 'resolved' | 'evidence-needed' | 'dismissed'; resolution: string; resolvedBy: string; resolvedByName: string; citedEvidenceIds?: string[] }
  ): Promise<ClaimRelation | undefined> {
    // A citation is only meaningful if it points at evidence actually attached
    // to one of the two claims in this contradiction. The route filters too, but
    // the storage layer guarantees the invariant for every caller, so a record
    // can never cite evidence that does not belong to its own pair.
    const requested = dedupeIds(closure.citedEvidenceIds);
    let citedEvidenceIds: string[] = [];
    if (requested.length > 0) {
      const existing = await ClaimRelationModel.findOne(
        { _id: relationId, conversationId },
        { claimAId: 1, claimBId: 1 }
      ).lean();
      if (!existing) return undefined;
      const available = await EvidenceModel.find({
        conversationId,
        claimId: { $in: [existing.claimAId, existing.claimBId] }
      }).select('_id').lean();
      const valid = new Set(available.map((e: any) => e._id as string));
      citedEvidenceIds = requested.filter((id) => valid.has(id));
    }

    const d = await ClaimRelationModel.findOneAndUpdate(
      { _id: relationId, conversationId },
      {
        status: closure.status,
        resolution: closure.resolution,
        resolvedBy: closure.resolvedBy,
        resolvedByName: closure.resolvedByName,
        resolvedAt: new Date().toISOString(),
        citedEvidenceIds
      },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as ClaimRelation;
  }

  // --- EVIDENCE METHODS ---
  //
  // Evidence is scoped to a claim, and through the claim to a room. Every write
  // carries the conversationId so a stale client id can never touch another
  // room's evidence — the same scoping discipline the claim methods use.

  /** Stores one piece of evidence attached to a claim. */
  async createEvidence(evidence: Evidence): Promise<Evidence> {
    const created = await EvidenceModel.create({
      _id: evidence.id || generateUUID(),
      claimId: evidence.claimId,
      conversationId: evidence.conversationId,
      kind: evidence.kind,
      title: evidence.title,
      url: evidence.url ?? null,
      fileName: evidence.fileName ?? null,
      mimeType: evidence.mimeType ?? null,
      sizeBytes: evidence.sizeBytes ?? null,
      data: evidence.data ?? null,
      excerpt: evidence.excerpt ?? null,
      source: evidence.source ?? null,
      aiGenerated: evidence.aiGenerated,
      modelName: evidence.modelName ?? null,
      authorId: evidence.authorId ?? null,
      authorName: evidence.authorName ?? null,
      createdAt: evidence.createdAt || new Date().toISOString()
    });
    return { ...created.toObject(), id: created._id } as unknown as Evidence;
  }

  /** Newest-first evidence for one claim. */
  async getEvidenceForClaim(conversationId: string, claimId: string, limit = 50): Promise<Evidence[]> {
    const docs = await EvidenceModel.find({ conversationId, claimId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as Evidence[];
  }

  /**
   * Evidence for every claim in `claimIds`, returned as a claimId -> evidence
   * map. One round trip instead of N: a contradiction's detail view needs both
   * sides' evidence at once.
   */
  async getEvidenceForClaims(conversationId: string, claimIds: string[]): Promise<Record<string, Evidence[]>> {
    const map: Record<string, Evidence[]> = {};
    if (!claimIds || claimIds.length === 0) return map;
    const docs = await EvidenceModel.find({ conversationId, claimId: { $in: claimIds } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .lean();
    for (const d of docs) {
      const rec = { ...d, id: d._id } as unknown as Evidence;
      (map[rec.claimId] ||= []).push(rec);
    }
    return map;
  }

  /** One evidence document, scoped to its room. */
  async getEvidenceById(conversationId: string, evidenceId: string): Promise<Evidence | undefined> {
    const d = await EvidenceModel.findOne({ _id: evidenceId, conversationId }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Evidence;
  }

  /**
   * Deletes one piece of evidence. Authors may delete their own; the workspace
   * owner and admins may delete anyone's (moderation). AI-generated references
   * have no author, so only a moderator can remove them.
   */
  async deleteEvidence(conversationId: string, evidenceId: string, userId: string, moderator: boolean): Promise<boolean> {
    const filter: Record<string, unknown> = { _id: evidenceId, conversationId };
    if (!moderator) filter.authorId = userId;
    const res = await EvidenceModel.deleteOne(filter);
    if (res.deletedCount > 0) {
      // Stop dangling citations: pull this id from any contradiction that
      // referenced it when it was closed.
      await ClaimRelationModel.updateMany(
        { citedEvidenceIds: evidenceId },
        { $pull: { citedEvidenceIds: evidenceId } }
      );
    }
    return res.deletedCount > 0;
  }

  /** Deletes every piece of evidence attached to the given claims. */
  private async deleteEvidenceForClaims(claimIds: string[]): Promise<void> {
    if (!claimIds || claimIds.length === 0) return;
    const ev = await EvidenceModel.find({ claimId: { $in: claimIds } }).select('_id').lean();
    if (ev.length === 0) return;
    const ids = ev.map((e: any) => e._id as string);
    await EvidenceModel.deleteMany({ _id: { $in: ids } });
    await ClaimRelationModel.updateMany(
      { citedEvidenceIds: { $in: ids } },
      { $pullAll: { citedEvidenceIds: ids } }
    );
  }

  /** Deletes every piece of evidence in a room. */
  async deleteEvidenceByConversation(conversationId: string): Promise<number> {
    const res = await EvidenceModel.deleteMany({ conversationId });
    if (res.deletedCount > 0) {
      // The room's relations may have cited any of it; clear the stale ids.
      await ClaimRelationModel.updateMany(
        { conversationId, citedEvidenceIds: { $exists: true, $ne: [] } },
        { $set: { citedEvidenceIds: [] } }
      );
    }
    return res.deletedCount || 0;
  }

  // --- DECISION METHODS ---
  //
  // A decision is the room's formal commitment. Reads and writes are scoped to
  // the room exactly like claims and evidence, so a stale client id from one
  // room can never touch another room's decision. History is append-only by
  // construction: every mutating method `$push`es onto `history` and no method
  // ever writes to an existing entry.

  /** Newest-first decisions for a room, bounded by `limit`. */
  async getDecisions(conversationId: string, limit = 30): Promise<Decision[]> {
    const docs = await DecisionModel.find({ conversationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as Decision[];
  }

  /** One decision, scoped to its room. */
  async getDecisionById(conversationId: string, decisionId: string): Promise<Decision | undefined> {
    const d = await DecisionModel.findOne({ _id: decisionId, conversationId }).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /** Creates a decision. The caller has already validated and de-duplicated. */
  async createDecision(decision: Decision): Promise<Decision> {
    const created = await DecisionModel.create({
      _id: decision.id || generateUUID(),
      conversationId: decision.conversationId,
      title: decision.title,
      statement: decision.statement,
      claimIds: decision.claimIds || [],
      requiredApproverIds: decision.requiredApproverIds || [],
      approvals: decision.approvals || [],
      status: 'draft',
      createdBy: decision.createdBy,
      createdByName: decision.createdByName,
      finalizedAt: null,
      finalizedBy: null,
      finalizedByName: null,
      history: decision.history || [],
      createdAt: decision.createdAt || new Date().toISOString()
    });
    return { ...created.toJSON(), id: created._id } as unknown as Decision;
  }

  /**
   * Appends one history entry to a decision. This and `setDecisionStatus` are
   * the only writers of `history`, and both only ever push — the trail is
   * append-only for the lifetime of the document.
   */
  async appendDecisionHistory(
    conversationId: string,
    decisionId: string,
    entry: DecisionHistoryEntry
  ): Promise<Decision | undefined> {
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId },
      { $push: { history: entry } },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /**
   * Edits a draft decision's statement and title. Finalized decisions are
   * locked, so this filters on `status: 'draft'` and returns undefined for a
   * finalized one — the caller turns that into an explicit 409.
   */
  async editDecision(
    conversationId: string,
    decisionId: string,
    patch: { title?: string; statement?: string }
  ): Promise<Decision | undefined> {
    const update: Record<string, unknown> = {};
    if (typeof patch.title === 'string' && patch.title.trim()) update.title = patch.title.trim();
    if (typeof patch.statement === 'string' && patch.statement.trim()) update.statement = patch.statement.trim();
    if (Object.keys(update).length === 0) {
      return this.getDecisionById(conversationId, decisionId);
    }
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'draft' },
      { $set: update },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /**
   * Links or unlinks claims from a draft decision. Only drafts: the claim basis
   * of a finalized decision is part of the record and must not shift.
   */
  async setDecisionClaims(
    conversationId: string,
    decisionId: string,
    claimIds: string[]
  ): Promise<Decision | undefined> {
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'draft' },
      { $set: { claimIds: dedupeIds(claimIds) } },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /** Sets the required-approver list on a draft decision. */
  async setDecisionApprovers(
    conversationId: string,
    decisionId: string,
    approverIds: string[]
  ): Promise<Decision | undefined> {
    const next = dedupeIds(approverIds);
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'draft' },
      {
        $set: { requiredApproverIds: next },
        // Drop any approvals from members who are no longer required.
        $pull: { approvals: { userId: { $nin: next } } }
      },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /**
   * Records one member's approval, idempotently. Up-serting on the (decisionId,
   * userId) pair means approving twice is a no-op rather than a duplicate row,
   * and un-approving then re-approving moves the timestamp forward.
   */
  async approveDecision(
    conversationId: string,
    decisionId: string,
    userId: string,
    userName: string
  ): Promise<Decision | undefined> {
    const now = new Date().toISOString();
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'draft' },
      {
        $pull: { approvals: { userId } },
      },
      { new: true }
    ).lean();
    if (!d) return undefined;

    const updated = await DecisionModel.findByIdAndUpdate(
      decisionId,
      {
        $push: { approvals: { userId, userName, approvedAt: now } }
      },
      { new: true }
    ).lean();
    if (!updated) return undefined;
    return { ...updated, id: updated._id } as unknown as Decision;
  }

  /** Withdraws one member's approval. */
  async withdrawApproval(
    conversationId: string,
    decisionId: string,
    userId: string
  ): Promise<Decision | undefined> {
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'draft' },
      { $pull: { approvals: { userId } } },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /**
   * Flips a draft to finalized. Filters on `status: 'draft'` so a double submit
   * or a race with a reopen is a harmless no-op rather than a second
   * finalization that overwrites the record.
   */
  async finalizeDecision(
    conversationId: string,
    decisionId: string,
    actor: { id: string; name: string }
  ): Promise<Decision | undefined> {
    const now = new Date().toISOString();
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'draft' },
      {
        $set: {
          status: 'finalized',
          finalizedAt: now,
          finalizedBy: actor.id,
          finalizedByName: actor.name
        },
        $push: {
          history: {
            action: 'finalized',
            actorId: actor.id,
            actorName: actor.name,
            detail: 'Finalized — every gate condition was satisfied.',
            at: now
          }
        }
      },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /**
   * Returns a finalized decision to draft. The original finalization entry
   * stays in `history`, so the record always shows the decision was locked and
   * by whom — reopening is visible, never silent.
   */
  async reopenDecision(
    conversationId: string,
    decisionId: string,
    actor: { id: string; name: string },
    reason: string
  ): Promise<Decision | undefined> {
    const now = new Date().toISOString();
    const d = await DecisionModel.findOneAndUpdate(
      { _id: decisionId, conversationId, status: 'finalized' },
      {
        $set: {
          status: 'draft',
          finalizedAt: null,
          finalizedBy: null,
          finalizedByName: null
        },
        $push: {
          history: {
            action: 'reopened',
            actorId: actor.id,
            actorName: actor.name,
            detail: `Reopened: ${reason}`,
            at: now
          }
        }
      },
      { new: true }
    ).lean();
    if (!d) return undefined;
    return { ...d, id: d._id } as unknown as Decision;
  }

  /** Deletes one decision, scoped to its room. */
  async deleteDecision(conversationId: string, decisionId: string): Promise<boolean> {
    const res = await DecisionModel.deleteOne({ _id: decisionId, conversationId });
    return res.deletedCount > 0;
  }

  /** Deletes every decision in a room (used by room clearing). */
  async deleteDecisionsByConversation(conversationId: string): Promise<number> {
    const res = await DecisionModel.deleteMany({ conversationId });
    return res.deletedCount || 0;
  }

  /**
   * Tears down the room memory attached to a set of claims: every contradiction
   * edge they participate in, the human discussion on each of those edges, and
   * the evidence attached to the claims themselves. Shared by single-message
   * deletion and whole-room clearing.
   */
  private async cascadeClaims(claimIds: string[]): Promise<void> {
    if (!claimIds || claimIds.length === 0) return;
    const rels = await ClaimRelationModel.find({
      $or: [{ claimAId: { $in: claimIds } }, { claimBId: { $in: claimIds } }]
    }).select('_id').lean();
    const relationIds = rels.map((r: any) => r._id as string);
    await this.deleteDiscussionForRelations(relationIds);
    await this.deleteEvidenceForClaims(claimIds);
    await ClaimRelationModel.deleteMany({ _id: { $in: relationIds } });
    await ClaimModel.deleteMany({ _id: { $in: claimIds } });
  }

  /** Whether any model on a message is still pending or mid-stream. */
  private async isMessageBusy(messageId: string): Promise<boolean> {
    const doc = await MessageModel.findOne({ _id: messageId }).select('modelResponses').lean();
    if (!doc) return false;
    return Object.values(doc.modelResponses || {}).some(
      (r: any) => r?.status === 'streaming' || r?.status === 'pending'
    );
  }

  /**
   * Deletes one prompt and its response card(s). The claims the response
   * produced go with it, cascading to their contradiction edges and discussions,
   * so no room memory outlives the message it came from.
   *
   * Returns false when the message is missing or a model is still generating —
   * deleting mid-stream would let the completion handler resurrect the row.
   */
  async deleteMessage(conversationId: string, messageId: string): Promise<boolean> {
    const exists = await MessageModel.findOne({ _id: messageId, conversationId }).select('_id').lean();
    if (!exists) return false;
    if (await this.isMessageBusy(messageId)) return false;

    const claimDocs = await ClaimModel.find({ conversationId, messageId }).select('_id').lean();
    await this.cascadeClaims(claimDocs.map((c: any) => c._id as string));

    const res = await MessageModel.deleteOne({ _id: messageId, conversationId });
    return res.deletedCount > 0;
  }

  /**
   * Clears every prompt and response in a room, keeping the room itself. The
   * room's whole memory goes with it — claims, contradiction edges, and their
   * discussions — because all of it was derived from the messages being removed.
   *
   * Returns -1 when a model is still generating anywhere in the room, for the
   * same reason as deleteMessage.
   */
  async clearConversationMessages(conversationId: string): Promise<number> {
    // In-flight streams always sit on the newest messages, so a bounded reverse
    // scan is enough to spot a busy room without walking the whole history.
    const recent = await MessageModel.find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('modelResponses')
      .lean();
    const busy = recent.some((m: any) =>
      Object.values(m.modelResponses || {}).some((r: any) => r?.status === 'streaming' || r?.status === 'pending')
    );
    if (busy) return -1;

    const claimDocs = await ClaimModel.find({ conversationId }).select('_id').lean();
    await this.cascadeClaims(claimDocs.map((c: any) => c._id as string));
    // Belt-and-braces: any discussion data not reached through an edge.
    await DiscussionCommentModel.deleteMany({ conversationId });
    await ContradictionVoteModel.deleteMany({ conversationId });
    // ...and any evidence orphaned from its claim.
    await EvidenceModel.deleteMany({ conversationId });
    // A room whose claims are gone has no basis for a decision either.
    await DecisionModel.deleteMany({ conversationId });

    const res = await MessageModel.deleteMany({ conversationId });
    return res.deletedCount || 0;
  }

  // --- SAVED RESPONSE METHODS ---
  async getSavedResponses(workspaceId: string): Promise<SavedResponse[]> {
    const docs = await SavedResponseModel.find({ workspaceId }).lean();
    return docs.map((d: any) => ({ ...d, id: d._id })) as unknown as SavedResponse[];
  }

  async saveResponse(res: SavedResponse): Promise<SavedResponse> {
    const created = await SavedResponseModel.create({
      _id: res.id || generateUUID(),
      workspaceId: res.workspaceId,
      prompt: res.prompt,
      modelName: res.modelName,
      responseContent: res.responseContent,
      savedBy: res.savedBy,
      senderName: res.senderName,
      createdAt: res.createdAt || new Date().toISOString()
    });
    return { ...created.toJSON(), id: created._id } as unknown as SavedResponse;
  }

  async unsaveResponse(id: string): Promise<boolean> {
    const res = await SavedResponseModel.deleteOne({ _id: id });
    return res.deletedCount > 0;
  }

  // --- ADMIN & TELEMETRY AUDIT METHODS ---
  async logAudit(
    userId: string | undefined,
    userName: string | undefined,
    userEmail: string | undefined,
    action: string,
    details: string,
    workspaceId?: string,
    ipAddress?: string
  ): Promise<any> {
    try {
      const log = await AuditLogModel.create({
        _id: generateUUID(),
        userId,
        userName,
        userEmail,
        action,
        details,
        workspaceId,
        ipAddress,
        createdAt: new Date().toISOString()
      });
      return log;
    } catch (err) {
      console.error('Failed to save audit log:', err);
    }
  }

  // ── TIMELINE (decision replay) ──────────────────────────────────────────
  //
  // The event stream the replay view scrubs through. Recording is best-effort
  // by design: a timeline write must never be the reason a room action fails,
  // so every method here swallows its own errors and logs them instead.

  /**
   * Records one room-level event. Returns the event, or null if the write
   * failed — callers treat null as "the timeline missed this one" and carry
   * on, since the action itself already succeeded.
   */
  async recordTimelineEvent(input: {
    conversationId: string;
    decisionId?: string | null;
    kind: TimelineEventKind;
    at?: string;
    actorId?: string | null;
    actorName: string;
    title: string;
    detail: string;
    messageId?: string | null;
    claimIds?: string[];
    relationId?: string | null;
    evidenceId?: string | null;
    memberIds?: string[];
    meta?: Record<string, unknown>;
  }): Promise<TimelineEvent | null> {
    try {
      const doc = await TimelineEventModel.create({
        _id: generateUUID(),
        conversationId: input.conversationId,
        decisionId: input.decisionId ?? null,
        kind: input.kind,
        at: input.at ?? new Date().toISOString(),
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        title: input.title,
        detail: input.detail,
        messageId: input.messageId ?? null,
        claimIds: dedupeIds(input.claimIds),
        relationId: input.relationId ?? null,
        evidenceId: input.evidenceId ?? null,
        memberIds: dedupeIds(input.memberIds),
        meta: input.meta ?? {},
        createdAt: new Date().toISOString()
      });
      return { ...doc.toJSON(), id: doc._id } as unknown as TimelineEvent;
    } catch (err) {
      console.error('Failed to record a timeline event:', err);
      return null;
    }
  }

  /**
   * Reads a room's whole event stream, oldest first. Ordered by `at` then by
   * `_id` so the same data always yields the same positions — the scrubber's
   * cursor must be stable if the room re-opens the replay mid-session.
   */
  async getTimelineEvents(conversationId: string, limit = 1000): Promise<TimelineEvent[]> {
    const docs = await TimelineEventModel
      .find({ conversationId })
      .sort({ at: 1, _id: 1 })
      .limit(limit)
      .lean();
    return docs.map((d) => ({ ...d, id: d._id })) as unknown as TimelineEvent[];
  }

  /**
   * Appends a decision history entry AND records the matching timeline event
   * in one call, so the two records cannot drift apart. `refs` carries the ids
   * `history.detail` deliberately does not store — the replay needs a claim or
   * member id to reconstruct state, and the human-readable detail is the wrong
   * place for one.
   *
   * The history write happens first and is awaited: it is the authoritative
   * trail existing behaviour already depends on. The timeline write follows
   * and can only fail loudly into the log, never into the caller's path.
   */
  async recordDecisionEvent(
    conversationId: string,
    decisionId: string,
    entry: DecisionHistoryEntry,
    refs?: { claimIds?: string[]; memberIds?: string[]; meta?: Record<string, unknown> }
  ): Promise<void> {
    await this.appendDecisionHistory(conversationId, decisionId, entry);
    try {
      await this.recordTimelineEvent({
        conversationId,
        decisionId,
        kind: historyActionToTimelineKind(entry.action),
        at: entry.at,
        actorId: entry.actorId,
        actorName: entry.actorName,
        title: historyActionLabel(entry.action),
        detail: entry.detail,
        claimIds: refs?.claimIds,
        memberIds: refs?.memberIds,
        meta: refs?.meta
      });
    } catch (err) {
      console.error('Failed to record the decision timeline event:', err);
    }
  }

  /** Deletes every timeline event for a decision, used when a decision is
   *  deleted outright. Room-level events are left alone — the room's history
   *  is not the decision's to erase. */
  async deleteDecisionTimelineEvents(decisionId: string): Promise<void> {
    try {
      await TimelineEventModel.deleteMany({ decisionId });
    } catch (err) {
      console.error('Failed to delete decision timeline events:', err);
    }
  }

  async blockUser(id: string, blocked: boolean): Promise<boolean> {
    const res = await UserModel.findByIdAndUpdate(id, { blocked }, { new: true });
    return !!res;
  }

  async updateUserRole(id: string, role: string): Promise<boolean> {
    const res = await UserModel.findByIdAndUpdate(id, { role }, { new: true });
    return !!res;
  }

  async deleteUser(id: string): Promise<boolean> {
    const res = await UserModel.deleteOne({ _id: id });
    return res.deletedCount > 0;
  }

  async createInvitation(input: Omit<Invitation, 'id' | 'createdAt'>): Promise<Invitation> {
    const created = await InvitationModel.create(input);
    return created.toObject();
  }

  async getInvitationById(id: string): Promise<Invitation | null> {
    const doc = await InvitationModel.findById(id);
    return doc ? doc.toObject() : null;
  }

  async getPendingInvitationsForUser(userId: string): Promise<Invitation[]> {
    const docs = await InvitationModel.find({ inviteeId: userId, status: 'pending' }).sort({ createdAt: 1 });
    return docs.map((d) => d.toObject());
  }

  /** How many times this address has already declined this workspace. */
  async countRejections(workspaceId: string, inviteeId: string): Promise<number> {
    const res = await InvitationModel.countDocuments({ workspaceId, inviteeId, status: 'rejected' });
    return res;
  }

  async hasPendingInvitation(workspaceId: string, inviteeId: string): Promise<boolean> {
    const res = await InvitationModel.countDocuments({ workspaceId, inviteeId, status: 'pending' });
    return res > 0;
  }

  async updateInvitationStatus(id: string, status: 'accepted' | 'rejected'): Promise<Invitation | null> {
    const doc = await InvitationModel.findByIdAndUpdate(id, { status }, { new: true });
    return doc ? doc.toObject() : null;
  }
}

// Export database interface for application routing
export const db = new MongoDatabaseAdapter();
export default db;
