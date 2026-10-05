import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import {
  FileText,
  X,
  Sparkles,
  Quote,
  Paperclip,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Users,
  ThumbsUp,
  Lightbulb,
} from 'lucide-react';
import type { DecisionSummary } from '../types';
import Portal from '../hooks/Portal';

/* ──────────────────────────────────────────────────────────────────────── *
 * The final decision summary.
 *
 * Every section below renders fields the server read off the room's stored
 * record — the decision, its claims, the evidence pinned to them, the
 * contradictions between them, and the approvals on the decision itself. The
 * optional narrative is a model restating those fields under a strict
 * no-invention instruction; it is labelled a restatement, never the record,
 * and the sections remain authoritative.
 * ──────────────────────────────────────────────────────────────────────── */

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof FileText;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} className="text-faint shrink-0" />
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-faint">{title}</h3>
        {count !== undefined && (
          <span className="ml-auto text-[10px] font-mono text-faint">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-[11px] text-faint/70 leading-relaxed italic">{label}</p>;
}

const STATUS_LABEL: Record<string, string> = {
  detected: 'still open',
  resolved: 'resolved',
  'evidence-needed': 'closed pending more evidence',
  dismissed: 'dismissed',
};

export default function DecisionSummaryView({
  decisionId,
  decisionTitle,
  onClose,
}: {
  decisionId: string;
  decisionTitle: string;
  onClose: () => void;
}) {
  const summary = useStore((s) => s.decisionSummary);
  const fetch = useStore((s) => s.fetchDecisionSummary);
  const busy = useStore((s) => s.decisionReplayBusy);
  const [narrating, setNarrating] = useState(false);

  useEffect(() => {
    fetch(decisionId);
  }, [decisionId, fetch]);

  const onNarrate = (): void => {
    setNarrating(true);
    fetch(decisionId, true).finally(() => setNarrating(false));
  };

  const s: DecisionSummary | null = summary && summary.decisionId === decisionId ? summary : null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fadeIn"
        onClick={onClose}
      >
        <div
          className="w-full max-w-[680px] h-[min(88vh, 820px)] flex flex-col rounded-2xl bg-panel-2 border border-line-2 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center gap-2.5 px-4 py-3 border-b border-line">
            <FileText size={15} className="text-leaf shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Final decision summary</p>
              <p className="text-sm font-semibold text-cream truncate">{decisionTitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-faint hover:text-cream hover:bg-line transition-colors cursor-pointer"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          {!s ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              {busy || narrating ? (
                <>
                  <div className="w-6 h-6 rounded-full border-2 border-line-2 border-t-ember animate-spin" />
                  <p className="text-[11px] text-faint">
                    {narrating ? 'Asking the model to restate the record…' : 'Assembling the summary…'}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-faint">No summary is available for this decision.</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
                {/* Question + conclusion */}
                <div className="space-y-3">
                  <div className="rounded-xl border border-ember/30 bg-ember/[0.05] p-3">
                    <p className="text-[9.5px] font-bold uppercase tracking-wide text-ember-soft mb-1">The question</p>
                    <p className="text-[13px] font-semibold text-cream leading-snug">{s.question}</p>
                    {s.roomTitle && (
                      <p className="text-[10px] text-faint mt-1">in the room “{s.roomTitle}”</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-line bg-panel-3 p-3">
                    <p className="text-[9.5px] font-bold uppercase tracking-wide text-faint mb-1">The conclusion</p>
                    <p className="text-[12px] text-sand leading-relaxed">{s.conclusion}</p>
                    <p className="text-[10px] text-faint mt-1.5 italic">{s.conclusionNote}</p>
                  </div>
                </div>

                {/* Narrative */}
                <Section icon={Sparkles} title="AI restatement">
                  {s.narrative ? (
                    <div className="rounded-xl border border-sky-500/30 bg-sky-500/[0.05] p-3">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-sky-400 mb-1.5">
                        Restated by Gemini
                      </p>
                      <p className="text-[11.5px] text-sand leading-relaxed whitespace-pre-wrap">{s.narrative}</p>
                      <p className="text-[9.5px] text-faint/80 mt-2 italic">{s.narrativeNote}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-line bg-panel-3 p-3">
                      <p className="text-[10.5px] text-faint/85 leading-relaxed">
                        The sections below are the record. Optionally, Gemini can restate them as a short prose brief —
                        it is given only these fields and instructed to add nothing.
                      </p>
                      <button
                        type="button"
                        onClick={onNarrate}
                        disabled={narrating || busy}
                        className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[10.5px] font-semibold text-sky-400 hover:bg-sky-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Sparkles size={11} />
                        {narrating ? 'Restating…' : s.narrativeNote ? 'Try again' : 'Summarize with AI'}
                      </button>
                      {s.narrativeNote && !s.narrative && (
                        <p className="text-[9.5px] text-faint/80 mt-1.5 italic">{s.narrativeNote}</p>
                      )}
                    </div>
                  )}
                </Section>

                <div className="h-px bg-line" />

                {/* Key claims */}
                <Section icon={Quote} title="Key claims" count={s.keyClaims.length}>
                  {s.keyClaims.length === 0 ? (
                    <Empty label="No claims are linked to this decision." />
                  ) : (
                    <div className="space-y-1.5">
                      {s.keyClaims.map((c) => (
                        <div key={c.id} className="flex items-start gap-2 rounded-lg border border-line bg-panel-3 px-2.5 py-1.5">
                          <span className="text-[9.5px] font-semibold text-ember-soft shrink-0 mt-0.5">{c.modelName}</span>
                          <span className="text-[11px] text-sand leading-snug">{c.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Evidence */}
                <Section icon={Paperclip} title="Evidence" count={s.evidence.length}>
                  {s.evidence.length === 0 ? (
                    <Empty label="No person attached evidence to the linked claims." />
                  ) : (
                    <div className="space-y-1.5">
                      {s.evidence.map((e) => (
                        <div key={e.id} className="rounded-lg border border-leaf/25 bg-leaf/[0.04] px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10.5px] font-semibold text-leaf truncate">{e.title}</span>
                            <span className="shrink-0 text-[8.5px] font-bold px-1 py-0.5 rounded bg-panel-3 border border-line text-faint uppercase">
                              {e.kind}
                            </span>
                          </div>
                          <p className="text-[9.5px] text-faint mt-0.5">
                            attached by {e.authorName ?? 'a member'} to “{e.claimText}”
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Disagreements + resolutions */}
                <Section icon={AlertTriangle} title="Disagreements and resolutions" count={s.disagreements.length}>
                  {s.disagreements.length === 0 ? (
                    <Empty label="The detector never flagged a contradiction among the linked claims." />
                  ) : (
                    <div className="space-y-1.5">
                      {s.disagreements.map((d) => (
                        <div
                          key={d.id}
                          className={`rounded-lg border px-2.5 py-1.5 ${
                            d.status === 'detected'
                              ? 'border-rust/35 bg-rust/[0.05]'
                              : 'border-leaf/25 bg-leaf/[0.04]'
                          }`}
                        >
                          <p className="text-[10.5px] text-sand leading-snug">
                            “{d.claimAText}” <span className="font-bold text-faint">vs</span> “{d.claimBText}”
                          </p>
                          <p className="text-[9.5px] mt-0.5 leading-snug">
                            <span
                              className={`font-bold ${
                                d.status === 'detected' ? 'text-rust' : 'text-leaf'
                              }`}
                            >
                              {STATUS_LABEL[d.status] ?? d.status}
                            </span>
                            {d.resolvedByName ? ` by ${d.resolvedByName}` : ''}
                            {d.resolution ? ` — “${d.resolution}”` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Assumptions */}
                <Section icon={Lightbulb} title="Assumptions" count={s.assumptions.length}>
                  {s.assumptions.length === 0 ? (
                    <Empty label="Every linked claim carries human evidence — nothing is being taken on trust." />
                  ) : (
                    <div className="space-y-1.5">
                      {s.assumptions.map((a, i) => (
                        <div key={i} className="rounded-lg border border-ember/25 bg-ember/[0.04] px-2.5 py-1.5">
                          <p className="text-[10.5px] text-sand leading-snug">{a}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                {/* Remaining uncertainties */}
                <Section icon={HelpCircle} title="Remaining uncertainties" count={s.remainingUncertainties.length}>
                  {s.remainingUncertainties.length === 0 ? (
                    <Empty label="Nothing is left open — the gate is satisfied." />
                  ) : (
                    <div className="space-y-1.5">
                      {s.remainingUncertainties.map((u, i) => (
                        <div key={i} className="rounded-lg border border-rust/30 bg-rust/[0.04] px-2.5 py-1.5">
                          <p className="text-[10.5px] text-rust/90 leading-snug">{u}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <div className="h-px bg-line" />

                {/* Participants + approvals */}
                <div className="grid grid-cols-2 gap-4">
                  <Section icon={Users} title="Participants" count={s.participants.length}>
                    {s.participants.length === 0 ? (
                      <Empty label="No participants recorded." />
                    ) : (
                      <div className="space-y-1">
                        {s.participants.map((p) => (
                          <div key={p.id} className="flex items-baseline gap-1.5">
                            <span className="text-[10.5px] font-medium text-sand truncate">{p.name}</span>
                            <span className="text-[9px] text-faint/80 leading-snug">— {p.role}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                  <Section icon={ThumbsUp} title="Approvals" count={s.approvalsGiven.length}>
                    {s.approvalsGiven.length === 0 && s.approvalsOutstanding.length === 0 ? (
                      <Empty label="No approvers were required." />
                    ) : (
                      <div className="space-y-1">
                        {s.approvalsGiven.map((a) => (
                          <div key={a.userId} className="flex items-center gap-1.5">
                            <CheckCircle2 size={10} className="text-leaf shrink-0" />
                            <span className="text-[10.5px] text-leaf/90 truncate">{a.userName}</span>
                          </div>
                        ))}
                        {s.approvalsOutstanding.map((name) => (
                          <div key={name} className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full border border-line-2 shrink-0" />
                            <span className="text-[10.5px] text-faint/80 truncate">{name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}

