import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { db } from './database';
import { streamModel, AI_MODELS } from './ai';
import { extractClaims, buildRoomContext, traceRoomContext } from './context';
import { detectContradictions } from './relations';
import { Message, PresenceUser, Claim } from '../src/types';
import { generateUUID, getJwtSecret } from './auth';

// In-memory active presence track: workspaceId -> [ PresenceUsers ]
const workspacePresence: Record<string, PresenceUser[]> = {};

// Keep track of socketId -> {userId, workspaceId} for fast disconnect cleanup
interface SocketMeta {
  userId: string;
  userName: string;
  avatar: string;
  workspaceId: string;
}
const activeSockets: Record<string, SocketMeta> = {};

// Active generation jobs: `${messageId}:${modelKey}` -> abort handle.
// Lets a user stop a single model (or all models of a message) mid-stream.
interface ActiveGeneration {
  controller: AbortController;
  /** True once the user requested a stop; completion/error callbacks then save a 'stopped' status. */
  stopped: boolean;
}
const activeGenerations: Map<string, ActiveGeneration> = new Map();

// Globally accessible Socket Server reference for route-based messaging
let globalIo: SocketServer | null = null;

export function getIo(): SocketServer | null {
  return globalIo;
}

export function setupSocketIO(server: HttpServer) {
  const io = new SocketServer(server, {
    cors: {
      origin: '*', // Allow full connection inside sandbox
      methods: ['GET', 'POST']
    }
  });

  globalIo = io;

  // --- HANDSHAKE AUTHENTICATION MIDDLEWARE ---
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      
      if (!token) {
        return next(new Error('Authentication failed: Missing handshake auth token.'));
      }

      const secret = getJwtSecret();
      if (!secret) {
        return next(new Error('Authentication failed: JWT_SECRET environment key error.'));
      }

      const decoded = jwt.verify(token, secret) as { id: string; email: string; name: string; role: string };
      const user = await db.getUserById(decoded.id);

      if (!user) {
        return next(new Error('Authentication failed: Invalid collaborator credentials.'));
      }

      if (user.blocked) {
        return next(new Error('Authentication failed: Your account has been suspended by system administrators.'));
      }

      // Attach credentials to socket context
      socket.data = { user };
      next();
    } catch (err: any) {
      // An expired access token on reconnect is expected — the client silently
      // refreshes and retries, so log it quietly instead of dumping a stack trace.
      if (err?.name === 'TokenExpiredError') {
        console.warn('Socket handshake: access token expired, awaiting client refresh.');
      } else if (err?.name === 'MongoServerSelectionError' || err?.code === 'ENOTFOUND') {
        // The token verified fine; the user lookup just couldn't reach Atlas
        // (transient DNS/cluster blip). The client's reconnect handler will
        // keep retrying, so keep this to one quiet line rather than a dump.
        console.warn('Socket handshake deferred: user store temporarily unreachable.');
      } else {
        console.error('Socket authentication handshake signature error:', err);
      }
      return next(new Error('Authentication failed: Invalid token signature or expiration.'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userObj = socket.data?.user;
    console.log(`Secured socket connection active: ${socket.id} (${userObj?.name})`);

    // -- JOIN WORKSPACE ROOM (SECURE CHECK) --
    socket.on('join-workspace', async (data: { workspaceId: string; userId: string; userName: string; avatar: string }) => {
      const { workspaceId, userId, userName, avatar } = data;
      if (!workspaceId || !userId) return;

      try {
        // Strict boundary protection check
        const workspace = await db.getWorkspaceById(workspaceId);
        if (!workspace) {
          socket.emit('error-alert', { message: 'The requested workspace does not exist.' });
          return;
        }

        const isMember = workspace.ownerId === userId || (workspace.memberIds && workspace.memberIds.includes(userId));
        const isAdmin = userObj?.role === 'admin';

        if (!isMember && !isAdmin) {
          socket.emit('error-alert', { message: 'Unauthorized: You are not registered as an authorized member of this workspace.' });
          return;
        }

        const roomName = `workspace:${workspaceId}`;
        socket.join(roomName);

        // Register socket details for cleanup
        activeSockets[socket.id] = { userId, userName, avatar, workspaceId };

        if (!workspacePresence[workspaceId]) {
          workspacePresence[workspaceId] = [];
        }

        // De-duplicate users in presence list
        workspacePresence[workspaceId] = workspacePresence[workspaceId].filter(u => u.userId !== userId);
        
        const newPres: PresenceUser = {
          userId,
          userName,
          avatar,
          lastActive: new Date().toISOString()
        };
        
        workspacePresence[workspaceId].push(newPres);

        // Broadcast presence updates
        io.to(roomName).emit('presence-sync', workspacePresence[workspaceId]);
        console.log(`Secured Channel: ${userName} joined workspace room ID: ${roomName}`);
      } catch (err) {
        console.error('Failed to complete workspace join auth sequences:', err);
      }
    });

    // -- LEAVE WORKSPACE ROOM --
    socket.on('leave-workspace', (data: { workspaceId: string; userId: string }) => {
      const { workspaceId, userId } = data;
      if (!workspaceId || !userId) return;

      const roomName = `workspace:${workspaceId}`;
      socket.leave(roomName);

      if (workspacePresence[workspaceId]) {
        workspacePresence[workspaceId] = workspacePresence[workspaceId].filter(u => u.userId !== userId);
        io.to(roomName).emit('presence-sync', workspacePresence[workspaceId]);
      }

      delete activeSockets[socket.id];
    });

    // -- COLLABORATIVE PROMPT EDITS --
    socket.on('prompt-text-change', (data: { workspaceId: string; promptText: string; userId: string; userName: string }) => {
      const { workspaceId, promptText, userId, userName } = data;
      const roomName = `workspace:${workspaceId}`;
      
      // Update typing/activity status on presence record
      if (workspacePresence[workspaceId]) {
        const presUser = workspacePresence[workspaceId].find(u => u.userId === userId);
        if (presUser) {
          presUser.activity = 'editing...';
          presUser.lastActive = new Date().toISOString();
        }
      }

      // Broadcast content to everyone in room EXCEPT the sender
      socket.to(roomName).emit('prompt-text-sync', {
        workspaceId,
        promptText,
        updatedBy: userId,
        updatedByName: userName
      });
    });

    // -- TYPING FEEDBACK AND THROTLED EVENTS --
    socket.on('user-typing-start', (data: { workspaceId: string; userId: string; userName: string }) => {
      const { workspaceId, userId, userName } = data;
      const roomName = `workspace:${workspaceId}`;

      if (workspacePresence[workspaceId]) {
        const presUser = workspacePresence[workspaceId].find(u => u.userId === userId);
        if (presUser) {
          presUser.activity = 'typing...';
          presUser.lastActive = new Date().toISOString();
        }
        io.to(roomName).emit('presence-sync', workspacePresence[workspaceId]);
        
        // Emit explicit standardized typing event requested in Step 5
        io.to(roomName).emit('user-typing', {
          workspaceId,
          userId,
          userName,
          isTyping: true
        });
      }
    });

    socket.on('user-typing-stop', (data: { workspaceId: string; userId: string }) => {
      const { workspaceId, userId } = data;
      const roomName = `workspace:${workspaceId}`;

      if (workspacePresence[workspaceId]) {
        const presUser = workspacePresence[workspaceId].find(u => u.userId === userId);
        if (presUser) {
          presUser.activity = undefined;
        }
        io.to(roomName).emit('presence-sync', workspacePresence[workspaceId]);
        
        // Emit explicit standardized typing event requested in Step 5
        io.to(roomName).emit('user-typing', {
          workspaceId,
          userId,
          isTyping: false
        });
      }
    });

    // -- SUBMIT PROMPT FOR REALTIME AI MULTI-STREAMING COMPARISON --
    socket.on('submit-prompt', async (data: {
      workspaceId: string;
      conversationId: string;
      promptText: string;
      selectedModels: string[]; // e.g. ["gemini-2.5-flash", "gpt-oss-120b", "qwen3.8-27b"]
      userId: string;
      userName: string;
      userAvatar: string;
    }) => {
      const { workspaceId, conversationId, promptText, selectedModels, userId, userName, userAvatar } = data;
      const roomName = `workspace:${workspaceId}`;

      if (!workspaceId || !conversationId || !promptText || !selectedModels || selectedModels.length === 0) {
        return;
      }

      // Clear any typing activity
      if (workspacePresence[workspaceId]) {
        const presUser = workspacePresence[workspaceId].find(u => u.userId === userId);
        if (presUser) presUser.activity = undefined;
        io.to(roomName).emit('presence-sync', workspacePresence[workspaceId]);
      }

      // Map models parameter correctly using registry config
      const modelResponsesRecord: Message['modelResponses'] = {};

      selectedModels.forEach(modelKey => {
        const modelObj = AI_MODELS[modelKey];
        modelResponsesRecord[modelKey] = {
          modelName: modelObj ? modelObj.name : modelKey,
          content: '',
          status: 'pending'
        };
      });

      const messageId = generateUUID();
      const newMessage: Message = {
        id: messageId,
        conversationId,
        senderId: userId,
        senderName: userName,
        senderAvatar: userAvatar,
        promptText,
        modelResponses: modelResponsesRecord,
        createdAt: new Date().toISOString()
      };

      // Save initial state to MongoDB
      await db.createMessage(newMessage);

      // Log AI query audit trail
      db.logAudit(userId, userName, userObj?.email || 'unknown', 'AI_PROMPT_REQUEST', `Triggered comparative AI queries for models: ${selectedModels.join(', ')}`, workspaceId).catch(() => {});

      // Broadcast Message Created to everyone (so cards with shimmer appear immediately in workspace!)
      io.to(roomName).emit('message-created', newMessage);

      // The prompt opens the replay: every claim the room ever mines traces back
      // to one of these, so a decision's timeline shows the question that
      // started it. Fire-and-forget — the room must not lose a prompt because
      // the event stream was briefly unavailable.
      db.recordTimelineEvent({
        conversationId,
        kind: 'prompt',
        actorId: userId,
        actorName: userName,
        title: 'Prompt sent',
        detail: promptText.length > 140 ? `${promptText.slice(0, 140)}…` : promptText,
        messageId,
        meta: { promptText, models: selectedModels }
      }).catch(() => {});

      // Build the room's persistent context ONCE and share it with every
      // selected model. Keeping this outside the per-model loop means N models
      // cost one history lookup, not N, and every model sees identical grounding.
      // The current message has no completed responses yet, so it is naturally
      // excluded from its own context.
      const { prompt: contextPrompt, hasContext } = await buildRoomContext(conversationId, promptText);
      traceRoomContext(contextPrompt, hasContext);

      // Execute comparative streaming asynchronously in parallel
      selectedModels.forEach(async (modelKey) => {
        try {
          // Update status to streaming in database
          const msgRef = await db.getMessageById(messageId);
          if (msgRef && msgRef.modelResponses[modelKey]) {
            msgRef.modelResponses[modelKey].status = 'streaming';
            await db.updateMessage(messageId, msgRef);
          }

          // Emit old model update status
          io.to(roomName).emit('model-status-update', {
            messageId,
            modelKey,
            status: 'streaming'
          });

          // Emit new modern standardized stream status (Step 5)
          io.to(roomName).emit('ai-stream-start', {
            messageId,
            modelKey,
            status: 'streaming'
          });

          let fullContent = '';
          const startTime = Date.now();

          const generationKey = `${messageId}:${modelKey}`;
          const controller = new AbortController();
          const generation: ActiveGeneration = { controller, stopped: false };
          activeGenerations.set(generationKey, generation);

          // Records a model reply on the timeline, once per outcome. A reply is
          // the thing the room's claims are mined from, so the replay needs to
          // see it — including when it was cut short or failed, which is part
          // of the room's record rather than something to paper over.
          const recordResponse = (status: 'completed' | 'stopped' | 'failed', durationMs?: number, error?: string): void => {
            const modelConfig = AI_MODELS[modelKey];
            db.recordTimelineEvent({
              conversationId,
              kind: 'ai-response',
              actorId: null,
              actorName: modelConfig ? modelConfig.name : modelKey,
              title: status === 'completed' ? 'Model replied' : status === 'stopped' ? 'Reply stopped' : 'Reply failed',
              detail: status === 'completed'
                ? 'Completed a reply to the prompt.'
                : status === 'stopped'
                  ? 'The reply was stopped mid-stream.'
                  : `The reply failed: ${(error ?? 'unknown error').slice(0, 120)}`,
              messageId,
              meta: { modelKey, status, durationMs, error: error ?? null }
            }).catch(() => {});
          };

          const onChunkCallback = (chunk: string) => {
            fullContent += chunk;
            // Emit traditional chunk
            io.to(roomName).emit('model-stream-chunk', {
              messageId,
              modelKey,
              chunk
            });
            // Emit modern standardized chunk (Step 5)
            io.to(roomName).emit('ai-stream-chunk', {
              messageId,
              modelKey,
              chunk
            });
          };

          // Extract durable claims from the finished response and broadcast them
          // to everyone in the room. Runs after the response is persisted, so a
          // failure here never loses the answer itself. Purely heuristic — no
          // extra model call, identical for every provider.
          const broadcastNewClaims = async (finalText: string) => {            const extracted = extractClaims(finalText);
            if (extracted.length === 0) return;

            const modelConfig = AI_MODELS[modelKey];
            const now = new Date().toISOString();
            const claimDocs: Claim[] = extracted.map((c) => ({
              id: generateUUID(),
              conversationId,
              messageId,
              modelKey,
              modelName: modelConfig ? modelConfig.name : modelKey,
              text: c.text,
              createdAt: now,
            }));

            const saved = await db.createClaims(claimDocs);
            if (saved.length > 0) {
              io.to(roomName).emit('claims-created', { messageId, modelKey, claims: saved });

              // The room gained durable memory: claims later prompts are
              // grounded in, and the load-bearing ones become a decision's
              // foundation. Recorded against the message so a decision's
              // timeline can trace a claim back to the answer it came from.
              db.recordTimelineEvent({
                conversationId,
                kind: 'claim-extracted',
                actorId: null,
                actorName: modelConfig ? modelConfig.name : modelKey,
                title: 'Claims extracted',
                detail: `${saved.length} claim${saved.length === 1 ? '' : 's'} mined from a model reply.`,
                messageId,
                claimIds: saved.map((c) => c.id),
                meta: {
                  modelKey,
                  claims: saved.map((c) => ({ id: c.id, text: c.text, modelName: c.modelName }))
                }
              }).catch(() => {});

              // Measure the fresh claims against what the room already established.
              // Best-effort like extraction itself: a failure here is contained, and
              // never disturbs the response the user just received.
              detectContradictions(conversationId, saved)
                .then((relations) => {
                  if (relations.length === 0) return;
                  const contradictions = relations.filter((rel) => rel.relationship === 'CONTRADICT');
                  if (contradictions.length > 0) {
                    io.to(roomName).emit('contradiction-detected', { conversationId, relations: contradictions });
                  }

                  // Every edge the detector reports is part of the room's
                  // narrative: a CONTRADICT is a disagreement the room must
                  // face, while SUPPORT and RELATED are the context around it.
                  // Only CONTRADICT counts against the gate, so that is the
                  // distinction the replay keeps.
                  for (const rel of relations) {
                    db.recordTimelineEvent({
                      conversationId,
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
                    }).catch(() => {});
                  }
                })
                .catch((e) => console.warn('[socket] contradiction detection failed:', e?.message || e));
            }
          };

          // Saves a user-requested stop with whatever text was already streamed.
          const completeStopped = async () => {
            const durationMs = Date.now() - startTime;
            const updatedMsg = await db.getMessageById(messageId);
            if (updatedMsg && updatedMsg.modelResponses[modelKey]) {
              updatedMsg.modelResponses[modelKey].content = fullContent;
              updatedMsg.modelResponses[modelKey].status = 'stopped';
              updatedMsg.modelResponses[modelKey].durationMs = durationMs;
              await db.updateMessage(messageId, updatedMsg);
            }

            io.to(roomName).emit('model-stream-stopped', {
              messageId,
              modelKey,
              content: fullContent,
              durationMs
            });
            io.to(roomName).emit('ai-stream-end', {
              messageId,
              modelKey,
              content: fullContent,
              durationMs,
              status: 'stopped'
            });

            recordResponse('stopped', durationMs);

            // A stopped stream may still contain complete, quotable sentences.
            broadcastNewClaims(fullContent).catch((e) =>
              console.warn('[socket] claim extraction after stop failed:', e?.message || e)
            );
          };

          const onCompleteCallback = async (finalText: string) => {
            if (generation.stopped) {
              await completeStopped();
              return;
            }
            const durationMs = Date.now() - startTime;
            
            // Save final rendering inside persistent DB
            const updatedMsg = await db.getMessageById(messageId);
            if (updatedMsg && updatedMsg.modelResponses[modelKey]) {
              updatedMsg.modelResponses[modelKey].content = finalText;
              updatedMsg.modelResponses[modelKey].status = 'completed';
              updatedMsg.modelResponses[modelKey].durationMs = durationMs;
              await db.updateMessage(messageId, updatedMsg);
            }

            // Broadcast traditional complete event
            io.to(roomName).emit('model-stream-complete', {
              messageId,
              modelKey,
              content: finalText,
              durationMs
            });

            // Broadcast modern standardized complete event (Step 5)
            io.to(roomName).emit('ai-stream-end', {
              messageId,
              modelKey,
              content: finalText,
              durationMs,
              status: 'completed'
            });

            recordResponse('completed', durationMs);

            // Mine the finished answer for durable claims and broadcast them.
            broadcastNewClaims(finalText).catch((e) =>
              console.warn('[socket] claim extraction failed:', e?.message || e)
            );
          };

          const onErrorCallback = async (err: string) => {
            // An aborted stream is a user stop, not a failure.
            if (generation.stopped) {
              await completeStopped();
              return;
            }
            console.error(`[socket] stream failed for model ${modelKey}: ${err}`);
            const updatedMsg = await db.getMessageById(messageId);
            if (updatedMsg && updatedMsg.modelResponses[modelKey]) {
              updatedMsg.modelResponses[modelKey].status = 'failed';
              updatedMsg.modelResponses[modelKey].error = err;
              await db.updateMessage(messageId, updatedMsg);
            }

            io.to(roomName).emit('model-stream-failed', {
              messageId,
              modelKey,
              error: err
            });

            io.to(roomName).emit('ai-stream-end', {
              messageId,
              modelKey,
              error: err,
              status: 'failed'
            });

            recordResponse('failed', undefined, err);
          };

          // Route to centralized AI providers; transport is resolved from the registry.
          // The abort controller lets the client stop this model mid-stream.
          // `contextPrompt` grounds the answer in the room's claims + recent
          // history; it is identical across models, so the comparison stays fair.
          try {
            await streamModel(modelKey, contextPrompt, onChunkCallback, onCompleteCallback, onErrorCallback, controller.signal, hasContext);
          } finally {
            const current = activeGenerations.get(generationKey);
            if (current === generation) activeGenerations.delete(generationKey);
          }
        } catch (err: any) {
          console.error(`Socket query loop failure on model ${modelKey}:`, err);
          io.to(roomName).emit('model-stream-failed', {
            messageId,
            modelKey,
            error: err.message || String(err)
          });
        }
      });
    });

    // -- MANUAL STOP OF AN ACTIVE GENERATION --
    socket.on('stop-generation', (data: { messageId: string; modelKey?: string }) => {
      const { messageId, modelKey } = data || {};
      if (!messageId) return;

      const prefix = `${messageId}:`;
      let stopped = 0;

      for (const [key, generation] of Array.from(activeGenerations.entries())) {
        if (!key.startsWith(prefix)) continue;
        if (modelKey && key !== `${messageId}:${modelKey}`) continue;
        generation.stopped = true;
        generation.controller.abort();
        stopped++;
      }

      if (stopped === 0) {
        socket.emit('error-alert', { message: 'That stream has already finished.' });
        return;
      }

      console.log(`[socket] stop requested for ${stopped} active stream(s) on message ${messageId}`);
    });

    // -- DISCONNECT ROUTINES --
    socket.on('disconnect', () => {
      const socketDetails = activeSockets[socket.id];
      if (socketDetails) {
        const { userId, workspaceId, userName } = socketDetails;
        const roomName = `workspace:${workspaceId}`;

        if (workspacePresence[workspaceId]) {
          workspacePresence[workspaceId] = workspacePresence[workspaceId].filter(u => u.userId !== userId);
          io.to(roomName).emit('presence-sync', workspacePresence[workspaceId]);
        }

        console.log(`Presence cleaned up for disconnected user: ${userName}`);
        delete activeSockets[socket.id];
      }
    });
  });
}
