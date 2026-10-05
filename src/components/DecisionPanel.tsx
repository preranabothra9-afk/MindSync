import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import {
  Scale,
  ArrowLeft,
  Plus,
  X,
  Lock,
  Unlock,
  Trash2,
  Check,
  CheckCircle2,
  AlertTriangle,
  History,
  Send,
  Play,
  FileText,
} from 'lucide-react';
import type { ClaimRelation, Decision, DecisionBlocker, DecisionGateResult, DecisionClaimStatus } from '../types';
import Portal from '../hooks/Portal';
import DecisionReplay from './DecisionReplay';
import DecisionSummaryView from './DecisionSummary';

const PANEL_WIDTH = 420;
const PANEL_MAX_HEIGHT = 520;

const ACTION_LABEL: Record<Decision['history'][number]['action'], string> = {
  created: 'Created',
  'statement-edited': 'Edited',
  'claim-linked': 'Claim linked',
  'claim-unlinked': 'Claim unlinked',
  'approver-added': 'Approver added',
  'approver-removed': 'Approver removed',
  'approval-given': 'Approved',
  'approval-withdrawn': 'Approval withdrawn',
  finalized: 'Finalized',
  reopened: 'Reopened',
};

/**
 * The room's decisions and the Evidence Gate that guards them.
 *
 * A decision is the room's formal commitment — the thing the whole point of the
 * claims, evidence, and contradiction work leads to. It can only be finalized
 * once the gate is satisfied, and the gate is *always* the server's verdict:
 * this component shows what the server says is blocking and submits to it. The
 * Finalize button is enabled by that verdict, not by anything computed here, so
 * there is no client-side gate to circumvent.
 */
export default function DecisionPanel() {
  const activeConversation = useStore((s) => s.activeConversation);
  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const user = useStore((s) => s.user);
  const decisions = useStore((s) => s.decisions);
  const decisionGate = useStore((s) => s.decisionGate);
  const claims = useStore((s) => s.claims);
  const relations = useStore((s) => s.relations);
  const evidence = useStore((s) => s.evidence);
  const workspaceMembers = useStore((s) => s.workspaceMembers);

  const fetchDecisionGate = useStore((s) => s.fetchDecisionGate);
  const createDecision = useStore((s) => s.createDecision);
  const editDecision = useStore((s) => s.editDecision);
  const setDecisionClaims = useStore((s) => s.setDecisionClaims);
  const setDecisionApprovers = useStore((s) => s.setDecisionApprovers);
  const approveDecision = useStore((s) => s.approveDecision);
  const withdrawDecisionApproval = useStore((s) => s.withdrawDecisionApproval);
  const finalizeDecision = useStore((s) => s.finalizeDecision);
  const reopenDecision = useStore((s) => s.reopenDecision);
  const deleteDecision = useStore((s) => s.deleteDecision);
  const clearDecisionReplay = useStore((s) => s.clearDecisionReplay);

  const [open, setOpen] = useState(false);
  /** Id of the decision whose detail view is open; null shows the list. */
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Server refusal shown inline — validation, authorization, or gate blockers. */
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reopenText, setReopenText] = useState('');
  const [showReopen, setShowReopen] = useState(false);
  /** Decision currently open in the replay overlay, if any. */
  const [replayDecision, setReplayDecision] = useState<Decision | null>(null);
  /** Decision currently open in the summary overlay, if any. */
  const [summaryDecision, setSummaryDecision] = useState<Decision | null>(null);

  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');

  const detail = decisions.find((d) => d.id === detailId) ?? null;
  const disabled = !activeConversation;
  const count = decisions.length;

  // The workspace owner or an admin may finalize / reopen / delete. The author
  // may edit and finalize their own draft. Same authorization shape as closing
  // a contradiction.
  const canManage =
    !!activeWorkspace &&
    !!user &&
    (activeWorkspace.ownerId === user.id || user.role === 'admin' || detail?.createdBy === user.id);
  const canReopen = !!activeWorkspace && !!user && (activeWorkspace.ownerId === user.id || user.role === 'admin');

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const top = Math.min(r.bottom + 8, Math.max(12, window.innerHeight - PANEL_MAX_HEIGHT - 12));
    const left = Math.max(12, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 12));
    setPos({ top, left });
  }, [open]);

  // Keep the gate verdict current while a detail is open. Claims, evidence, and
  // contradictions all feed the gate, so a socket update in any of them can flip
  // ready ↔ blocked without the panel being touched. `detail` covers the
  // decision's own inputs — linked claims and approvals — which linking,
  // unlinking, approving and withdrawing all change; without it the checklist
  // would go stale the moment you toggle a claim and only recover on reopen.
  useEffect(() => {
    if (!open || !detailId) return;
    fetchDecisionGate(detailId);
    // claims/relations/evidence/detail are the gate's inputs; detailId is the
    // trigger. fetchDecisionGate writes decisionGate, not decisions, so `detail`
    // is stable across a fetch and this cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detailId, claims, relations, evidence, detail]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setDetailId(null);
        setCreating(false);
        setError(null);
        setConfirmingDelete(false);
        setShowReopen(false);
      }
    };
    const onResize = () => {
      setOpen(false);
      setDetailId(null);
      setCreating(false);
      setError(null);
      setConfirmingDelete(false);
      setShowReopen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const reset = () => {
    setTitle('');
    setStatement('');
    setError(null);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const st = statement.trim();
    if (!activeConversation || t.length < 3 || st.length < 10) return;
    setBusy(true);
    setError(null);
    const { error, decisionId } = await createDecision({ title: t, statement: st });
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    reset();
    setCreating(false);
    // Land straight on the decision that was just drafted: the list is one
    // click away from here, but until now a new draft vanished until the
    // author backed out and found it themselves.
    if (decisionId) setDetailId(decisionId);
  };

  const handleToggleClaim = async (claimId: string) => {
    if (!detail || !canManage) return;
    const next = detail.claimIds.includes(claimId)
      ? detail.claimIds.filter((id) => id !== claimId)
      : [...detail.claimIds, claimId];
    setError(null);
    const err = await setDecisionClaims(detail.id, next);
    if (err) setError(err);
  };

  const handleToggleApprover = async (memberId: string) => {
    if (!detail || !canManage) return;
    const next = detail.requiredApproverIds.includes(memberId)
      ? detail.requiredApproverIds.filter((id) => id !== memberId)
      : [...detail.requiredApproverIds, memberId];
    setError(null);
    const err = await setDecisionApprovers(detail.id, next);
    if (err) setError(err);
  };

  const handleApprove = async () => {
    if (!detail) return;
    setError(null);
    const already = detail.approvals.some((a) => a.userId === user?.id);
    const err = already
      ? await withdrawDecisionApproval(detail.id)
      : await approveDecision(detail.id);
    if (err) setError(err);
  };

  const handleFinalize = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    const err = await finalizeDecision(detail.id);
    setBusy(false);
    if (err) setError(err);
  };

  const handleReopen = async () => {
    if (!detail) return;
    const reason = reopenText.trim();
    if (reason.length < 3) return;
    setBusy(true);
    setError(null);
    const err = await reopenDecision(detail.id, reason);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setReopenText('');
    setShowReopen(false);
  };

  const handleDelete = async () => {
    if (!detail) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    const err = await deleteDecision(detail.id);
    setBusy(false);
    if (err) {
      setError(err);
      setConfirmingDelete(false);
      return;
    }
    setDetailId(null);
    setConfirmingDelete(false);
  };

  const openDetail = (id: string) => {
    setDetailId(id);
    setError(null);
    setConfirmingDelete(false);
    setShowReopen(false);
    setReopenText('');
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setDetailId(null);
          setCreating(false);
          setError(null);
        }}
        disabled={disabled}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border bg-panel-2 border-line text-sand hover:text-cream hover:border-line-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        title={disabled ? 'Select a room to make decisions' : 'The room’s decisions and the evidence gate'}
      >
        <Scale size={13} />
        <span className="hidden sm:inline">Decisions</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-leaf/15 border border-leaf/30 text-leaf text-[10px] font-mono font-bold leading-none">
            {count}
          </span>
        )}
      </button>

      {open && (
        <Portal>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />

          <div
            className="fixed z-[160] bg-panel-2 border border-line-2 rounded-2xl shadow-2xl overflow-hidden animate-fadeIn flex flex-col"
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: `min(60vh, ${PANEL_MAX_HEIGHT}px)` }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line shrink-0">
              <Scale size={14} className="text-leaf shrink-0" />
              <p className="text-sm font-semibold text-cream">
                {detail ? detail.title : 'Decisions'}
              </p>
              {!detail && (
                <button
                  type="button"
                  onClick={() => { setCreating((v) => !v); reset(); }}
                  title="Draft a decision"
                  className={`ml-auto flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                    creating
                      ? 'bg-leaf/15 border-leaf/40 text-leaf'
                      : 'bg-transparent border-line/50 text-faint hover:text-leaf hover:border-leaf/40'
                  }`}
                >
                  <Plus size={11} />
                  New
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Close"
                className="p-1 rounded-md text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>

            {error && (
              <div className="shrink-0 mx-3 mt-2 rounded-lg border border-rust/40 bg-rust/[0.07] px-2.5 py-2">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="text-rust shrink-0 mt-0.5" />
                  <p className="text-[11px] text-rust leading-relaxed whitespace-pre-line">{error}</p>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {detail ? (
                <DecisionDetail
                  decision={detail}
                  gate={decisionGate?.decisionId === detail.id ? decisionGate : null}
                  claims={claims}
                  relations={relations}
                  workspaceMembers={workspaceMembers}
                  canManage={canManage}
                  canReopen={canReopen}
                  canApprove={!!user && (detail.requiredApproverIds.includes(user.id) || activeWorkspace?.ownerId === user.id)}
                  currentUserApproved={detail.approvals.some((a) => a.userId === user?.id)}
                  busy={busy}
                  confirmingDelete={confirmingDelete}
                  showReopen={showReopen}
                  reopenText={reopenText}
                  setReopenText={setReopenText}
                  onToggleClaim={handleToggleClaim}
                  onToggleApprover={handleToggleApprover}
                  onApprove={handleApprove}
                  onFinalize={handleFinalize}
                  onReopen={() => { setShowReopen(true); setReopenText(''); }}
                  onSubmitReopen={handleReopen}
                  onCancelReopen={() => { setShowReopen(false); setReopenText(''); }}
                  onDelete={handleDelete}
                  onBack={() => { setDetailId(null); setError(null); setConfirmingDelete(false); setShowReopen(false); }}
                  onReplay={() => setReplayDecision(detail)}
                  onSummary={() => setSummaryDecision(detail)}
                />
              ) : creating ? (
                <form onSubmit={handleCreate} className="p-3 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-faint">Title</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Adopt Qwen for the data-extraction step"
                      maxLength={80}
                      autoFocus
                      className="w-full text-xs rounded-lg bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2.5 py-2 focus:outline-none focus:border-leaf/40 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-faint">Statement</label>
                    <textarea
                      value={statement}
                      onChange={(e) => setStatement(e.target.value)}
                      placeholder="What the room is committing to, and why…"
                      maxLength={600}
                      rows={4}
                      className="w-full text-xs rounded-lg bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2.5 py-2 focus:outline-none focus:border-leaf/40 transition-colors resize-none"
                    />
                    <p className="text-[10px] text-faint leading-relaxed">
                      Claims, evidence, contradictions, and approvers are added on the next screen — the gate has to see all of them before this can be finalized.
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setCreating(false); reset(); }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy || title.trim().length < 3 || statement.trim().length < 10}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-leaf/15 border border-leaf/30 text-leaf hover:bg-leaf/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Send size={11} />
                      Draft decision
                    </button>
                  </div>
                </form>
              ) : count === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Scale size={22} className="mx-auto text-faint/40 mb-2.5" />
                  <p className="text-xs text-faint leading-relaxed">
                    No decisions in this room yet.
                  </p>
                  <p className="text-[11px] text-faint/70 mt-2 leading-relaxed">
                    A decision records what the room settled on. It can only be finalized once its claims carry evidence, its contradictions are resolved, and its approvers have signed off.
                  </p>
                </div>
              ) : (
                <div className="p-1.5 space-y-1">
                  {decisions.map((d) => (
                    <DecisionRow key={d.id} decision={d} onOpen={() => openDetail(d.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Portal>
      )}

      {replayDecision && (
        <DecisionReplay
          decision={replayDecision}
          onClose={() => {
            setReplayDecision(null);
            clearDecisionReplay();
          }}
        />
      )}

      {summaryDecision && (
        <DecisionSummaryView
          decisionId={summaryDecision.id}
          decisionTitle={summaryDecision.title}
          onClose={() => {
            setSummaryDecision(null);
            clearDecisionReplay();
          }}
        />
      )}
    </>
  );
}

/** One decision in the list, with its status pill. */
function DecisionRow({ decision, onOpen }: { decision: Decision; onOpen: () => void }) {
  const finalized = decision.status === 'finalized';
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open this decision"
      className={`group w-full text-left rounded-xl border px-2.5 py-2.5 transition-colors cursor-pointer ${
        finalized
          ? 'border-leaf/30 bg-leaf/[0.05] hover:bg-leaf/[0.09]'
          : 'border-line bg-line/20 hover:bg-line/40'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
            finalized
              ? 'bg-leaf/15 border-leaf/40 text-leaf'
              : 'bg-line border-line-2 text-faint'
          }`}
        >
          {finalized ? 'Finalized' : 'Draft'}
        </span>
        <span className="text-[10px] font-mono text-faint shrink-0">
          {new Date(finalized ? (decision.finalizedAt ?? decision.createdAt) : decision.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </span>
        <span className="text-[10px] font-medium text-faint ml-auto group-hover:text-cream transition-colors shrink-0">
          open
        </span>
      </div>
      <p className="text-xs font-medium text-cream leading-relaxed line-clamp-1">{decision.title}</p>
      <p className="text-[11px] text-sand leading-relaxed line-clamp-2 mt-0.5">{decision.statement}</p>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-faint">
        <span>{decision.claimIds.length} claim{decision.claimIds.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>{decision.approvals.length}/{decision.requiredApproverIds.length} approved</span>
      </div>
    </button>
  );
}

interface DecisionDetailProps {
  decision: Decision;
  gate: DecisionGateResult | null;
  claims: { id: string; text: string; modelName: string }[];
  relations: ClaimRelation[];
  workspaceMembers: { id: string; name: string }[];
  canManage: boolean;
  canReopen: boolean;
  canApprove: boolean;
  currentUserApproved: boolean;
  busy: boolean;
  confirmingDelete: boolean;
  showReopen: boolean;
  reopenText: string;
  setReopenText: (v: string) => void;
  onToggleClaim: (claimId: string) => void;
  onToggleApprover: (memberId: string) => void;
  onApprove: () => void;
  onFinalize: () => void;
  onReopen: () => void;
  onSubmitReopen: () => void;
  onCancelReopen: () => void;
  onDelete: () => void;
  onBack: () => void;
  onReplay: () => void;
  onSummary: () => void;
}

type DecisionGateResultPreview = {
  decisionId: string;
  status: 'draft' | 'finalized';
  ready: boolean;
  blockers: DecisionBlocker[];
  claimsTotal: number;
  claimsEvidenced: number;
  contradictionsOpen: number;
  approvalsRequired: number;
  approvalsGiven: number;
};

function DecisionDetail({
  decision,
  gate,
  claims,
  relations,
  workspaceMembers,
  canManage,
  canReopen,
  canApprove,
  currentUserApproved,
  busy,
  confirmingDelete,
  showReopen,
  reopenText,
  setReopenText,
  onToggleClaim,
  onToggleApprover,
  onApprove,
  onFinalize,
  onReopen,
  onSubmitReopen,
  onCancelReopen,
  onDelete,
  onBack,
  onReplay,
  onSummary,
}: DecisionDetailProps) {
  const finalized = decision.status === 'finalized';
  const ready = !finalized && !!gate?.ready;
  const locked = finalized;

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Back header */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 pt-2.5 pb-2 border-b border-line">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
        >
          <ArrowLeft size={12} />
          Back
        </button>
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={onReplay}
            className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10.5px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
            title="Step through the events that formed this decision"
          >
            <Play size={11} />
            Replay
          </button>
          <button
            type="button"
            onClick={onSummary}
            className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[10.5px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
            title="The decision's question, claims, evidence, and remaining uncertainties"
          >
            <FileText size={11} />
            Summary
          </button>
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
              finalized
                ? 'bg-leaf/15 border-leaf/40 text-leaf'
                : ready
                  ? 'bg-ember/15 border-ember/40 text-ember-soft'
                  : 'bg-line border-line-2 text-faint'
            }`}
          >
            {finalized ? 'FINALIZED' : ready ? 'READY' : 'DRAFT'}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5">
        {/* Statement */}
        <div
          className={`rounded-xl border p-2.5 ${
            finalized ? 'border-leaf/30 bg-leaf/[0.05]' : 'border-line bg-line/20'
          }`}
        >
          {locked ? (
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-medium text-leaf">
              <Lock size={11} />
              Locked — finalized {decision.finalizedAt ? new Date(decision.finalizedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''} by {decision.finalizedByName ?? 'Unknown'}
            </div>
          ) : null}
          <p className="text-xs text-cream leading-relaxed font-medium">{decision.title}</p>
          <p className="text-xs text-sand leading-relaxed mt-1.5">{decision.statement}</p>
          <div className="flex items-center gap-1.5 mt-2 text-[10px] font-mono text-faint">
            <span>Drafted by {decision.createdByName}</span>
          </div>
        </div>

        {/* The gate verdict. The server computes it; this only renders it. */}
        {!locked && gate && (
          <GateChecklist gate={gate} claims={claims} relations={relations} members={workspaceMembers} />
        )}

        {/* Linked claims */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-faint mb-1.5">
            Claims this decision rests on
          </p>
          {claims.length === 0 ? (
            <p className="text-[11px] text-faint/70 leading-relaxed">
              No claims in this room yet. Claims are mined from the models’ responses and appear here automatically.
            </p>
          ) : locked ? (
            <div className="space-y-1">
              {decision.claimIds.length === 0 ? (
                <p className="text-[11px] text-faint/70 leading-relaxed">No claims were linked.</p>
              ) : (
                decision.claimIds.map((id) => {
                  const c = claims.find((x) => x.id === id);
                  return (
                    <div key={id} className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
                      <span className="text-[10px] font-semibold text-ember-soft mr-1.5">{c?.modelName ?? 'deleted'}</span>
                      <span className="text-[11px] text-sand leading-relaxed">{c?.text ?? 'This claim no longer exists.'}</span>
                    </div>
                  );
                })
              )}
            </div>
          ) : canManage ? (
            <div className="space-y-1">
              {claims.map((c) => {
                const linked = decision.claimIds.includes(c.id);
                // `?.` on both levels: an older server may not send per-claim
                // statuses at all, and that must not crash the render.
                const status = gate?.claimStatuses?.find((s) => s.claimId === c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onToggleClaim(c.id)}
                    title={linked ? 'Unlink this claim' : 'Link this claim'}
                    className={`w-full flex items-start gap-2 text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer ${
                      linked
                        ? 'border-ember/40 bg-ember/[0.07] hover:bg-ember/[0.11]'
                        : 'border-line bg-panel-2 hover:bg-line/40'
                    }`}
                  >
                    <span
                      className={`shrink-0 mt-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border ${
                        linked ? 'bg-ember/20 border-ember/50 text-ember-soft' : 'border-line-2 text-transparent'
                      }`}
                    >
                      <Check size={9} strokeWidth={3.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[10px] font-semibold text-ember-soft mr-1.5">{c.modelName}</span>
                      <span className="text-[11px] text-sand leading-relaxed">{c.text}</span>
                      {linked && status && (
                        <span className="block mt-1">
                          <ClaimBackingBadge status={status} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {decision.claimIds.length === 0 ? (
                <p className="text-[11px] text-faint/70 leading-relaxed">No claims linked.</p>
              ) : (
                decision.claimIds.map((id) => {
                  const c = claims.find((x) => x.id === id);
                  const status = gate?.claimStatuses?.find((s) => s.claimId === id);
                  return (
                    <div key={id} className="rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
                      <span className="text-[10px] font-semibold text-ember-soft mr-1.5">{c?.modelName ?? 'deleted'}</span>
                      <span className="text-[11px] text-sand leading-relaxed">{c?.text ?? 'This claim no longer exists.'}</span>
                      {status && (
                        <span className="block mt-1">
                          <ClaimBackingBadge status={status} />
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Approvals */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-faint mb-1.5">
            Required approvals
          </p>
          {workspaceMembers.length === 0 ? (
            <p className="text-[11px] text-faint/70 leading-relaxed">No members found.</p>
          ) : locked ? (
            <div className="space-y-1">
              {decision.requiredApproverIds.length === 0 ? (
                <p className="text-[11px] text-faint/70 leading-relaxed">No approvers were required.</p>
              ) : (
                decision.requiredApproverIds.map((id) => {
                  const approved = decision.approvals.find((a) => a.userId === id);
                  const name = workspaceMembers.find((m) => m.id === id)?.name ?? 'Unknown member';
                  return (
                    <div key={id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
                      {approved ? (
                        <CheckCircle2 size={12} className="text-leaf shrink-0" />
                      ) : (
                        <div className="w-3 h-3 rounded-full border border-line-2 shrink-0" />
                      )}
                      <span className="text-[11px] text-sand">{name}</span>
                      {approved && (
                        <span className="ml-auto text-[10px] font-mono text-faint">
                          {new Date(approved.approvedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <>
              {canManage && (
                <div className="space-y-1 mb-2">
                  {workspaceMembers.map((m) => {
                    const required = decision.requiredApproverIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onToggleApprover(m.id)}
                        title={required ? 'Remove this approver' : 'Require this member’s approval'}
                        className={`w-full flex items-center gap-2 text-left rounded-lg border px-2.5 py-1.5 transition-colors cursor-pointer ${
                          required
                            ? 'border-ember/40 bg-ember/[0.07] hover:bg-ember/[0.11]'
                            : 'border-line bg-panel-2 hover:bg-line/40'
                        }`}
                      >
                        <span
                          className={`shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border ${
                            required ? 'bg-ember/20 border-ember/50 text-ember-soft' : 'border-line-2 text-transparent'
                          }`}
                        >
                          <Check size={9} strokeWidth={3.5} />
                        </span>
                        <span className="text-[11px] text-sand">{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {canApprove && (
                <button
                  type="button"
                  onClick={onApprove}
                  className={`w-full flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                    currentUserApproved
                      ? 'bg-leaf/10 border-leaf/30 text-leaf hover:bg-leaf/20'
                      : 'bg-panel-2 border-line text-sand hover:border-leaf/40 hover:text-leaf'
                  }`}
                >
                  {currentUserApproved ? (
                    <>
                      <CheckCircle2 size={12} />
                      You approved this — click to withdraw
                    </>
                  ) : (
                    <>
                      <div className="w-3 h-3 rounded-full border border-current" />
                      Approve this decision
                    </>
                  )}
                </button>
              )}
              {decision.requiredApproverIds.length === 0 && !canManage && (
                <p className="text-[11px] text-faint/70 leading-relaxed">
                  No approvers required yet. The decision’s author or a workspace owner can add them.
                </p>
              )}
            </>
          )}
        </div>

        {/* History — append-only, rendered as-is. */}
        {decision.history.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <History size={11} className="text-faint shrink-0" />
              <p className="text-[10px] font-bold uppercase tracking-wide text-faint">History</p>
              <span className="ml-auto text-[10px] font-mono text-faint">{decision.history.length}</span>
            </div>
            <div className="space-y-0">
              {[...decision.history].reverse().map((h, i) => (
                <div key={i} className="flex gap-2.5 relative">
                  <div className="flex flex-col items-center shrink-0">
                    <span
                      className={`mt-1 w-1.5 h-1.5 rounded-full ${
                        h.action === 'finalized'
                          ? 'bg-leaf'
                          : h.action === 'reopened'
                            ? 'bg-rust'
                            : h.action === 'approval-withdrawn'
                              ? 'bg-rust/70'
                              : 'bg-line-2'
                      }`}
                    />
                    {i < decision.history.length - 1 && <span className="w-px flex-1 bg-line" />}
                  </div>
                  <div className="pb-2.5 min-w-0">
                    <p className="text-[11px] font-medium text-sand">
                      {ACTION_LABEL[h.action]} · {h.actorName}
                    </p>
                    <p className="text-[10px] text-faint leading-relaxed">{h.detail}</p>
                    <p className="text-[10px] font-mono text-faint/70 mt-0.5">
                      {new Date(h.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                      {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer: finalize / reopen / delete. */}
      {!locked ? (
        <div className="shrink-0 px-3 py-2.5 border-t border-line space-y-2">
          <button
            type="button"
            onClick={onFinalize}
            disabled={busy || !canManage || !ready}
            title={
              !canManage
                ? 'Only the author, the workspace owner, or an admin can finalize'
                : !ready
                  ? 'The evidence gate is not satisfied yet'
                  : 'Finalize this decision'
            }
            className={`w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
              ready
                ? 'bg-leaf/20 border border-leaf/40 text-leaf hover:bg-leaf/30'
                : 'bg-line/30 border border-line text-faint'
            }`}
          >
            <Lock size={12} />
            Finalize decision
          </button>
          {gate && !ready && gate.blockers.length > 0 && (
            // The checklist lives at the top of a scrolling region and may be
            // scrolled out of sight, so the blockers are restated here — the
            // member should not have to hunt to learn what is in the way.
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ember-soft">
                {gate.blockers.length} condition{gate.blockers.length === 1 ? '' : 's'} still blocking
              </p>
              {gate.blockers.map((b, i) => (
                <p key={i} className="text-[10.5px] text-ember-soft/90 leading-relaxed">
                  • {b.message}
                </p>
              ))}
            </div>
          )}
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              className={`w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border transition-colors cursor-pointer ${
                confirmingDelete
                  ? 'bg-rust/15 border-rust/40 text-rust'
                  : 'bg-transparent border-line/50 text-faint hover:text-rust hover:border-rust/40'
              }`}
            >
              <Trash2 size={11} />
              {confirmingDelete ? 'Click again to confirm deleting' : 'Delete draft'}
            </button>
          )}
        </div>
      ) : (
        <div className="shrink-0 px-3 py-2.5 border-t border-line space-y-2">
          {showReopen ? (
            <div className="space-y-1.5">
              <textarea
                value={reopenText}
                onChange={(e) => setReopenText(e.target.value)}
                placeholder="Why is this being reopened?"
                maxLength={300}
                rows={2}
                autoFocus
                className="w-full text-xs rounded-lg bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2.5 py-2 focus:outline-none focus:border-rust/40 transition-colors resize-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancelReopen}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSubmitReopen}
                  disabled={busy || !canReopen || reopenText.trim().length < 3}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rust/15 border border-rust/40 text-rust hover:bg-rust/25 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Unlock size={11} />
                  Confirm reopen
                </button>
              </div>
            </div>
          ) : (
            <>
              {canReopen ? (
                <button
                  type="button"
                  onClick={onReopen}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border border-line/50 text-faint hover:text-rust hover:border-rust/40 transition-colors cursor-pointer"
                >
                  <Unlock size={11} />
                  Reopen
                </button>
              ) : (
                <p className="text-[10px] text-faint/70 leading-relaxed text-center">
                  Only the workspace owner or an admin can reopen a finalized decision.
                </p>
              )}
              {canReopen && (
                <button
                  type="button"
                  onClick={onDelete}
                  className={`w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border transition-colors cursor-pointer ${
                    confirmingDelete
                      ? 'bg-rust/15 border-rust/40 text-rust'
                      : 'bg-transparent border-line/50 text-faint hover:text-rust hover:border-rust/40'
                  }`}
                >
                  <Trash2 size={11} />
                  {confirmingDelete ? 'Click again to confirm deleting' : 'Delete decision'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the gate's verdict as a checklist of passing / failing conditions.
 * The blocker list names the specific claims, contradictions, and approvers it
 * is about, so the member sees what to fix rather than a count.
 */
function GateChecklist({
  gate,
  claims,
  relations,
  members
}: {
  gate: DecisionGateResult;
  claims: { id: string; text: string }[];
  relations: ClaimRelation[];
  members: { id: string; name: string }[];
}) {
  const rows = [
    {
      ok: gate.claimsTotal > 0 && gate.claimsEvidenced === gate.claimsTotal,
      label: 'Claims have evidence or a human resolution',
      detail: `${gate.claimsEvidenced}/${gate.claimsTotal} backed`,
    },
    {
      ok: gate.contradictionsOpen === 0,
      label: 'Contradictions among the linked claims are resolved',
      detail: gate.contradictionsOpen === 0 ? 'none open' : `${gate.contradictionsOpen} open`,
    },
    {
      ok: gate.approvalsRequired === 0 || gate.approvalsGiven >= gate.approvalsRequired,
      label: 'Every required approval is recorded',
      detail: `${gate.approvalsGiven}/${gate.approvalsRequired} approved`,
    },
  ];

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {gate.ready ? (
          <CheckCircle2 size={12} className="text-leaf shrink-0" />
        ) : (
          <AlertTriangle size={12} className="text-ember-soft shrink-0" />
        )}
        <p className={`text-[10px] font-bold uppercase tracking-wide ${gate.ready ? 'text-leaf' : 'text-ember-soft'}`}>
          Evidence gate
        </p>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2">
          {r.ok ? (
            <CheckCircle2 size={12} className="text-leaf shrink-0 mt-0.5" />
          ) : (
            <div className="w-3 h-3 rounded-full border border-ember/50 shrink-0 mt-0.5" />
          )}
          <span className="text-[11px] text-sand leading-relaxed">{r.label}</span>
          <span className="ml-auto text-[10px] font-mono text-faint shrink-0 mt-0.5">{r.detail}</span>
        </div>
      ))}
      {gate.blockers.length > 0 && (
        <div className="pt-1.5 mt-1.5 border-t border-line space-y-1.5">
          {gate.blockers.map((b, i) => (
            <div key={i} className="space-y-1">
              <p className="text-[11px] text-ember-soft leading-relaxed">
                • {b.message}
              </p>
              {/* Name the specific claims so the member knows exactly what to
                  fix instead of hunting through the list. */}
              {b.claimIds && b.claimIds.length > 0 && (
                <div className="pl-3.5 space-y-0.5">
                  {b.claimIds.map((cid) => {
                    const c = claims.find((x) => x.id === cid);
                    return (
                      <p key={cid} className="text-[10.5px] text-sand/80 leading-relaxed line-clamp-2">
                        — {c ? c.text : 'This claim no longer exists.'}
                      </p>
                    );
                  })}
                </div>
              )}
              {b.relationIds && b.relationIds.length > 0 && (
                <div className="pl-3.5 space-y-1">
                  {b.relationIds.map((rid) => {
                    // Name both sides of each open contradiction so the member
                    // can tell whether the one they closed is the one being
                    // counted — resolving a *different* pair leaves this open.
                    const rel = relations.find((x) => x.id === rid);
                    const a = rel ? claims.find((c) => c.id === rel.claimAId) : undefined;
                    const bb = rel ? claims.find((c) => c.id === rel.claimBId) : undefined;
                    return (
                      <p key={rid} className="text-[10.5px] text-sand/80 leading-relaxed line-clamp-2">
                        — {rel ? `${a ? a.text : 'a deleted claim'}  ⟷  ${bb ? bb.text : 'a deleted claim'}` : 'This contradiction no longer exists.'}
                      </p>
                    );
                  })}
                  <p className="text-[10px] text-faint leading-relaxed">
                    Still open — open the room's Contradictions list to resolve or dismiss it.
                  </p>
                </div>
              )}
              {b.approverIds && b.approverIds.length > 0 && (
                <div className="pl-3.5 space-y-0.5">
                  {b.approverIds.map((aid) => {
                    const m = members.find((x) => x.id === aid);
                    return (
                      <p key={aid} className="text-[10.5px] text-sand/80 leading-relaxed">
                        — {m ? m.name : 'a member'}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The small verdict under a linked claim: backed by evidence, backed by a
 * human resolution, or still unsupported. Shown on every claim row so a member
 * can see at a glance which linked claims the gate accepts and which it does
 * not — the counts alone do not say which claim is the holdout.
 */
function ClaimBackingBadge({ status }: { status: DecisionClaimStatus }) {
  if (status.evidenceCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-leaf/10 border border-leaf/30 text-leaf text-[9px] font-bold">
        <CheckCircle2 size={8} />
        {status.evidenceCount} piece{status.evidenceCount === 1 ? '' : 's'} of evidence
      </span>
    );
  }
  if (status.humanResolution) {
    return (
      <span
        title={status.humanResolution}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-leaf/10 border border-leaf/30 text-leaf text-[9px] font-bold"
      >
        <CheckCircle2 size={8} />
        Resolved by a human
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-ember/10 border border-ember/30 text-ember-soft text-[9px] font-bold">
      <AlertTriangle size={8} />
      Needs evidence
    </span>
  );
}
