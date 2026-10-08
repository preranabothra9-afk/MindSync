# MindSync — Real-Time Multi-Model AI Collaboration Platform

[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NodeJS](https://img.shields.io/badge/Node.js-22.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.8-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.0-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-83_passing-22c55e?style=for-the-badge)](#-testing)

MindSync is a production-grade, real-time platform where teams collaborate with AI rather than just prompt it. Multiple models answer the same prompt side by side, the room mines durable **claims** from their answers, a detector flags **contradictions** between them, and people attach **evidence** and record **decisions** that a server-side **evidence gate** refuses to finalize until every claim is backed by something a human stood behind.

Everything runs on one origin — the Node/Express server hosts Socket.IO and serves the Vite app as middleware in development, so there is no second port or proxy to configure.

---

## Table of Contents

- [What MindSync is for](#-what-mindsync-is-for)
- [Feature tour](#-feature-tour)
- [The decision pipeline](#-the-decision-pipeline)
- [Tech stack](#-tech-stack)
- [Architecture](#-architecture)
- [Getting started](#-getting-started)
- [Environment variables](#-environment-variables)
- [Auth, verification & sessions](#-auth-verification--sessions)
- [Workspaces, invitations & leaving](#-workspaces-invitations--leaving)
- [Realtime engine](#-realtime-engine)
- [AI models & streaming](#-ai-models--streaming)
- [Admin & telemetry](#-admin--telemetry)
- [Brand & theming](#-brand--theming)
- [Security](#-security)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## 🎯 What MindSync is for

Generative AI tools are single-player: one person, one prompt, one model, and an answer that evaporates. MindSync turns prompting into a **shared, persistent workspace** where:

- A team prompts **several models at once** and compares answers side by side, live, as tokens arrive.
- The room keeps a **memory** — meaningful statements are mined into claims that are injected into the next prompt, so models stay consistent with the ongoing discussion instead of treating each prompt in a vacuum.
- Disagreements between models surface as **contradictions** the room must face, discuss, and close with a written resolution — never auto-resolved by a model.
- Decisions are recorded with the claims and evidence behind them, and a finalization **gate** enforces that no decision is locked until its claims are actually backed by human evidence and its required approvals are in.

The throughline: **AI advises, humans decide.** Every closing action — resolving a contradiction, finalizing a decision, dismissing an objection — requires an authorized person.

---

## ✨ Feature tour

### Multi-model comparison
- **Parallel streaming** from Google Gemini, Groq, Mistral and NVIDIA-hosted models, rendered side-by-side with per-model timing and status.
- **Seven registered models**, three selected by default — a working comparison needs just two free API keys (Google AI Studio + Groq).
- **Rich markdown** rendering of streamed chunks, with code highlighting, tables and blockquotes.
- **Per-model failure isolation** — a missing key or a rate limit degrades one card, not the room; Gemini falls back through a model cascade and, on a total outage, a clearly-labelled offline response so the workspace never freezes.

### Collaboration
- **Live presence, typing indicators and shared prompt editing** over workspace-scoped socket rooms.
- **Always-on member roster** — the sidebar shows every workspace member by name with online / offline / active status, not just live sockets. Offline members get name-derived initial avatars; online members sort first.
- **Synchronized everything** — prompt text, model picks, messages, claims, evidence and decisions all broadcast to every member as they happen.

### The record layer
- **Claims** mined automatically from finished answers, each attributed to its source model and fed back into subsequent prompts.
- **Contradictions** detected between claims, each with a threaded discussion, replies, a room poll, and human-only resolve / dismiss.
- **Evidence** — links, files, quotes and notes — attached to any claim, with an optional AI reference generator that is always badged *unverified* and never counts as proof.
- **Per-claim evidence counts** shown directly on each claim row, so you can see what is backed without opening it.
- **Decisions** with linked claims, required approvers, an append-only history, a **scrubbable replay** that reconstructs the gate at every step, and an AI **summary** that is only ever a restatement of the record.

### Trust & governance
- **Email verification** before first login, with a 24-hour link and a "verify your email first" notice that re-issues the link for you.
- **Invitations as requests** — you invite, the recipient accepts or declines; nobody is added against their will, and five declines to one workspace locks it out.
- **Leaving with ownership transfer** — members leave freely; an owner hands the room to a successor first, and a sole owner is told to delete instead.
- **Audit logs** capturing auth events, role changes, blocks, workspace and decision lifecycle, with IP tracking.

### Admin
- **Diagnostic console, collaborator accounts, workspace oversight, AI telemetry, audit trail and health** tabs in a full admin panel.
- **Recharts dashboards** for DAU, workspaces, AI queries, response latency, model popularity and system load.
- **User management** — search, filter, block / unblock (which revokes live sessions), role elevation, manual email verification, and hard delete.

---

## 🧭 The decision pipeline

This is the heart of MindSync. Each room accumulates a record the team can later hold a decision against.

```text
prompt ──▶ models stream answers in parallel
              │
              ├─▶ answers persisted ──▶ claims mined (attributed per model)
              │                              │
              │                              ├─▶ claims injected into the NEXT prompt
              │                              │      (the room's persistent memory)
              │                              │
              │                              └─▶ contradiction detector compares
              │                                     new claims vs existing ones
              │                                        │
              │                                        ▼
              │                              CONTRADICT edge (status: detected)
              │                                        │
              │                                        ▼
              │                          threaded discussion + room poll
              │                                        │
              │                                        ▼
              │                          HUMAN closes it: resolved /
              │                          evidence-needed / dismissed
              │                                        │
   attach evidence ────────────────────────▶ claims become "backed"
   (link, file, quote, note)                     │
                                                 ▼
                                         draft a decision
                                         link its claims, name approvers
                                                 │
                                                 ▼
                                     ┌────────────────────────┐
                                     │   THE EVIDENCE GATE    │   enforced server-side
                                     │  every claim backed    │   on every finalize
                                     │  no open contradictions │
                                     │  all approvals given   │
                                     └────────────────────────┘
                                                 │
                                                 ▼
                                         finalized + replayable
                                         (scrub back to any moment
                                          and see the gate rebuild)
```

### The evidence gate, exactly

A decision finalizes only when all four conditions hold — evaluated against the database on every attempt, never in the client (`server/routes.ts` finalize route):

1. **It states what it rests on** — at least one claim from the room is linked.
2. **Every linked claim is backed** — it carries human evidence, *or* it was cleared by an explicit human resolution of a contradiction it was part of.
3. **No open contradictions remain** among the linked claims — a `detected` edge is an unresolved disagreement the room has not faced yet.
4. **Every required approval is recorded.**

**AI-generated evidence deliberately does not count.** A model's citation is its own reading of a response it wrote — models hallucinate sources, and the whole point of the gate is to stop a decision resting on a model's say-so. An AI reference is a lead to check, not evidence the gate accepts. It is stored, displayed and replayed, but badged *unverified* and excluded from the count.

If the gate is not satisfied, finalize returns **409 with the blockers** — complete sentences naming the specific claims, contradictions and approvers still outstanding. A request that bypasses the UI (curl, a tampered button) is refused identically.

### The replay

Every event — prompt, claim mined, contradiction detected, evidence attached, vote cast, approval given — is recorded to a timeline. The decision replay scrubs through it and **reconstructs** the gate at each step, so you can see exactly when the room *could* have finalized and what was still outstanding. The gate shown is recomputed from the same rules rather than stored, so it can never disagree with the record.

---

## 🛠️ Tech Stack

**Frontend**
- React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS 4
- Zustand (split stores: auth, workspace, chat, UI)
- Motion · lucide-react · recharts · react-markdown

**Backend**
- Node 22 · Express 4.21 · Socket.IO 4.8
- MongoDB + Mongoose 9.6 · JWT (access + rotating refresh) · Zod · bcrypt
- `@google/genai` (native SDK streaming) · OpenAI-compatible SSE for Groq / Mistral / NVIDIA

**Tooling**
- `tsc --noEmit` as the lint gate · Node's built-in test runner (83 tests) · esbuild for the server bundle

---

## 🏗️ Architecture

```text
+---------------------------------------------------------------------------+
|                              BROWSER (one origin)                         |
|  React 19 ── Zustand stores ─── secureFetch (Bearer + 401 refresh/retry)  |
|      │                                                                    |
|      ├── Socket.IO client ──────────────► /api REST ────────────────┐     |
+----------------------------------------------------------------------|-----+
                                                                       |  trust proxy
+----------------------------------------------------------------------|-----+
|                    SINGLE HTTP SERVER  (server.ts, port 3000)         |     |
|   Express ─ helmet, cors, cookie-parser, rate limiters, /api router  |◄----+
|      │                                                               |
|      ├── dev:  Vite mounted AS middleware (HMR, same origin)         |
|      ├── prod: express.static(dist) + SPA fallback                   |
|      │                                                               |
|      └── Socket.IO engine (handshake JWT auth)                       |
|             ├─ workspace:<id> rooms (membership re-checked on join)  |
|             ├─ user:<id> personal rooms (targeted invitation events) |
|             └─ in-memory presence, model stream fan-out              |
+----------------------------------+-----------------------------------+
                                   |
+----------------------------------v-----------------------------------+
|                              MongoDB                                 |
|  users · workspaces · conversations · messages · claims · relations   |
|  invitations · evidence · decisions · timeline events · audit logs    |
+----------------------------------------------------------------------+
```

Notable architectural decisions:

- **One server, one port.** Socket.IO attaches to the same `http.Server` as Express. In development `npm run dev` runs `tsx server.ts`, which mounts Vite in middleware mode — so the client, API and sockets all share `http://localhost:3000` with **no proxy configuration**.
- **Server-authored counts.** Evidence counts per claim are computed by the server and delivered both with the claims fetch and on every socket add/delete — the client never increments, so a local action and its socket echo can't double-count.
- **Terminal-state-only reconciliation.** While a model is still streaming, its stored document is empty — so the stream watchdog only overwrites a card when the server reports a *terminal* status, and otherwise re-arms the quiet window and lets live chunks keep coming.

---

## 🚀 Getting started

**Prerequisites:** Node 22+ and a MongoDB instance (Atlas free tier is fine).

```bash
# 1. Clone
git clone https://github.com/preranabothra9-afk/MindSync.git
cd MindSync/synapseai-realtime-platform

# 2. Install
npm install

# 3. Configure
cp .env.example .env
#   → set GEMINI_API_KEY and GROQ_API_KEY (both free, no credit card)
#   → set MONGODB_URI, or leave it blank for local JSON persistence
#   → set the ADMIN_* seed credentials

# 4. Run (dev)
npm run dev
```

Open `http://localhost:3000`. Sign up, verify via the emailed link (or the link printed in the server console when no mail provider is configured), and sign in with the seeded admin (`admin@synapse.ai` / `Password@123` by default).

| Script | What it does |
|---|---|
| `npm run dev` | `tsx server.ts` — Express + Vite middleware + sockets, with HMR on the client |
| `npm run build` | `vite build` (client) **and** `esbuild` (server → `dist/server.cjs`) in one command |
| `npm run start` | Runs the production server bundle |
| `npm run lint` | `tsc --noEmit` — the type-check gate |
| `npm test` | Node test runner over `server/*.test.ts` (83 tests) |

> **Note:** `npm run dev` has no file watcher on the server — backend changes need a manual restart. The client hot-reloads.

---

## 🔐 Environment variables

Full documentation is in `.env.example`. The essentials:

**AI providers** — every model is gated on its own key; a missing key degrades only that model's card.

| Variable | Unlocks |
|---|---|
| `GEMINI_API_KEY` | Gemini 2.5 Flash ([Google AI Studio](https://aistudio.google.com/apikey), free) |
| `GROQ_API_KEY` | GPT-OSS 120B, GPT-OSS 20B, Qwen3.8 27B ([Groq](https://console.groq.com/keys), free 30 RPM) |
| `MISTRAL_API_KEY` | Mistral Small (optional) |
| `NVIDIA_API_KEY` | DeepSeek R1 (optional) |

**Core**

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas or local MongoDB. Blank → local JSON persistence mode |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_SECRET` | Token signing (fallback chains: access/refresh secret → `JWT_SECRET`) |
| `CLIENT_URL` | CORS origin |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | The startup admin seeder |

**Email** (all optional) — providers tried in order: **Brevo SMTP → Resend API → Gmail SMTP**. With none configured the app runs in **"no mail" mode**: verification and reset links are returned in the API response and printed to the server console, so the flows are still testable end to end.

| Variable | Purpose |
|---|---|
| `BREVO_USER` / `BREVO_PASS` / `BREVO_HOST` / `BREVO_PORT` | Brevo SMTP relay (recommended; port 2525 sidesteps cloud SMTP egress blocks) |
| `MAIL_FROM_ADDRESS` | **Required for Brevo** — the `…@smtp-brevo.com` login is not a valid sender |
| `RESEND_API_KEY` / `RESEND_FROM` | Resend over plain HTTPS |
| `SMTP_USER` / `SMTP_PASS` | Gmail fallback (use an App Password, not your account password) |
| `MAIL_FROM_NAME` / `APP_URL` | Display name and the base URL links point at |

---

## 🔑 Auth, verification & sessions

**Dual tokens, rotated**

| Token | Lifetime | Stored |
|---|---|---|
| Access | **15 min** | in-memory Zustand only — never localStorage, never a cookie |
| Refresh | **7 days** | `HttpOnly` cookie; `secure` tracks the request scheme, `sameSite` none/lax |

Refresh rotation is reuse-detecting: a presented refresh token that doesn't match the stored one **nulls every stored refresh token for that user and clears the cookie**, killing all other sessions. On the client, `secureFetch` transparently rotates on a 401 and retries the original request — so an expired access token is invisible to the user.

**Email verification**
- Registering creates an **unverified** account and mints a token: 32 random bytes, **SHA-256 hashed** server-side (the raw token never touches the database), valid for **24 hours**.
- Signup lands on a **"verify your email"** screen; the deep link activates on open and **auto-redirects to login** after a short confirmation.
- Unverified users are blocked at login with **403 + a fresh re-issued link**, so a stale link can never dead-end an account. The notice persists across refresh and navigation.
- Verification is the law on the write surface too: workspace-mutating routes sit behind a second `requireVerifiedAuth` gate, because tokens outlive verification.

**Password reset** — same token engineering, **1-hour** lifetime, always-200 response (never reveals whether an address is registered).

**Sequencing matters:** registration does *not* flip the loading spinner into a session — the account must be confirmed first, so the auth portal unmounts and remounts cleanly rather than leaving a half-logged-in UI.

**Socket handshakes** verify the access JWT and drop the socket into a personal `user:<id>` room, which is how invitation events reach exactly one recipient.

---

## 👥 Workspaces, invitations & leaving

**Workspaces** are the tenancy boundary. `memberIds` **includes the owner**, so its length is the true headcount. Every workspace is created with one default channel, **🛰️ Central Brainstorm**. Membership is checked on every route *and* re-checked when a socket tries to join a room — a conversation id is treated as a bearer secret, so a room's history requires belonging to its workspace.

**Admins see every workspace** for oversight; everyone else sees only what they own or belong to. Left workspaces stay visible to an admin, badged **Left** with a disabled **Enter** — rejoining is by invitation only.

### Invitations are requests, not additions

```text
owner invites you ──▶ invitation doc (status: pending)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
   you ACCEPT                           you DECLINE
   → status: accepted                   → status: rejected
   → your id pushed into memberIds      → rejection tally for this
     (de-duped against double-taps)       (workspace, you) increments
                                          → 5 declines and this workspace
                                             can never invite you again
```

- The cap is `MAX_INVITATION_REJECTIONS = 5`, **per workspace per invitee** — rejecting the "Design Review" room five times says nothing about "Q3 Planning".
- Rejections are **never deleted**; the tally is a live `countDocuments` over rejected documents, so it survives re-invites and is fully auditable. Each declined re-invite counts.
- Inviting an unknown email **auto-registers** an unverified account with a password nobody knows, so it can only be entered after the mailbox is verified and a password is set via reset.
- The whole flow is targeted: the invitee gets an `invitation-received` event on their personal `user:<id>` room, and the pending section of their workspace hub is where they decide.

### Leaving

| Caller is a… | What happens |
|---|---|
| **Member** | Removed from the roster immediately |
| **Owner with collaborators** | **409 `requiresTransfer`** + a `candidates` list; re-issue the call with `newOwnerId` and the transfer + leave happen in **one request** |
| **Sole owner** | **409 `soleOwner`** — transfer to a collaborator first, or delete the workspace |

The backend returns both 409 shapes deliberately, so the UI can present a successor picker rather than a bare error string.

---

## 📡 Realtime engine

Socket.IO attached to the same HTTP server, with room isolation by workspace.

**Presence is in-memory and deduped by user id** — three tabs is one presence row. The sidebar roster **merges presence onto the full member directory**, because presence only knows about live sockets; without the merge, people would vanish from the list the moment they went offline. Online members sort first; roster order is preserved within each group so the owner stays where the member list put them. A presence row with no directory entry is still shown — someone in the room is someone in the room.

**Reliability is built in, not bolted on:**

- **Stream watchdog** — a dropped socket can take a stream's terminal event with it, leaving a card frozen mid-sentence forever while the finished text sits in the database. The watchdog tracks a heartbeat per `(messageId, modelKey)`, and any card still `streaming` that has been quiet past `STREAM_STALL_MS` (20s) is re-read from the server on an 8s interval and after every reconnect. It only applies a **terminal** server state — a still-`streaming` server row is proof the stream is alive, so the quiet window is re-armed and the live chunks are left untouched. Reconciliation turns "stuck forever, refresh to see it" into self-healing.
- **Transparent reconnection** — auth errors rotate the token and reconnect with backoff, capped separately for dead sessions (5) versus transient backend trouble (20) so a backend outage never burns your session budget.
- **Startup reaping** — `reapInterruptedStreams()` on boot clears any row left mid-flight by a killed process.
- **Idempotency everywhere it matters** — double-accepts, re-approves, duplicate socket echoes and double-leave are all no-ops by construction.

---

## 🤖 AI models & streaming

Seven models are registered in `AI_MODELS` (`server/ai.ts`), spanning four labs and two transport styles. The default comparison set — `['gemini-2.5-flash', 'gpt-oss-120b', 'qwen3.8-27b']` — runs on **two free keys**:

| Model | Provider | Transport | Gated by | Free tier |
|---|---|---|---|---|
| **Gemini 2.5 Flash** | Google | native SDK streaming | `GEMINI_API_KEY` | Yes |
| **GPT-OSS 120B** | Groq | OpenAI-compat SSE | `GROQ_API_KEY` | 30 RPM |
| **Qwen3.8 27B** | Groq | OpenAI-compat SSE | `GROQ_API_KEY` | 30 RPM |
| GPT-OSS 20B | Groq | OpenAI-compat SSE | `GROQ_API_KEY` | 30 RPM |
| Llama 3.3 70B | Groq | OpenAI-compat SSE | `GROQ_API_KEY` | Paid plan |
| Mistral Small | Mistral | OpenAI-compat SSE | `MISTRAL_API_KEY` | Experiment tier |
| DeepSeek R1 | NVIDIA | OpenAI-compat SSE | `NVIDIA_API_KEY` | 40 RPM |

**Streaming** fans out per model: each card receives its own chunk stream and terminal event, so one model's failure never stalls the others. The chat path fans out chunks as they arrive.

**Resilience, per transport:**
- **Gemini** — a model cascade (`gemini-2.5-flash` → `gemini-3.1-flash-lite` → `gemini-flash-latest`, ordered by measured time-to-first-token), one retry with backoff on transient 429/503s, and a clearly-labelled offline fallback when the whole cascade is down.
- **OpenAI-compatible** — a 120s abort timeout so a stalled upstream can't hang a card forever, and immediate honest failure otherwise.

The strict counterpart used for anything the room treats as a **record** (decision summaries) **never** falls back to the offline generator — a fabricated paragraph is fine for a chat reply, but indistinguishable from a real one in a summary. It returns `null` instead.

**Grounding:** Gemini 2.5 Flash answers with Google Search enabled, so current facts come from the live web rather than frozen training data.

**Context engineering.** Every prompt is composed server-side from the room's own record — recent messages, relevance-ranked established claims (each attributed to its source model), decision memory, and a rules header that forbids invention and treats quoted history as the only source of truth. This is what gives the room cross-model persistent memory: a claim mined from model A on turn 1 is injected into the context models B, C and D all receive on turn 2.

---

## 📊 Admin & telemetry

Two admin surfaces: a **full-screen panel** (diagnostic console, collaborator accounts, workspaces, AI telemetry, audit, health) and a **routed `/admin` section** with its own layout.

- **Dashboards** — DAU, total workspaces, AI queries today, core response latency, plus Recharts visualizations for daily AI usage, user growth, workspace activity and model popularity.
- **User management** — search, role and verification filters, paginated. Block / unblock (emitting `session-revoked` to boot the user's live sockets), role elevation, manual email verification (burning any outstanding token), hard delete. Self-blocking and self-deletion are refused.
- **Workspace oversight** — every workspace with owner, member / channel / saved counts, and global deletion.
- **Audit logs** — every auth event, role change, block, workspace and decision lifecycle action, with IP tracking and an action filter.
- **AI telemetry** — the `/admin/ai-models` endpoint reports each registered model's provider, transport, the *name* of the env var it needs (never the key), its free tier and whether it is currently configured.

---

## 🎨 Brand & theming

MindSync's mark is a **synapse node graph**: a central hub broadcasting spokes to six unequal satellites, linked to each other by a ring — the room's center of gravity and the network around it, drawn in an indigo gradient.

The palette is **indigo / violet on slate**, with three full themes switchable live (and persisted in `localStorage` under `mindsync-theme`, with a one-way read of the legacy `collabz-theme` key so returning users keep their choice through the rebrand):

| Theme | Character | Accent |
|---|---|---|
| **Linen** (light) | Cool paper, bright surfaces | Indigo `#4f46e5` |
| **Obsidian** (dark) | Near-black slate, crisp text | Periwinkle `#818cf8` |
| **Nebula** | Deep violet dusk, soft glow | Violet `#a78bfa` |

Themes are pure CSS custom properties — `:root.dark` and `:root.nebula` override the base tokens by specificity, so any utility referencing `var(--color-*)` flips automatically. All text/surface pairs are tuned to **WCAG AA** contrast or better, including a `--color-on-ember` flip from white to dark indigo on the accent in dark themes. The pre-React loading screen in `index.html` reads the theme key before paint, so there is no flash of the wrong mode.

---

## 🛡️ Security

- **JWT** access (15 min) + rotating refresh (7 d) with reuse detection that revokes every session.
- **Access token in memory only**; refresh in an `HttpOnly` cookie whose `secure` flag tracks the real request scheme (`trust proxy` is set, so it works behind load balancers and doesn't break on localhost).
- **HttpOnly cookies** keep the refresh token out of reach of XSS.
- **Email verification** before first login, with a second gate on the workspace write surface.
- **Password hashing** with bcrypt (salt rounds 10) everywhere a password is set.
- **Helmet** headers; **rate limiting** — a global limiter (3000 / 15 min) and a stricter auth limiter (100 / 15 min) on login and register.
- **Zod** validation on every request body; conversation ids are scoped to workspace membership so a leaked id grants nothing.
- **RBAC** — `requireAuth`, `requireVerifiedAuth`, `requireRole('admin')` and `adminOnly` middleware; socket handshakes verify the JWT and re-check membership before a socket may join a workspace room.
- **Separate JWT secrets** for access and refresh, so a leaked access secret cannot forge refresh tokens.
- **Keys never reach the browser** — the admin model report exposes only the *name* of each env var.

---

## 🧪 Testing

```bash
npm test     # 83 tests, Node's built-in runner over server/*.test.ts
npm run lint # tsc --noEmit — the type-check gate
```

The suite pins the contracts that are easy to regress:

- **Evidence gate** — blocker kinds, the AI-evidence exclusion, and that a direct API call skipping the UI is refused identically (`decisionContext.test.ts`).
- **Invitations** — that rejections accumulate **per workspace**, that a cross-workspace rejection does not count, and that the cap drives the invite refusal (`invitation.test.ts`).
- **Workspace leave** — the owner-transfer + leave write, sole-owner handling, and that re-leaving is stable (`workspaceLeave.test.ts`).
- **Evidence adapter** — newest-first ordering, batched multi-claim reads, per-claim count tallies, room scoping and cleanup contracts (`evidence.db.test.ts`, `evidence.test.ts`).
- **Auth & mail** — validators, the mailer provider chain and the no-mail fallback (`validators.test.ts`, `mailer.test.ts`).
- **Context** — room-context composition (`context.test.ts`).

---

## 🚢 Deployment

The build produces both artifacts in one command — the client bundle via Vite and the server via esbuild to `dist/server.cjs`.

**Render / Railway (or any Node host)**

1. Connect the repo. Set the runtime to **Node 22**.
2. **Build command:** `npm run build` · **Start command:** `npm run start`
3. Set environment variables — at minimum `MONGODB_URI`, the `JWT_*` secrets, `CLIENT_URL`, your model keys, and `ADMIN_*`. For email, add the `BREVO_*` (plus a verified `MAIL_FROM_ADDRESS`) or `RESEND_*` block.
4. Ensure the host allows outbound SMTP (port 2525) if using Brevo — many cloud hosts block 465/587, which is exactly why Brevo's relay port is the default.

**MongoDB Atlas** — free M0 tier is sufficient. Add a database user, whitelist the host's egress IPs (or `0.0.0.0/0` for dynamic cloud hosts), and put the connection string in `MONGODB_URI`.

**Static client** — not required. The server serves the built client itself with an SPA fallback, so a single service hosts everything. To split it, point a CDN at `dist/` and set `CLIENT_URL` to its origin.

**Production checklist:** `NODE_ENV=production` · `CLIENT_URL` = your frontend origin · HTTPS/WSS end to end (required for the `Secure` + `SameSite=None` refresh cookie) · rotate the default `JWT_*` secrets · confirm your Brevo sender address is verified.

---

## 🗺️ Roadmap

- [ ] **Redis adapter** — sync socket rooms across multiple backend nodes behind a load balancer.
- [ ] **More providers** — OpenAI and Anthropic native APIs.
- [ ] **Vector search** — semantic retrieval over saved responses and evidence.
- [ ] **Organizations** — multi-team directories and domain-based access.
- [ ] **Usage billing** — tiered plans and per-workspace quotas.

---

## 📄 License

Distributed under the [MIT License](./LICENSE) · Copyright © 2026
