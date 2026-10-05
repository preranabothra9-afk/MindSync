import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Check, Trash2, Reply, ScrollText } from 'lucide-react';
import type { DiscussionComment, ContradictionVote, ContradictionVoteChoice, ClaimRelation, Evidence, EvidenceKind } from '../types';

const KIND_LABEL: Record<EvidenceKind, string> = {
  url: 'link',
  file: 'file',
  quote: 'quote',
  user: 'note',
  ai: 'AI reference',
};

interface Props {
  relationId: string;
  /** True when the viewer may close the contradiction (workspace owner or admin). */
  canResolve: boolean;
  /** Called when the viewer picks reply on a comment; the composer lives in the panel. */
  onReply?: (comment: DiscussionComment) => void;
}

const CHOICES: { key: ContradictionVoteChoice; label: string }[] = [
  { key: 'CLAIM_A', label: 'Claim A is correct' },
  { key: 'CLAIM_B', label: 'Claim B is correct' },
  { key: 'NEITHER', label: 'Neither / need more evidence' },
];

/** Small avatar: letter badge, or an image when the avatar is a URL. */
function Avatar({ name, avatar }: { name: string; avatar: string }) {
  if (avatar && avatar.startsWith('http')) {
    return <img src={avatar} alt={name} className="w-5 h-5 rounded-full object-cover shrink-0" />;
  }
  const initials = (avatar && avatar.length > 0 ? avatar : name).slice(0, 2).toUpperCase();
  return (
    <span className="w-5 h-5 rounded-full bg-ember/15 border border-ember/30 text-ember-soft text-[9px] font-bold flex items-center justify-center shrink-0">
      {initials}
    </span>
  );
}

function CommentRow({
  comment,
  isReply,
  canDelete,
  onReply,
  onDelete,
}: {
  comment: DiscussionComment;
  isReply: boolean;
  canDelete: boolean;
  onReply?: (comment: DiscussionComment) => void;
  onDelete: (commentId: string) => void;
}) {
  return (
    <div className={`group relative rounded-lg px-2 py-1.5 ${isReply ? 'ml-5 bg-line/30' : 'bg-line/20'}`}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Avatar name={comment.authorName} avatar={comment.authorAvatar} />
        <span className="text-[10px] font-semibold text-sand truncate">{comment.authorName}</span>
        <span className="text-[9px] font-mono text-faint shrink-0">
          {new Date(comment.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="text-xs text-sand leading-relaxed break-words whitespace-pre-wrap pr-1">{comment.text}</p>
      <div className="flex items-center gap-2 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onReply && (
          <button
            type="button"
            onClick={() => onReply(comment)}
            className="flex items-center gap-0.5 text-[10px] text-faint hover:text-cream transition-colors cursor-pointer"
          >
            <Reply size={10} /> Reply
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(comment.id)}
            title="Delete this comment"
            className="flex items-center gap-0.5 text-[10px] text-faint hover:text-rust transition-colors cursor-pointer"
          >
            <Trash2 size={10} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The human side of one contradiction: a room poll (Claim A / Claim B / Neither)
 * and an open comment thread with replies.
 *
 * The poll is advisory signal only — its tallies never close the contradiction.
 * Closing is an explicit act by an authorized human, who must record a reason.
 */
export default function ContradictionDiscussion({ relationId, canResolve, onReply }: Props) {
  const user = useStore((s) => s.user);
  const relation = useStore((s) => s.relations.find((r) => r.id === relationId)) as ClaimRelation | undefined;
  const discussion = useStore((s) => s.discussions[relationId]);
  const fetchDiscussion = useStore((s) => s.fetchDiscussion);
  const castContradictionVote = useStore((s) => s.castContradictionVote);
  const deleteContradictionComment = useStore((s) => s.deleteContradictionComment);
  const resolveContradiction = useStore((s) => s.resolveContradiction);
  const evidenceMap = useStore((s) => s.evidence);
  const fetchEvidenceForRelation = useStore((s) => s.fetchEvidenceForRelation);

  const [resolution, setResolution] = useState('');
  const [confirming, setConfirming] = useState<'resolved' | 'evidence-needed' | 'dismissed' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Evidence the closer has chosen to cite in the decision. */
  const [citedIds, setCitedIds] = useState<string[]>([]);
  /** Refusal reason from the server, shown inline instead of failing silently. */
  const [closeError, setCloseError] = useState<string | null>(null);

  // Load the thread + tally when this contradiction is opened, and the evidence
  // on both sides so the closer can cite it while deciding.
  useEffect(() => {
    fetchDiscussion(relationId);
    fetchEvidenceForRelation(relationId);
  }, [relationId, fetchDiscussion, fetchEvidenceForRelation]);

  const comments = discussion?.comments ?? [];
  const votes = discussion?.votes ?? [];
  const myVote = votes.find((v) => v.userId === user?.id);
  const totalVotes = votes.length;

  const topLevel = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  const reasonTooShort = resolution.trim().length < 3;

  // The evidence the room can point at while closing: everything attached to
  // either side of the pair, tagged with the side it backs.
  const evidenceA = relation ? evidenceMap[relation.claimAId] ?? [] : [];
  const evidenceB = relation ? evidenceMap[relation.claimBId] ?? [] : [];
  const citeable = [
    ...evidenceA.map((e) => ({ ...e, side: 'A' as const })),
    ...evidenceB.map((e) => ({ ...e, side: 'B' as const })),
  ];

  const toggleCite = (id: string) => {
    setCitedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleClose = async (status: 'resolved' | 'evidence-needed' | 'dismissed') => {
    if (reasonTooShort || submitting) return;
    setSubmitting(true);
    setCloseError(null);
    const err = await resolveContradiction(relationId, status, resolution.trim(), citedIds);
    setSubmitting(false);
    if (err) {
      setCloseError(err);
      return;
    }
    setResolution('');
    setCitedIds([]);
    setConfirming(null);
  };

  // Any status other than 'detected' is a closed state — including
  // 'evidence-needed', which closes without picking a winning claim.
  const closed = relation ? relation.status !== 'detected' : false;

  // The evidence an authorized human cited when closing. Ids whose evidence was
  // since deleted are absent from the map and drop out here, so the record
  // never displays a citation that no longer resolves.
  const citedItems = (relation?.citedEvidenceIds ?? [])
    .map((id) => citeable.find((e) => e.id === id))
    .filter((e): e is Evidence & { side: 'A' | 'B' } => !!e);

  return (
    <div className="space-y-3">
      {/* Resolution record: who closed it, when, and why. */}
      {closed && relation && (
        <div className="rounded-xl border border-line-2 bg-line/40 p-2.5 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                relation.status === 'resolved'
                  ? 'bg-ember/10 border-ember/30 text-ember-soft'
                  : relation.status === 'evidence-needed'
                  ? 'bg-amber-500/15 border-amber-500/40 text-warn'
                  : 'bg-line border-line-2 text-faint'
              }`}
            >
              {relation.status === 'evidence-needed' ? 'evidence needed' : relation.status}
            </span>
            {relation.resolvedAt && (
              <span className="text-[10px] font-mono text-faint">
                {new Date(relation.resolvedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-xs text-sand leading-relaxed">{relation.resolution}</p>
          {citedItems.length > 0 && (
            <div className="pt-1 space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-faint">Evidence cited in the decision</p>
              {citedItems.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-1.5 text-[10px] rounded-md border px-1.5 py-1 ${
                    item.aiGenerated ? 'bg-cat-violet/[0.06] border-cat-violet/25' : 'bg-panel-2 border-line'
                  }`}
                >
                  <ScrollText size={10} className="text-faint shrink-0" />
                  <span className="text-sand truncate">{item.title}</span>
                  <span className="font-mono text-faint shrink-0">claim {item.side}</span>
                  {item.aiGenerated && (
                    <span
                      title="AI-generated references are unverified — a model's reading, not proof"
                      className="font-bold text-cat-violet shrink-0"
                    >
                      · unverified
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-faint">Closed by {relation.resolvedByName ?? 'an authorized member'}</p>
        </div>
      )}

      {/* Poll */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Room poll</p>
          <span className="text-[10px] font-mono text-faint">
            {totalVotes} vote{totalVotes === 1 ? '' : 's'}
          </span>
        </div>
        {CHOICES.map(({ key, label }) => {
          const count = votes.filter((v) => v.choice === key).length;
          const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
          const mine = myVote?.choice === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => castContradictionVote(relationId, key)}
              title={mine ? 'Your vote — click again to change it' : 'Vote for this option'}
              className={`relative w-full text-left rounded-lg border overflow-hidden transition-colors cursor-pointer ${
                mine ? 'border-ember/50 bg-ember/[0.14]' : 'border-line bg-panel-2 hover:border-line-2'
              }`}
            >
              {/* Tally fill sits behind the label. */}
              <span className="absolute inset-y-0 left-0 bg-ember/10 transition-all" style={{ width: `${pct}%` }} />
              <span className="relative flex items-center gap-1.5 px-2 py-1.5">
                {mine && <Check size={11} className="text-ember-soft shrink-0" />}
                <span className="text-[11px] font-medium text-sand truncate">{label}</span>
                <span className="ml-auto text-[10px] font-mono text-faint shrink-0">{count}</span>
              </span>
            </button>
          );
        })}
        <p className="text-[10px] text-faint/70 leading-relaxed italic">
          The poll never closes a contradiction — only an authorized human can.
        </p>
      </div>

      {/* Close controls: owner or admin, and only while still open. */}
      {canResolve && !closed && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Close this contradiction</p>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Record the decision and the reason it was reached…"
            rows={2}
            maxLength={500}
            className="w-full text-xs rounded-lg bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2 py-1.5 resize-none focus:outline-none focus:border-ember/40 transition-colors"
          />
          {closeError && (
            <p className="text-[10px] text-rust leading-relaxed bg-rust/10 border border-rust/30 rounded-md px-2 py-1">
              {closeError}
            </p>
          )}
          {citeable.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                Cite evidence in the decision <span className="font-mono text-faint/70">({citedIds.length} selected)</span>
              </p>
              <div className="flex flex-wrap gap-1">
                {citeable.map((item) => {
                  const on = citedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleCite(item.id)}
                      title={`${item.title} — ${KIND_LABEL[item.kind]} for claim ${item.side}${item.aiGenerated ? ' (AI-generated, unverified)' : ''}`}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border transition-colors cursor-pointer ${
                        on
                          ? 'bg-ember/15 border-ember/40 text-ember-soft'
                          : 'bg-transparent border-line/50 text-faint hover:text-cream hover:border-line-2'
                      }`}
                    >
                      {on && <Check size={8} className="shrink-0" />}
                      <span className="truncate max-w-[110px]">{item.title}</span>
                      <span className="font-mono opacity-70 shrink-0">{item.side}</span>
                      {item.aiGenerated && (
                        <span
                          title="AI-generated reference — unverified"
                          className="text-cat-violet shrink-0"
                        >
                          ·AI
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-faint/70 leading-relaxed">
                Cited evidence is recorded with the decision. AI references stay labelled unverified.
              </p>
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={reasonTooShort || submitting}
              onClick={() => {
                if (confirming !== 'resolved') {
                  setConfirming('resolved');
                  return;
                }
                handleClose('resolved');
              }}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                confirming === 'resolved'
                  ? 'bg-ember/15 border-ember/40 text-ember-soft'
                  : 'bg-transparent border-line/50 text-faint hover:text-ember-soft hover:border-ember/40'
              }`}
            >
              {confirming === 'resolved' ? 'Confirm resolve?' : 'Resolve'}
            </button>
            <button
              type="button"
              disabled={reasonTooShort || submitting}
              onClick={() => {
                if (confirming !== 'evidence-needed') {
                  setConfirming('evidence-needed');
                  return;
                }
                handleClose('evidence-needed');
              }}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                confirming === 'evidence-needed'
                  ? 'bg-amber-500/15 border-amber-500/40 text-warn'
                  : 'bg-transparent border-line/50 text-faint hover:text-warn hover:border-amber-500/40'
              }`}
            >
              {confirming === 'evidence-needed' ? 'Confirm?' : 'Evidence needed'}
            </button>
            <button
              type="button"
              disabled={reasonTooShort || submitting}
              onClick={() => {
                if (confirming !== 'dismissed') {
                  setConfirming('dismissed');
                  return;
                }
                handleClose('dismissed');
              }}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                confirming === 'dismissed'
                  ? 'bg-rust/15 border-rust/40 text-rust'
                  : 'bg-transparent border-line/50 text-faint hover:text-rust hover:border-rust/40'
              }`}
            >
              {confirming === 'dismissed' ? 'Confirm dismiss?' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
      {!canResolve && !closed && (
        <p className="text-[10px] text-faint/70 leading-relaxed italic">
          Only the workspace owner or an admin can resolve or dismiss this contradiction.
        </p>
      )}

      {/* Discussion thread */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          Discussion · {topLevel.length}
        </p>
        {topLevel.length === 0 && (
          <p className="text-[11px] text-faint/70 leading-relaxed py-1">
            No comments yet. Have the room weigh in on which claim holds up.
          </p>
        )}
        {topLevel.map((comment) => (
          <div key={comment.id} className="space-y-1">
            <CommentRow
              comment={comment}
              isReply={false}
              canDelete={canResolve || comment.authorId === user?.id}
              onReply={onReply}
              onDelete={(id) => deleteContradictionComment(relationId, id)}
            />
            {repliesOf(comment.id).map((reply) => (
              <CommentRow
                key={reply.id}
                comment={reply}
                isReply
                canDelete={canResolve || reply.authorId === user?.id}
                onReply={onReply}
                onDelete={(id) => deleteContradictionComment(relationId, id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
