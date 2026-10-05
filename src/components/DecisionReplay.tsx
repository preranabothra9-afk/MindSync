import { useEffect, useState } from 'react';
import { useStore } from '../store';
import {
  Scale,
  X,
  MessageSquare,
  Quote,
  AlertTriangle,
  CheckCircle2,
  Paperclip,
  Trash2,
  MessageCircle,
  BarChart2,
  History,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Bot,
  Lock,
  Unlock,
  Plus,
  UserPlus,
  UserMinus,
  ThumbsUp,
  ThumbsDown,
  Edit3,
  Check,
} from 'lucide-react';
import type { TimelineEvent, TimelineEventKind, ReplaySnapshot, Decision } from '../types';
import Portal from '../hooks/Portal';

/* ──────────────────────────────────────────────────────────────────────── *
 * Decision Replay
 *
 * A scrubber over the room's append-only event stream. The server folds the
 * events into a state at each position; this component only renders what it
 * is handed, so there is no second copy of the room's history to drift. The
 * gate verdict shown at each step is the server's reconstruction of the same
 * rules the finalize route enforces — never a client-side guess.
 * ──────────────────────────────────────────────────────────────────────── */

const KIND_ICON: Record<TimelineEventKind, typeof Scale> = {
  prompt: MessageSquare,
  'ai-response': Bot,
  'claim-extracted': Quote,
  'contradiction-detected': AlertTriangle,
  'contradiction-resolved': CheckCircle2,
  'evidence-added': Paperclip,
  'evidence-deleted': Trash2,
  'comment-added': MessageCircle,
  'comment-deleted': Trash2,
  'vote-cast': BarChart2,
  'decision-created': Plus,
  'decision-edited': Edit3,
  'decision-claim-linked': CornerDownRight,
  'decision-claim-unlinked': CornerDownRight,
  'decision-approver-added': UserPlus,
  'decision-approver-removed': UserMinus,
  'decision-approved': ThumbsUp,
  'decision-approval-withdrawn': ThumbsDown,
  'decision-finalized': Lock,
  'decision-reopened': Unlock,
};

const KIND_TONE: Record<TimelineEventKind, string> = {
  prompt: 'text-ember',
  'ai-response': 'text-sky-400',
  'claim-extracted': 'text-leaf',
  'contradiction-detected': 'text-rust',
  'contradiction-resolved': 'text-leaf',
  'evidence-added': 'text-leaf',
  'evidence-deleted': 'text-faint',
  'comment-added': 'text-sand',
  'comment-deleted': 'text-faint',
  'vote-cast': 'text-ember',
  'decision-created': 'text-ember',
  'decision-edited': 'text-sand',
  'decision-claim-linked': 'text-ember-soft',
  'decision-claim-unlinked': 'text-faint',
  'decision-approver-added': 'text-ember-soft',
  'decision-approver-removed': 'text-faint',
  'decision-approved': 'text-leaf',
  'decision-approval-withdrawn': 'text-rust',
  'decision-finalized': 'text-leaf',
  'decision-reopened': 'text-rust',
};

function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
      <History size={28} className="text-faint/50" />
      <p className="text-sm font-medium text-sand">Nothing to replay yet</p>
      <p className="max-w-sm text-[11.5px] text-faint/80 leading-relaxed">
        This decision has no recorded events. The room's prompts, claims, and evidence will appear here as they happen.
      </p>
    </div>
  );
}

function EventRow({
  event,
  active,
  index,
  onClick,
}: {
  event: TimelineEvent;
  active: boolean;
  index: number;
  onClick: () => void;
}) {
  const Icon = KIND_ICON[event.kind] ?? History;
  const tone = KIND_TONE[event.kind] ?? 'text-faint';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
        active
          ? 'bg-ember/[0.09] ring-1 ring-inset ring-ember/30'
          : 'hover:bg-line/30'
      }`}
    >
      <span className="shrink-0 mt-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-panel-3 border border-line">
        <Icon size={11} className={tone} strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`text-[11px] font-semibold ${active ? 'text-cream' : 'text-sand'}`}>{event.title}</span>
        </span>
        <span className="block text-[10.5px] text-faint/85 leading-snug line-clamp-2 mt-0.5">{event.detail}</span>
        <span className="block text-[9.5px] font-mono text-faint/60 mt-0.5">
          {formatAt(event.at)} · {event.actorName}
        </span>
      </span>
      <span className="shrink-0 text-[9.5px] font-mono text-faint/50 mt-1">{index + 1}</span>
    </button>
  );
}

function GateBanner({ snapshot }: { snapshot: ReplaySnapshot }) {
  if (snapshot.status === 'finalized') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-leaf/40 bg-leaf/[0.07] px-3 py-2">
        <Lock size={13} className="text-leaf shrink-0" />
        <p className="text-[11px] text-leaf leading-relaxed">
          The decision was finalized at this point — the gate was satisfied and the record locked.
        </p>
      </div>
    );
  }
  if (snapshot.gateReady) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ember/40 bg-ember/[0.07] px-3 py-2">
        <CheckCircle2 size={13} className="text-ember-soft shrink-0" />
        <p className="text-[11px] text-ember-soft leading-relaxed">
          Every gate condition was satisfied at this point — the room could have finalized here.
        </p>
      </div>
    );
  }
  const missing: string[] = [];
  if (snapshot.claimsLinked.length === 0) missing.push('no claims linked');
  const unbacked = snapshot.claimsLinked.filter((c) => !c.backed).length;
  if (unbacked > 0) missing.push(`${unbacked} claim${unbacked === 1 ? '' : 's'} still unevidenced`);
  if (snapshot.contradictionsOpen.length > 0) missing.push(`${snapshot.contradictionsOpen.length} open contradiction${snapshot.contradictionsOpen.length === 1 ? '' : 's'}`);
  const outstanding = snapshot.requiredApproverIds.filter((id) => !snapshot.approvalsGiven.some((a) => a.userId === id)).length;
  if (outstanding > 0) missing.push(`${outstanding} approval${outstanding === 1 ? '' : 's'} outstanding`);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rust/35 bg-rust/[0.06] px-3 py-2">
      <AlertTriangle size={13} className="text-rust shrink-0 mt-0.5" />
      <p className="text-[11px] text-rust/90 leading-relaxed">
        The gate was still closed at this point — {missing.join(', ')}.
      </p>
    </div>
  );
}

function SnapshotPanel({ snapshot }: { snapshot: ReplaySnapshot }) {
  const approvedIds = new Set(snapshot.approvalsGiven.map((a) => a.userId));
  const outstanding = snapshot.requiredApproverIds.filter((id) => !approvedIds.has(id));
  return (
    <div className="flex flex-col gap-3">
      <GateBanner snapshot={snapshot} />

      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Quote size={11} className="text-faint shrink-0" />
          <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Claims the decision rests on</p>
          <span className="ml-auto text-[10px] font-mono text-faint">{snapshot.claimsLinked.length}</span>
        </div>
        {snapshot.claimsLinked.length === 0 ? (
          <p className="text-[10.5px] text-faint/70 leading-relaxed">No claims linked at this point.</p>
        ) : (
          <div className="space-y-1">
            {snapshot.claimsLinked.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-2 rounded-lg border border-line bg-panel-3 px-2.5 py-1.5"
              >
                <span className="text-[9.5px] font-semibold text-ember-soft shrink-0 mt-0.5">{c.modelName}</span>
                <span className="text-[10.5px] text-sand leading-snug flex-1 min-w-0">{c.text}</span>
                <span
                  className={`shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                    c.backed
                      ? 'bg-leaf/15 border-leaf/35 text-leaf'
                      : 'bg-rust/10 border-rust/30 text-rust/90'
                  }`}
                >
                  {c.backed ? 'backed' : 'unbacked'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} className="text-faint shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Open</p>
            <span className="ml-auto text-[10px] font-mono text-faint">{snapshot.contradictionsOpen.length}</span>
          </div>
          {snapshot.contradictionsOpen.length === 0 ? (
            <p className="text-[10.5px] text-faint/70 leading-relaxed">Nothing unresolved.</p>
          ) : (
            <div className="space-y-1">
              {snapshot.contradictionsOpen.map((c) => (
                <div key={c.id} className="rounded-lg border border-rust/30 bg-rust/[0.05] px-2.5 py-1.5">
                  <p className="text-[10px] text-rust/90 leading-snug line-clamp-2">{c.claimAText}</p>
                  <p className="text-[9px] font-bold text-rust/60 my-0.5">vs</p>
                  <p className="text-[10px] text-rust/90 leading-snug line-clamp-2">{c.claimBText}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <CheckCircle2 size={11} className="text-faint shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Closed</p>
            <span className="ml-auto text-[10px] font-mono text-faint">{snapshot.contradictionsClosed.length}</span>
          </div>
          {snapshot.contradictionsClosed.length === 0 ? (
            <p className="text-[10.5px] text-faint/70 leading-relaxed">None closed yet.</p>
          ) : (
            <div className="space-y-1">
              {snapshot.contradictionsClosed.map((c) => (
                <div key={c.id} className="rounded-lg border border-leaf/25 bg-leaf/[0.04] px-2.5 py-1.5">
                  <p className="text-[10px] text-leaf/90 leading-snug line-clamp-2">{c.claimAText} ⟷ {c.claimBText}</p>
                  <p className="text-[9.5px] text-faint leading-snug mt-0.5">
                    {c.status} by {c.resolvedByName ?? 'a member'}
                    {c.resolution ? ` — “${c.resolution}”` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Paperclip size={11} className="text-faint shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Evidence on record</p>
            <span className="ml-auto text-[10px] font-mono text-faint">{snapshot.evidenceAttached.length}</span>
          </div>
          {snapshot.evidenceAttached.length === 0 ? (
            <p className="text-[10.5px] text-faint/70 leading-relaxed">Nothing attached yet.</p>
          ) : (
            <div className="space-y-1">
              {snapshot.evidenceAttached.map((e) => (
                <div key={e.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-3 px-2 py-1">
                  <span className="text-[10px] text-sand leading-snug flex-1 min-w-0 truncate">{e.title}</span>
                  {e.aiGenerated && (
                    <span className="shrink-0 text-[8.5px] font-bold px-1 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-400">
                      AI
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <ThumbsUp size={11} className="text-faint shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Approvals</p>
            <span className="ml-auto text-[10px] font-mono text-faint">
              {snapshot.approvalsGiven.length}/{snapshot.requiredApproverIds.length}
            </span>
          </div>
          {snapshot.approvalsGiven.length === 0 && outstanding.length === 0 ? (
            <p className="text-[10.5px] text-faint/70 leading-relaxed">None required yet.</p>
          ) : (
            <div className="space-y-1">
              {snapshot.approvalsGiven.map((a) => (
                <div key={a.userId} className="flex items-center gap-1.5 rounded-lg border border-leaf/25 bg-leaf/[0.04] px-2 py-1">
                  <Check size={10} className="text-leaf shrink-0" />
                  <span className="text-[10px] text-leaf/90 truncate">{a.userName}</span>
                </div>
              ))}
              {outstanding.map((id) => (
                <div key={id} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-3 px-2 py-1">
                  <span className="w-2.5 h-2.5 rounded-full border border-line-2 shrink-0" />
                  <span className="text-[10px] text-faint/80 truncate">approval still outstanding</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DecisionReplay({
  decision,
  onClose,
}: {
  decision: Decision;
  onClose: () => void;
}) {
  const replay = useStore((s) => s.decisionReplay);
  const fetchDecisionReplay = useStore((s) => s.fetchDecisionReplay);
  const busy = useStore((s) => s.decisionReplayBusy);
  const [index, setIndex] = useState(0);

  // The events and states come straight off the store — the server's fold, not
  // a client re-derivation. Fetched on open so the overlay always starts from
  // the current stream, and dropped on close by the caller.
  useEffect(() => {
    fetchDecisionReplay(decision.id);
  }, [decision.id, fetchDecisionReplay]);

  const events: TimelineEvent[] = replay?.events ?? [];
  const snapshots: ReplaySnapshot[] = replay?.snapshots ?? [];

  const count = events.length;
  const clamped = count > 0 ? Math.min(index, count - 1) : 0;
  const event = count > 0 ? events[clamped] : null;
  const snapshot = count > 0 ? snapshots[clamped] : null;

  const step = (delta: number): void => {
    if (count === 0) return;
    setIndex((i) => Math.max(0, Math.min(count - 1, i + delta)));
  };

  // Arrow keys walk the timeline; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, onClose]);

  const Icon = event ? (KIND_ICON[event.kind] ?? History) : History;
  const tone = event ? (KIND_TONE[event.kind] ?? 'text-faint') : 'text-faint';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fadeIn"
        onClick={onClose}
      >
        <div
          className="w-full max-w-[960px] h-[min(88vh, 760px)] flex flex-col rounded-2xl bg-panel-2 border border-line-2 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-line">
            <Scale size={15} className="text-leaf shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Decision replay</p>
              <p className="text-sm font-semibold text-cream truncate">{decision.title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X size={15} />
            </button>
          </div>

          {busy && count === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
              <div className="w-6 h-6 rounded-full border-2 border-line-2 border-t-ember animate-spin" />
              <p className="text-[11px] text-faint">Rebuilding the timeline…</p>
            </div>
          ) : count === 0 ? (
            <EmptyState />
          ) : (
            <>
              {/* Body: rail + state */}
              <div className="flex-1 min-h-0 grid grid-cols-[300px_1fr] divide-x divide-line">
                {/* Rail */}
                <div className="min-h-0 overflow-y-auto py-2 px-2 space-y-0.5">
                  {events.map((e, i) => (
                    <EventRow
                      key={e.id}
                      event={e}
                      index={i}
                      active={i === clamped}
                      onClick={() => setIndex(i)}
                    />
                  ))}
                </div>
                {/* State at this point */}
                <div className="min-h-0 overflow-y-auto p-4 space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border border-line bg-panel-3 p-3">
                    <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-panel-2 border border-line-2">
                      <Icon size={15} className={tone} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-cream">{event.title}</p>
                      <p className="text-[11px] text-sand leading-relaxed mt-0.5">{event.detail}</p>
                      <p className="text-[9.5px] font-mono text-faint/70 mt-1">
                        {formatAt(event.at)} · {event.actorName}
                      </p>
                    </div>
                  </div>
                  {snapshot && <SnapshotPanel snapshot={snapshot} />}
                </div>
              </div>

              {/* Scrubber */}
              <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-t border-line bg-panel-2">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={clamped === 0}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-line text-sand hover:text-cream hover:border-line-2 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous event (←)"
                >
                  <ChevronLeft size={15} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={count - 1}
                  step={1}
                  value={clamped}
                  onChange={(e) => setIndex(Number(e.target.value))}
                  className="flex-1 accent-ember h-1.5 cursor-pointer"
                  aria-label="Replay position"
                />
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={clamped === count - 1}
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-line text-sand hover:text-cream hover:border-line-2 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next event (→)"
                >
                  <ChevronRight size={15} />
                </button>
                <span className="shrink-0 text-[10.5px] font-mono text-faint tabular-nums w-16 text-right">
                  {clamped + 1} / {count}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}

