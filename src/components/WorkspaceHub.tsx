import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  LayoutGrid, Plus, LogOut, Users, ArrowRight, RefreshCw,
  Sparkles, Search, Crown, FolderOpen, ShieldCheck, Home,
  Check, X, Loader2, Mail
} from 'lucide-react';
import ThemeSwitcher from './ThemeSwitcher';

type HubTab = 'enter' | 'create';

export default function WorkspaceHub() {
  const {
    user, workspaces, activeWorkspace, setActiveWorkspace,
    createWorkspace, fetchWorkspaces, logout, navigateTo,
    pendingInvitations, fetchPendingInvitations, respondToInvitation
  } = useStore();

  const [tab, setTab] = useState<HubTab>('enter');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One decision in flight at a time, and the outcome message for the card the
  // user just answered — success sits on the card, not a global toast, because
  // it is specific to that invitation.
  const [busyInvite, setBusyInvite] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState<{ id: string; kind: 'ok' | 'err'; text: string } | null>(null);

  // Leaving a workspace you own needs a successor, so the owner flow is a
  // two-step: this holds the workspace being left while they pick one.
  const [leaving, setLeaving] = useState<{ wsId: string; candidates: { id: string; name: string; email: string; avatar: string }[] } | null>(null);
  const [pickedSuccessor, setPickedSuccessor] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  const { leaveWorkspace } = useStore();

  // Load the directory on mount without auto-entering a workspace.
  useEffect(() => {
    fetchWorkspaces({ autoEnter: false });
    fetchPendingInvitations();
  }, [fetchWorkspaces, fetchPendingInvitations]);

  // `memberIds` includes the owner, so its length is the true headcount.
  const totalSeats = useMemo(
    () => workspaces.reduce((sum, ws) => sum + (ws.memberIds?.length || 0), 0),
    [workspaces]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter(
      (ws) =>
        ws.name.toLowerCase().includes(q) ||
        (ws.description || '').toLowerCase().includes(q)
    );
  }, [workspaces, search]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchWorkspaces({ autoEnter: false });
    setIsRefreshing(false);
  };

  // Entering is an explicit choice: activate the workspace, then leave the hub.
  const handleEnter = (ws: (typeof workspaces)[number]) => {
    setActiveWorkspace(ws);
    navigateTo('/workspace');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    setError(null);

    const created = await createWorkspace(trimmed, description.trim());
    if (!created) {
      setError('Could not create the workspace. Please try again.');
      setIsCreating(false);
      return;
    }

    setName('');
    setDescription('');
    setIsCreating(false);
    // Stay on the hub so the new room is visible in the list; the user
    // chooses when to enter it.
    setTab('enter');
  };

  // Leaving is the member's exit; an owner must first hand the room to one of
  // its other members. The backend tells us which case applies and who can take
  // over, so this stays a single confirm-then-go interaction.
  const handleLeave = async (wsId: string) => {
    setLeaveError(null);
    setIsLeaving(true);
    const result = await leaveWorkspace(wsId, pickedSuccessor || undefined);
    setIsLeaving(false);

    if (result.success) {
      setLeaving(null);
      setPickedSuccessor(null);
      return;
    }

    if (result.soleOwner) {
      // Nobody to hand the room to: leaving would orphan it. Tell the owner
      // plainly rather than silently blocking the button.
      setLeaveError(result.error);
      return;
    }

    if (result.requiresTransfer) {
      // First refusal from the backend: it wants a successor. Stage the
      // candidates and let the user pick before trying again.
      const ws = workspaces.find((w) => w.id === wsId);
      setLeaving({ wsId, candidates: result.candidates });
      setPickedSuccessor(result.candidates[0]?.id ?? null);
      setLeaveError(null);
      return;
    }

    setLeaveError(result.error);
  };

  const firstName = (user?.name || 'there').split(' ')[0];
  const isAdmin = user?.role === 'admin';

  // Accepting joins the workspace immediately; rejecting closes the request and
  // counts the decline toward the five-decline cap on that workspace.
  const handleRespond = async (invitationId: string, response: 'accept' | 'reject') => {
    if (busyInvite) return;
    setBusyInvite(invitationId);
    setInviteNote(null);
    const result = await respondToInvitation(invitationId, response);
    setBusyInvite(null);
    if (result.success) {
      setInviteNote({
        id: invitationId,
        kind: 'ok',
        // A rejection reports how many declines remain so the consequence is
        // visible before the next one is irreversible.
        text: response === 'accept'
          ? 'You have joined the workspace.'
          : `Invitation declined.${result.blocked ? ' You can no longer be invited to this workspace.' : ` ${result.remaining ?? 0} decline${(result.remaining ?? 0) === 1 ? '' : 's'} left before this workspace stops inviting you.`}`,
      });
    } else {
      setInviteNote({ id: invitationId, kind: 'err', text: result.message });
    }
  };

  return (
    <div className="min-h-screen bg-ink text-cream font-sans relative overflow-hidden grain">
      {/* Ambient background: one soft warm wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(48rem 34rem at 8% -6%, color-mix(in srgb, var(--color-ember) 8%, transparent), transparent 62%),' +
            'radial-gradient(38rem 28rem at 96% 104%, color-mix(in srgb, var(--color-ember-soft) 7%, transparent), transparent 60%)',
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
        {/* -- Top bar --------------------------------------------------- */}
        <header className="flex items-center justify-between gap-4 mb-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-ember to-ember-2 flex items-center justify-center text-on-ember font-bold text-sm shadow-lg shadow-ember/25">
              {(user?.name || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-mono uppercase tracking-[0.18em] text-faint font-bold">Workspace Hub</p>
              <p className="text-sm text-cream font-semibold">Welcome back, {firstName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* The hub is the post-login landing page and used to be a dead
                end: there was no way back to the public site without signing
                out first. `/home` renders the landing page for signed-in users
                too, so this is a plain round trip rather than a logout. */}
            <button
              onClick={() => navigateTo('/home')}
              title="Back to the home page"
              className="px-3.5 py-2.5 rounded-xl bg-panel/80 border border-line/60 text-sand hover:text-cream hover:border-line-2 transition-all cursor-pointer flex items-center gap-1.5 text-[14px] font-semibold"
            >
              <Home size={13} />
              <span className="hidden sm:inline">Home</span>
            </button>
            <ThemeSwitcher variant="panel" />
            {isAdmin && (
              <button
                onClick={() => navigateTo('/admin/dashboard')}
                className="px-3.5 py-2.5 rounded-xl bg-ember/10 border border-ember/25 text-ember-soft hover:bg-ember/20 transition-all cursor-pointer flex items-center gap-1.5 text-[14px] font-bold"
              >
                <ShieldCheck size={13} />
                <span className="hidden sm:inline">Admin panel</span>
                <span className="sm:hidden">Admin</span>
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh directory"
              className="p-2.5 rounded-xl bg-panel/80 border border-line/60 text-sand hover:text-cream hover:border-line-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={logout}
              className="px-3.5 py-2.5 rounded-xl bg-panel/80 border border-line/60 text-sand hover:text-rust hover:border-rose-500/30 transition-all cursor-pointer flex items-center gap-1.5 text-[14px] font-semibold"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        {/* -- Heading --------------------------------------------------- */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-cream">
            Choose where you want to <span className="text-ember">work</span>
          </h1>
          <p className="text-[13px] text-sand font-mono mt-2.5 max-w-xl leading-relaxed">
            Pick an existing workspace or spin up a new one. Nothing loads into a
            room until you choose it.
          </p>
        </div>

        {/* -- Stat strip ------------------------------------------------ */}
        <div className="grid grid-cols-2 gap-4 mb-8 max-w-md">
          <StatCard
            icon={<FolderOpen size={15} />}
            label="Workspaces"
            value={workspaces.length}
            accent="text-ember"
            bg="bg-ember/10"
            border="border-ember/20"
          />
          <StatCard
            icon={<Users size={15} />}
            label="Seats held"
            value={totalSeats}
            accent="text-leaf"
            bg="bg-leaf/10"
            border="border-leaf/20"
          />
        </div>

        {/* -- Admin entry ---------------------------------------------- */}
        {isAdmin && (
          <button
            onClick={() => navigateTo('/admin/dashboard')}
            className="group w-full text-left bg-gradient-to-br from-ember/12 to-ember/[0.03] border border-ember/25 rounded-2xl p-5 mb-8 hover:border-ember/45 hover:from-ember/20 transition-all duration-200 cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-ember/20 border border-ember/30 text-ember flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <ShieldCheck size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-cream">Admin panel</p>
                <p className="text-[14px] text-sand font-mono mt-0.5">
                  Manage users, workspaces, analytics and audit logs
                </p>
              </div>
              <ArrowRight size={16} className="text-ember shrink-0 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        )}

        {/* -- Pending invitations ---------------------------------------- */}
        {/* Invitations land here as requests: the recipient decides, and the
            workspace only appears in the directory below once they accept. */}
        {pendingInvitations.length > 0 && (
          <section className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <Mail size={14} className="text-ember" />
              <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-faint font-bold">
                Pending invitations
              </h2>
              <span className="px-1.5 py-0.5 rounded-md font-mono text-[12px] font-bold bg-ember/10 text-ember border border-ember/20">
                {pendingInvitations.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {pendingInvitations.map((inv) => {
                const isBusy = busyInvite === inv.id;
                const note = inviteNote?.id === inv.id ? inviteNote : null;
                return (
                  <div
                    key={inv.id}
                    className="bg-panel/80 border border-ember/25 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-ember/20 to-ember/5 border border-ember/20 text-ember font-bold text-sm flex items-center justify-center shrink-0">
                        {inv.workspaceName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-cream truncate">{inv.workspaceName}</p>
                        <p className="text-[13px] text-faint truncate">
                          Invited by <span className="text-sand font-medium">{inv.inviterName}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRespond(inv.id, 'reject')}
                        disabled={isBusy}
                        className="px-3.5 py-2 rounded-xl text-[13px] font-semibold text-sand bg-panel-2 hover:bg-line border border-line disabled:opacity-50 disabled:cursor-wait transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <X size={12} /> Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespond(inv.id, 'accept')}
                        disabled={isBusy}
                        className="px-3.5 py-2 rounded-xl bg-ember hover:bg-ember-2 text-on-ember text-[13px] font-bold disabled:opacity-50 disabled:cursor-wait transition-colors shadow-lg shadow-ember/20 cursor-pointer flex items-center gap-1.5"
                      >
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Accept
                      </button>
                    </div>

                    {note && (
                      <div
                        className={`text-[12px] flex items-center gap-1.5 ${
                          note.kind === 'ok' ? 'text-leaf' : 'text-rust'
                        }`}
                      >
                        {note.kind === 'ok' ? <Check size={11} /> : <X size={11} />}
                        <span>{note.text}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* -- Action tabs ----------------------------------------------- */}
        <div className="inline-flex items-center gap-1 p-1.5 rounded-2xl bg-panel/80 border border-line/60 mb-7">
          <TabButton
            active={tab === 'enter'}
            onClick={() => setTab('enter')}
            icon={<LayoutGrid size={13} />}
            label="Enter a workspace"
            count={workspaces.length}
          />
          <TabButton
            active={tab === 'create'}
            onClick={() => setTab('create')}
            icon={<Plus size={13} />}
            label="Create workspace"
          />
        </div>

        {/* -- Panel ----------------------------------------------------- */}
        {tab === 'enter' ? (
          <section>
            {workspaces.length > 4 && (
              <div className="relative mb-5 max-w-sm">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter workspaces..."
                  className="w-full bg-panel/80 border border-line/60 rounded-xl py-2.5 pl-10 pr-3 text-[13px] text-cream placeholder-faint focus:outline-none focus:border-ember/50 focus:ring-2 focus:ring-ember/10 transition-all"
                />
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              </div>
            )}

            {workspaces.length === 0 ? (
              <EmptyState onCreate={() => setTab('create')} />
            ) : visible.length === 0 ? (
              <p className="text-[13px] text-faint italic py-10 text-center">No workspace matches &ldquo;{search}&rdquo;.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visible.map((ws) => {
                  const members = ws.memberIds?.length || 0;
                  const isOwner = ws.ownerId === user?.id;
                  const isCurrent = activeWorkspace?.id === ws.id;
                  // Leaving is only meaningful if you are actually in the room.
                  // An admin sees every workspace regardless of membership, so
                  // gating on memberIds keeps a "Leave" button from appearing on
                  // a room the admin already left — where it could only error.
                  const isMember = (ws.memberIds || []).includes(user?.id);

                  return (
                    <article
                      key={ws.id}
                      className="group bg-panel/80 border border-line/60 rounded-2xl p-5 flex flex-col hover:border-ember/35 hover:bg-panel transition-all duration-200"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3.5">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-ember/20 to-ember/5 border border-ember/20 text-ember font-bold text-sm flex items-center justify-center shrink-0">
                          {ws.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {isOwner && (
                            <span className="px-2 py-0.5 rounded-md font-mono text-[13px] font-bold uppercase bg-amber-500/10 text-warn border border-amber-500/20 flex items-center gap-1">
                              <Crown size={9} /> Owner
                            </span>
                          )}
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-md font-mono text-[13px] font-bold uppercase bg-ember/10 text-ember border border-ember/20">
                              Active
                            </span>
                          )}
                          {!isMember && !isOwner && (
                            <span className="px-2 py-0.5 rounded-md font-mono text-[13px] font-bold uppercase bg-faint/10 text-faint border border-faint/20 flex items-center gap-1">
                              <LogOut size={9} /> Left
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className="text-sm font-bold text-cream mb-1.5 truncate">{ws.name}</h3>
                      <p className="text-[14px] text-sand leading-relaxed line-clamp-2 flex-1 mb-4">
                        {ws.description || 'No description provided.'}
                      </p>

                      <div className="flex items-center justify-between pt-3.5 border-t border-line/50">
                        <span className="flex items-center gap-1.5 font-mono text-[13px] text-faint font-semibold">
                          <Users size={11} />
                          {members} {members === 1 ? 'person' : 'people'}
                        </span>

                        <div className="flex items-center gap-2">
                          {isMember && isOwner && members > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setLeaving({ wsId: ws.id, candidates: [] });
                                setPickedSuccessor(null);
                                setLeaveError(null);
                                // Ask the backend who can take over; it returns
                                // the eligible members for the transfer dialog.
                                leaveWorkspace(ws.id).then((r) => {
                                  if (r.requiresTransfer) {
                                    setLeaving({ wsId: ws.id, candidates: r.candidates });
                                    setPickedSuccessor(r.candidates[0]?.id ?? null);
                                  } else if (!r.success) {
                                    setLeaveError(r.error);
                                    setLeaving(null);
                                  } else {
                                    setLeaving(null);
                                  }
                                });
                              }}
                              className="px-2.5 py-1.5 rounded-xl text-[13px] font-semibold text-sand hover:text-rust border border-line hover:border-rust/40 transition-all cursor-pointer flex items-center gap-1"
                              title="Leave this workspace (transfers ownership first)"
                            >
                              Leave
                            </button>
                          )}
                          {!isOwner && isMember && (
                            <button
                              type="button"
                              onClick={() => setLeaving({ wsId: ws.id, candidates: [] })}
                              className="px-2.5 py-1.5 rounded-xl text-[13px] font-semibold text-sand hover:text-rust border border-line hover:border-rust/40 transition-all cursor-pointer flex items-center gap-1"
                              title="Leave this workspace"
                            >
                              Leave
                            </button>
                          )}
                          <button
                            onClick={() => handleEnter(ws)}
                            disabled={!isMember}
                            title={!isMember ? 'You have left this workspace and can only rejoin by invitation.' : undefined}
                            className={`px-3 py-1.5 rounded-xl text-[13px] font-bold transition-all flex items-center gap-1 shadow-lg shadow-ember/20 btn-3d ${!isMember ? 'bg-panel-2 border border-line/60 text-faint cursor-not-allowed opacity-60' : 'bg-ember hover:bg-ember-2 text-on-ember cursor-pointer'}`}
                          >
                            Enter
                            <ArrowRight size={11} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="bg-panel/80 border border-line/60 rounded-2xl p-6 sm:p-7 max-w-xl">
            <div className="flex items-center gap-2.5 mb-1.5">
              <Sparkles size={15} className="text-ember" />
              <h2 className="text-sm font-bold text-cream">New workspace</h2>
            </div>
            <p className="text-[14px] text-sand font-mono mb-6">
              You'll be the owner, and the first member.
            </p>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-[13px] font-mono font-bold uppercase tracking-widest text-faint mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null); }}
                  placeholder="e.g. Product Strategy"
                  maxLength={60}
                  required
                  className="w-full bg-ink/50 border border-line/60 rounded-xl px-3.5 py-2.5 text-[13px] text-cream placeholder-faint focus:outline-none focus:border-ember/50 focus:ring-2 focus:ring-ember/10 transition-all"
                />
              </div>

              <div>
                <label className="block text-[13px] font-mono font-bold uppercase tracking-widest text-faint mb-2">
                  Description <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this room for?"
                  rows={3}
                  maxLength={280}
                  className="w-full bg-ink/50 border border-line/60 rounded-xl px-3.5 py-2.5 text-[13px] text-cream placeholder-faint focus:outline-none focus:border-ember/50 focus:ring-2 focus:ring-ember/10 transition-all resize-none"
                />
              </div>

              {error && (
                <p className="text-[14px] text-rust bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={isCreating || !name.trim()}
                  className="px-5 py-2.5 bg-ember hover:bg-ember-2 text-on-ember text-[13px] font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ember/20 btn-3d"
                >
                  {isCreating ? (
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  ) : (
                    <Plus size={13} />
                  )}
                  {isCreating ? 'Creating...' : 'Create workspace'}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('enter')}
                  className="px-4 py-2.5 text-faint hover:text-cream text-[13px] font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}
      </div>

      {/* -- Leave / transfer dialog -------------------------------------- */}
      {leaving && (
        <div className="fixed inset-0 modal-scrim z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-panel border border-line-2 p-5 rounded-2xl shadow-2xl relative animate-fadeInScale">
            <button
              type="button"
              onClick={() => { setLeaving(null); setPickedSuccessor(null); setLeaveError(null); }}
              className="absolute right-3 top-3 text-faint hover:text-cream cursor-pointer"
            >
              <X size={15} />
            </button>

            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-rust/10 text-rust flex items-center justify-center border border-rust/20 shrink-0">
                <LogOut size={16} />
              </div>
              <h3 className="font-semibold text-cream text-sm">Leave workspace?</h3>
            </div>

            {leaving.candidates.length === 0 ? (
              <p className="text-[13px] text-sand leading-relaxed mb-4">
                Leave <span className="text-cream font-medium">"{workspaces.find((w) => w.id === leaving.wsId)?.name}"</span>?
                You will lose access to its rooms and history.
              </p>
            ) : (
              <>
                <p className="text-[13px] text-sand leading-relaxed mb-3">
                  You own <span className="text-cream font-medium">"{workspaces.find((w) => w.id === leaving.wsId)?.name}"</span>.
                  Pick a collaborator to take over ownership before you leave.
                </p>
                <div className="space-y-1.5 mb-4 max-h-52 overflow-y-auto">
                  {leaving.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPickedSuccessor(c.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                        pickedSuccessor === c.id
                          ? 'bg-ember/10 border-ember/40'
                          : 'bg-panel-2/50 border-line/60 hover:border-line-2'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-ember to-ember-2 text-on-ember font-bold flex items-center justify-center text-[12px] shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-cream truncate">{c.name}</p>
                        <p className="text-[12px] text-faint truncate">{c.email}</p>
                      </div>
                      {pickedSuccessor === c.id && <Check size={14} className="text-ember shrink-0" />}
                    </button>
                  ))}
                </div>
              </>
            )}

            {leaveError && (
              <p className="text-[13px] text-rust bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 mb-3">
                {leaveError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setLeaving(null); setPickedSuccessor(null); setLeaveError(null); }}
                className="flex-1 py-2 bg-panel-2 hover:bg-line text-sand text-[13px] font-medium rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLeaving || (leaving.candidates.length > 0 && !pickedSuccessor)}
                onClick={() => handleLeave(leaving.wsId)}
                className="flex-1 py-2 bg-rust hover:bg-rust/85 text-white text-[13px] font-medium rounded-xl transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLeaving ? 'Leaving…' : 'Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active, onClick, icon, label, count
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-xl text-[14px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
        active
          ? 'bg-ember text-on-ember shadow-lg shadow-ember/25'
          : 'text-sand hover:text-cream hover:bg-panel-2'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={`ml-0.5 px-1.5 py-0.5 rounded-md font-mono text-[13px] ${
            active ? 'bg-ember text-on-ember' : 'bg-panel-2 text-faint'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function StatCard({
  icon, label, value, accent, bg, border
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
  bg: string;
  border: string;
}) {
  return (
    <div className="bg-panel/80 border border-line/60 rounded-2xl p-4">
      <div className={`w-8 h-8 rounded-xl ${bg} ${border} border ${accent} flex items-center justify-center mb-2.5`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-cream leading-none">{value}</p>
      <p className="text-[13px] font-mono uppercase tracking-wider text-faint font-bold mt-1.5">{label}</p>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-panel/80 border border-line/60 rounded-2xl py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-ember/10 border border-ember/20 text-ember flex items-center justify-center mx-auto mb-4">
        <FolderOpen size={22} />
      </div>
      <h3 className="text-sm font-bold text-cream mb-1.5">No workspaces yet</h3>
      <p className="text-[14px] text-sand font-mono mb-6 max-w-sm mx-auto leading-relaxed">
        You're not in any rooms. Create the first one to start collaborating.
      </p>
      <button
        onClick={onCreate}
        className="px-5 py-2.5 bg-ember hover:bg-ember-2 text-on-ember text-[13px] font-bold rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-lg shadow-ember/20 btn-3d"
      >
        <Plus size={13} />
        Create your first workspace
      </button>
    </div>
  );
}
