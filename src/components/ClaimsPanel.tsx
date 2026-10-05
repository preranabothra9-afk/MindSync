import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { Sparkles, CornerDownRight, Trash2, Zap, ArrowLeft, Send, X, ScrollText } from 'lucide-react';
import type { Claim, DiscussionComment } from '../types';
import Portal from '../hooks/Portal';
import ContradictionDiscussion from './ContradictionDiscussion';
import EvidenceList from './EvidenceList';

const PANEL_WIDTH = 380;
const PANEL_MAX_HEIGHT = 460;

/**
 * Lists the durable claims extracted from this room's AI responses. Claims are
 * the room's persistent memory: they are mined from finished answers and fed
 * back into the next prompt's context so models stay consistent with the
 * ongoing discussion. Clicking a claim jumps to the message it came from.
 */
export default function ClaimsPanel() {
  // Selectors keep this from re-rendering on every stream chunk.
  const activeConversation = useStore((s) => s.activeConversation);
  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const user = useStore((s) => s.user);
  const claims = useStore((s) => s.claims);
  const relations = useStore((s) => s.relations);
  const jumpToMessage = useStore((s) => s.jumpToMessage);
  const deleteClaim = useStore((s) => s.deleteClaim);
  const clearClaims = useStore((s) => s.clearClaims);
  const addContradictionComment = useStore((s) => s.addContradictionComment);
  const [open, setOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** Id of the contradiction whose detail view is open; null shows the list. */
  const [detailId, setDetailId] = useState<string | null>(null);
  /** Id of the claim whose detail (evidence) view is open; null shows the list. */
  const [claimDetailId, setClaimDetailId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  /** Comment the composer is answering; null for a top-level comment. */
  const [replyTo, setReplyTo] = useState<DiscussionComment | null>(null);

  // Read from the store rather than stashing the object, so a close broadcast
  // updates the open view without the panel needing to refetch anything.
  const detail = relations.find((r) => r.id === detailId) ?? null;
  const claimDetail = claims.find((c) => c.id === claimDetailId) ?? null;

  const disabled = !activeConversation;
  const count = claims.length;
  const contradictions = relations.filter((r) => r.relationship === 'CONTRADICT');
  // The badge rings only for contradictions that still need a human decision.
  const openContradictions = contradictions.filter((r) => r.status === 'detected');
  // Workspace owner or admin may resolve/dismiss — the same authorization the
  // workspace's own deletion requires.
  const canResolve = !!activeWorkspace && !!user && (activeWorkspace.ownerId === user.id || user.role === 'admin');
  // Any member may attach evidence or join the discussion, matching the room's
  // participation rules.
  const canContribute =
    !!activeWorkspace &&
    !!user &&
    (activeWorkspace.ownerId === user.id || (activeWorkspace.memberIds || []).includes(user.id) || user.role === 'admin');

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    // Keep the whole panel inside the viewport — the detail view is taller than
    // the list, so anchor its bottom edge rather than letting it run past the
    // window when the button sits low on a short screen.
    const top = Math.min(r.bottom + 8, Math.max(12, window.innerHeight - PANEL_MAX_HEIGHT - 12));
    const left = Math.max(12, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 12));
    setPos({ top, left });
  }, [open]);

  // Close on Escape / resize
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setConfirmingClear(false); setDetailId(null); setClaimDetailId(null); setReplyTo(null); } };
    const onResize = () => { setOpen(false); setConfirmingClear(false); setDetailId(null); setClaimDetailId(null); setReplyTo(null); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const handlePick = (claim: Claim) => {
    setOpen(false);
    jumpToMessage(claim.messageId, claim.createdAt);
  };

  const handleDelete = (claim: Claim) => {
    deleteClaim(claim.id);
    if (claimDetailId === claim.id) setClaimDetailId(null);
    setConfirmingClear(false);
  };

  const handleClearAll = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    clearClaims();
    setConfirmingClear(false);
  };

  const handleCommentSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text || !detail) return;
    addContradictionComment(detail.id, text, replyTo?.id ?? null);
    setCommentText('');
    setReplyTo(null);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setConfirmingClear(false); setDetailId(null); setClaimDetailId(null); setReplyTo(null); }}
        disabled={disabled}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border bg-panel-2 border-line text-sand hover:text-cream hover:border-line-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        title={disabled ? 'Select a room to view claims' : 'Claims the AI has established in this room'}
      >
        <Sparkles size={13} />
        <span className="hidden sm:inline">Claims</span>
        {openContradictions.length > 0 && (
          <span
            className="inline-flex items-center gap-0.5 px-1 rounded-full bg-rust/20 border border-rust/50 text-rust text-[10px] font-mono font-bold leading-none"
            title={`${openContradictions.length} unresolved contradiction${openContradictions.length === 1 ? '' : 's'} need a human decision`}
          >
            <Zap size={9} />
            {openContradictions.length}
          </span>
        )}
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-ember/15 border border-ember/30 text-ember-soft text-[10px] font-mono font-bold leading-none">
            {count}
          </span>
        )}
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />

          <div
            className="fixed z-[160] bg-panel-2 border border-line-2 rounded-2xl shadow-2xl overflow-hidden animate-fadeIn flex flex-col"
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: 'min(60vh, 460px)' }}          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
              <Sparkles size={14} className="text-ember-soft shrink-0" />
              <p className="text-sm font-semibold text-cream">Room claims</p>
              <span className="ml-auto text-[10px] font-mono text-faint">{count}</span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  title={confirmingClear ? 'Click again to confirm clearing all claims' : 'Clear all claims in this room'}
                  className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                    confirmingClear
                      ? 'bg-rust/15 border-rust/40 text-rust'
                      : 'bg-transparent border-line/50 text-faint hover:text-rust hover:border-rust/40'
                  }`}
                >
                  <Trash2 size={10} />
                  {confirmingClear ? 'Confirm?' : 'Clear all'}
                </button>
              )}
            </div>

            {/* Everything below the header and above the footer scrolls as a
                single region. Without this, the contradictions section is a
                flex child with the default min-height:auto, so it refuses to
                shrink and crowds the claims out of the scrollable area. */}
            <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Contradiction graph edges */}
            {contradictions.length > 0 && !detail && !claimDetail && (
              <div className="border-b border-line">
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Zap size={12} className="text-rust shrink-0" />
                  <p className="text-[11px] font-bold uppercase tracking-wide text-rust">Contradictions</p>
                  <span className="ml-auto text-[10px] font-mono text-rust/80">{contradictions.length}</span>
                </div>
                <div className="px-1.5 pb-2 space-y-1">
                  {contradictions.map((rel) => {
                    // Closed contradictions stay in the record but read as
                    // resolved, so attention goes to the ones still open.
                    const closed = rel.status !== 'detected';
                    return (
                    <button
                      key={rel.id}
                      type="button"
                      onClick={() => setDetailId(rel.id)}
                      title="Inspect this contradiction"
                      className={`group w-full text-left rounded-xl border px-2.5 py-2 transition-colors cursor-pointer ${
                        closed
                          ? rel.status === 'evidence-needed'
                            ? 'border-amber-500/30 bg-amber-500/[0.06] hover:bg-amber-500/[0.1]'
                            : 'border-line bg-line/20 hover:bg-line/40'
                          : 'border-rust/40 bg-rust/[0.07] hover:bg-rust/[0.12] hover:border-rust/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
                            closed
                              ? rel.status === 'evidence-needed'
                                ? 'bg-amber-500/15 border-amber-500/40 text-warn'
                                : 'bg-line border-line-2 text-faint'
                              : 'bg-rust/15 border-rust/40 text-rust'
                          }`}
                        >
                          {closed ? (rel.status === 'evidence-needed' ? 'evidence needed' : rel.status) : `${Math.round(rel.confidence * 100)}% conflict`}
                        </span>
                        <span className="text-[10px] font-mono text-faint shrink-0">
                          {new Date(rel.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-[10px] font-medium text-faint ml-auto group-hover:text-cream transition-colors shrink-0">
                          inspect
                        </span>
                      </div>
                      <p className="text-xs text-sand leading-relaxed line-clamp-1">{rel.claimAText}</p>
                      <p className="text-[10px] font-mono text-rust/70 my-0.5">vs</p>
                      <p className="text-xs text-sand leading-relaxed line-clamp-1">{rel.claimBText}</p>
                    </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Contradiction detail view replaces the scroll region */}
            {detail ? (
              <div className="flex flex-col min-h-0 h-full">
                {/* Back header */}
                <div className="shrink-0 flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-line">
                  <button
                    type="button"
                    onClick={() => { setDetailId(null); setReplyTo(null); setCommentText(''); }}
                    className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
                  >
                    <ArrowLeft size={12} />
                    Back
                  </button>
                  <p className="text-sm font-semibold text-cream">Contradiction</p>
                  <span className="ml-auto text-[10px] font-mono text-faint">{Math.round(detail.confidence * 100)}% conflict</span>
                </div>

                {/* Scrollable body: the pair, the verdict, then the human discussion */}
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  <div className="rounded-xl border border-rust/40 bg-rust/[0.07] p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rust/15 border border-rust/40 text-rust">
                        Claim A
                      </span>
                      <span className="text-[10px] font-medium text-faint truncate">{detail.claimAModelName}</span>
                    </div>
                    <p className="text-xs text-sand leading-relaxed">{detail.claimAText}</p>
                  </div>

                  <div className="flex items-center justify-center gap-2 text-[10px] font-mono text-rust/70">
                    <span className="h-px flex-1 bg-rust/30" />
                    contradicts
                    <span className="h-px flex-1 bg-rust/30" />
                  </div>

                  <div className="rounded-xl border border-rust/40 bg-rust/[0.07] p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rust/15 border border-rust/40 text-rust">
                        Claim B
                      </span>
                      <span className="text-[10px] font-medium text-faint truncate">{detail.claimBModelName}</span>
                    </div>
                    <p className="text-xs text-sand leading-relaxed">{detail.claimBText}</p>
                  </div>

                  {/* Evidence on both sides, laid out side by side, so the room
                      weighs what actually backs each claim while deciding. */}
                  <div className="rounded-xl border border-line bg-line/20 p-2.5 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Evidence on the table</p>
                    <div>
                      <p className="text-[9px] font-bold text-rust mb-1">Claim A</p>
                      <EvidenceList claimId={detail.claimAId} compact canContribute={canContribute} />
                    </div>
                    <div>
                      <p className="text-[9px] font-bold text-rust mb-1">Claim B</p>
                      <EvidenceList claimId={detail.claimBId} compact canContribute={canContribute} />
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-faint mb-1">Explanation</p>
                    <p className="text-xs text-sand leading-relaxed">{detail.explanation}</p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold uppercase tracking-wide text-faint">AI confidence</span>
                      <span className="font-mono text-rust">{Math.round(detail.confidence * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-line overflow-hidden">
                      <div
                        className="h-full rounded-full bg-rust transition-all"
                        style={{ width: `${Math.round(detail.confidence * 100)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-faint/70 leading-relaxed">
                      Detector signal only. It never closes the contradiction.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Status</span>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                        detail.status === 'resolved'
                          ? 'bg-ember/10 border-ember/30 text-ember-soft'
                          : detail.status === 'evidence-needed'
                          ? 'bg-amber-500/15 border-amber-500/40 text-warn'
                          : detail.status === 'dismissed'
                          ? 'bg-line border-line-2 text-faint'
                          : 'bg-rust/15 border-rust/40 text-rust'
                      }`}
                    >
                      {detail.status === 'evidence-needed' ? 'evidence needed' : detail.status}
                    </span>
                  </div>

                  <p className="text-[10px] text-faint/70 leading-relaxed italic">
                    The AI detects contradictions only — it never decides which claim is true.
                  </p>

                  <ContradictionDiscussion
                    relationId={detail.id}
                    canResolve={canResolve}
                    onReply={(comment) => setReplyTo(comment)}
                  />
                </div>

                {/* Pinned composer so the thread is always answerable */}
                <div className="shrink-0 px-2.5 py-2 border-t border-line space-y-1.5">
                  {replyTo && (
                    <div className="flex items-center gap-1.5 text-[10px] text-faint bg-line/30 rounded-md px-2 py-1">
                      <span className="truncate">Replying to {replyTo.authorName}</span>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        title="Cancel the reply"
                        className="ml-auto p-0.5 rounded text-faint hover:text-cream cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                  <form onSubmit={handleCommentSubmit} className="flex items-center gap-1.5">
                    <input
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder={replyTo ? 'Write a reply…' : 'Comment on this contradiction…'}
                      maxLength={1000}
                      className="flex-1 min-w-0 text-xs rounded-lg bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2 py-1.5 focus:outline-none focus:border-ember/40 transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={!commentText.trim()}
                      title="Send"
                      className="flex items-center justify-center w-8 h-8 rounded-lg bg-ember/15 border border-ember/30 text-ember-soft hover:bg-ember/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Send size={13} />
                    </button>
                  </form>
                </div>
              </div>
            ) : claimDetail ? (
              <div className="flex flex-col min-h-0 h-full">
                {/* Back header */}
                <div className="shrink-0 flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-line">
                  <button
                    type="button"
                    onClick={() => setClaimDetailId(null)}
                    className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
                  >
                    <ArrowLeft size={12} />
                    Back
                  </button>
                  <p className="text-sm font-semibold text-cream">Claim</p>
                  <button
                    type="button"
                    onClick={() => { setClaimDetailId(null); jumpToMessage(claimDetail.messageId, claimDetail.createdAt); }}
                    title="Jump to the response this claim came from"
                    className="ml-auto flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium text-faint hover:text-ember-soft hover:bg-ember/10 transition-colors cursor-pointer"
                  >
                    <CornerDownRight size={12} />
                    Jump to source
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  <div className="rounded-xl border border-ember/30 bg-ember/[0.05] p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-ember/10 border border-ember/30 text-ember-soft shrink-0">
                        {claimDetail.modelName}
                      </span>
                      <span className="text-[10px] font-mono text-faint shrink-0">
                        {new Date(claimDetail.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(claimDetail)}
                        title="Delete this claim"
                        className="ml-auto p-1 rounded-md text-faint hover:text-rust hover:bg-rust/10 transition-colors cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <p className="text-xs text-sand leading-relaxed">{claimDetail.text}</p>
                  </div>

                  <EvidenceList claimId={claimDetail.id} canContribute={canContribute} />
                </div>
              </div>
            ) : (
              <>
              {/* Claims list */}
              {claims.map((claim) => (
                <div
                  key={claim.id}
                  className="group relative rounded-xl hover:bg-line transition-colors mx-2"
                >
                  <button
                    type="button"
                    onClick={() => handlePick(claim)}
                    className="w-full text-left px-2.5 py-2.5 rounded-xl hover:bg-transparent transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-ember/10 border border-ember/20 text-ember-soft shrink-0">
                        {claim.modelName}
                      </span>
                      <span className="text-[10px] font-mono text-faint shrink-0">
                        {new Date(claim.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                        {new Date(claim.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <CornerDownRight size={11} className="text-faint ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                    <p className="text-xs text-sand leading-relaxed pr-7">{claim.text}</p>
                  </button>

                  {/* Per-claim evidence viewer (outside the jump button so
                      nesting stays valid) */}
                  <button
                    type="button"
                    onClick={() => setClaimDetailId(claim.id)}
                    title="View and attach evidence for this claim"
                    className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold text-faint opacity-0 group-hover:opacity-100 hover:text-ember-soft hover:bg-ember/10 transition-all cursor-pointer"
                  >
                    <ScrollText size={10} />
                    Evidence
                  </button>

                  {/* Per-claim delete (outside the button so nesting stays valid) */}
                  <button
                    type="button"
                    onClick={() => handleDelete(claim)}
                    title="Delete this claim"
                    className="absolute top-1.5 right-1.5 p-1 rounded-md text-faint opacity-0 group-hover:opacity-100 hover:text-rust hover:bg-rust/10 transition-all cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}

              {count === 0 && contradictions.length === 0 && (
                <div className="px-4 py-7 text-center">
                  <p className="text-xs text-faint leading-relaxed">
                    No claims yet. Meaningful statements from AI responses in this room
                    are extracted automatically and shown here.
                  </p>
                  <p className="text-[11px] text-faint/70 mt-2 leading-relaxed">
                    They ground the next prompt in the ongoing discussion.
                  </p>
                </div>
              )}
              </>
            )}
            </div>

            {count > 0 && !detail && !claimDetail && (
              <div className="shrink-0 px-3 py-2 border-t border-line">
                <p className="text-[10px] font-mono text-faint">
                  {count} claim{count === 1 ? '' : 's'}{contradictions.length > 0 ? ` · ${contradictions.length} contradiction${contradictions.length === 1 ? '' : 's'}` : ''} — click to jump, hover to delete or open evidence
                </p>
              </div>
            )}
          </div>
        </Portal>
      )}
    </>
  );
}
