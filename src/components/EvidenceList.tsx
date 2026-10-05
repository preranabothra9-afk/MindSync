import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import type { EvidenceInput } from '../store';
import {
  Link as LinkIcon,
  FileText,
  Quote,
  PenLine,
  Sparkles,
  Trash2,
  Loader2,
  ExternalLink,
  Download,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import type { Evidence, EvidenceKind } from '../types';

/**
 * Largest file accepted, kept in step with the server's cap so the client
 * refuses an oversized upload before spending the request.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface AttachKind {
  key: Exclude<EvidenceKind, 'ai'>;
  label: string;
  icon: typeof LinkIcon;
}

const ATTACH_KINDS: AttachKind[] = [
  { key: 'url', label: 'Link', icon: LinkIcon },
  { key: 'file', label: 'File', icon: FileText },
  { key: 'quote', label: 'Quote', icon: Quote },
  { key: 'user', label: 'Note', icon: PenLine },
];

const KIND_ICON: Record<EvidenceKind, typeof LinkIcon> = {
  url: LinkIcon,
  file: FileText,
  quote: Quote,
  user: PenLine,
  ai: Sparkles,
};

/** Formats a byte count the way the rest of the workspace shows file sizes. */
function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface Props {
  claimId: string;
  /**
   * Compact rendering for a contradiction's detail view, where both sides of the
   * pair are shown at once and space is tight.
   */
  compact?: boolean;
  /**
   * Whether the viewer may attach or delete evidence here. Evidence is open to
   * workspace members, mirroring the discussion rules; read-only viewers see
   * the list without the affordances.
   */
  canContribute?: boolean;
}

/**
 * The evidence attached to one claim: links, files, quotes, a member's own
 * notes, and AI-generated references. Shown inside a claim's detail view and
 * inside a contradiction's, where both sides sit side by side so the room can
 * weigh them while deciding.
 *
 * AI references are labelled unverified for their whole life. They are only ever
 * a model's reading of the response the claim came from — never proof — and the
 * generator verifies their quote is verbatim before storing them.
 */
export default function EvidenceList({ claimId, compact = false, canContribute = true }: Props) {
  const evidence = useStore((s) => s.evidence[claimId]);
  const fetchEvidence = useStore((s) => s.fetchEvidence);
  const attachEvidence = useStore((s) => s.attachEvidence);
  const generateAiEvidence = useStore((s) => s.generateAiEvidence);
  const deleteEvidence = useStore((s) => s.deleteEvidence);
  const user = useStore((s) => s.user);
  const activeWorkspace = useStore((s) => s.activeWorkspace);

  const [activeKind, setActiveKind] = useState<AttachKind['key'] | null>(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<{ name: string; type: string; size: number; data: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchEvidence(claimId);
  }, [claimId, fetchEvidence]);

  const moderator = !!(activeWorkspace && user && (activeWorkspace.ownerId === user.id || user.role === 'admin'));

  const resetForm = () => {
    setActiveKind(null);
    setTitle('');
    setUrl('');
    setExcerpt('');
    setSource('');
    setFile(null);
    setError(null);
  };

  const handleFileChosen = (chosen: File) => {
    if (chosen.size > MAX_FILE_BYTES) {
      setError(`Files are limited to ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    setError(null);
    const reader = new FileReader();
    // The bytes travel inline as a data URI — the same convention the message
    // schema uses — because there is no separate upload service to hand them to.
    reader.onload = () => {
      setFile({
        name: chosen.name,
        type: chosen.type || 'application/octet-stream',
        size: chosen.size,
        data: reader.result as string,
      });
      if (!title.trim()) setTitle(chosen.name);
    };
    reader.onerror = () => setError('Could not read that file. Please try another.');
    reader.readAsDataURL(chosen);
  };

  const buildInput = (): EvidenceInput | null => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Give the evidence a short title.');
      return null;
    }
    if (activeKind === 'url') {
      const trimmed = url.trim();
      if (!trimmed) {
        setError('Paste the link this evidence points to.');
        return null;
      }
      return { kind: 'url', title: trimmedTitle, url: trimmed };
    }
    if (activeKind === 'quote') {
      const trimmedExcerpt = excerpt.trim();
      if (trimmedExcerpt.length < 3) {
        setError('Quote the excerpt this evidence is drawn from.');
        return null;
      }
      return { kind: 'quote', title: trimmedTitle, excerpt: trimmedExcerpt, source: source.trim() || undefined };
    }
    if (activeKind === 'user') {
      const trimmedExcerpt = excerpt.trim();
      if (trimmedExcerpt.length < 3) {
        setError('Write the evidence you are contributing.');
        return null;
      }
      return { kind: 'user', title: trimmedTitle, excerpt: trimmedExcerpt };
    }
    if (activeKind === 'file') {
      if (!file) {
        setError('Choose a file to attach.');
        return null;
      }
      return {
        kind: 'file',
        title: trimmedTitle,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        data: file.data,
      };
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const input = buildInput();
    if (!input) return;
    setBusy(true);
    setError(null);
    const failure = await attachEvidence(claimId, input);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    resetForm();
  };

  const handleAskAi = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setError(null);
    setNote(null);
    const failure = await generateAiEvidence(claimId);
    setAiBusy(false);
    if (failure) {
      // A refusal is informative, not a crash: the model may honestly find no
      // support in the source, and that is the right outcome to report.
      setError(failure);
    } else {
      setNote('Reference created. It is labelled unverified — confirm it against the source before relying on it.');
    }
  };

  const handleDelete = (item: Evidence) => {
    deleteEvidence(claimId, item.id);
  };

  const pad = compact ? 'px-2 py-1.5' : 'px-2.5 py-2';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-faint">Evidence</p>
        <span className="text-[10px] font-mono text-faint/80">{evidence?.length ?? 0}</span>
        {canContribute && (
          <div className="ml-auto flex items-center gap-0.5">
            {ATTACH_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => { setActiveKind(activeKind === k.key ? null : k.key); setError(null); }}
                title={`Attach a ${k.label.toLowerCase()}`}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                  activeKind === k.key
                    ? 'bg-ember/15 border-ember/40 text-ember-soft'
                    : 'bg-transparent border-line/50 text-faint hover:text-cream hover:border-line-2'
                }`}
              >
                <k.icon size={10} />
                {k.label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleAskAi}
              disabled={aiBusy}
              title="Ask the AI to ground this claim in its source response"
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border bg-cat-violet/10 border-cat-violet/30 text-cat-violet hover:bg-cat-violet/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiBusy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              AI
            </button>
          </div>
        )}
      </div>

      {note && (
        <div className="flex items-start gap-1.5 text-[10px] text-ember-soft bg-ember/10 border border-ember/25 rounded-md px-2 py-1.5 leading-relaxed">
          <CheckCircle2 size={11} className="mt-px shrink-0" />
          <span>{note}</span>
          <button
            type="button"
            onClick={() => setNote(null)}
            className="ml-auto text-faint hover:text-cream cursor-pointer shrink-0"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[10px] text-rust bg-rust/10 border border-rust/25 rounded-md px-2 py-1.5 leading-relaxed">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {canContribute && activeKind && (
        <form onSubmit={handleSubmit} className="space-y-1.5 bg-line/25 border border-line rounded-lg p-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short title for this evidence"
            maxLength={120}
            className="w-full text-[11px] rounded-md bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2 py-1.5 focus:outline-none focus:border-ember/40 transition-colors"
          />

          {activeKind === 'url' && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/source"
              maxLength={2048}
              className="w-full text-[11px] rounded-md bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2 py-1.5 focus:outline-none focus:border-ember/40 transition-colors"
            />
          )}

          {(activeKind === 'quote' || activeKind === 'user') && (
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder={activeKind === 'quote' ? 'The excerpt being quoted, verbatim…' : 'The evidence you are contributing…'}
              maxLength={2000}
              rows={3}
              className="w-full text-[11px] rounded-md bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2 py-1.5 focus:outline-none focus:border-ember/40 transition-colors resize-none leading-relaxed"
            />
          )}

          {activeKind === 'quote' && (
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Who or what is the quote attributed to? (optional)"
              maxLength={200}
              className="w-full text-[11px] rounded-md bg-panel-2 border border-line text-sand placeholder:text-faint/60 px-2 py-1.5 focus:outline-none focus:border-ember/40 transition-colors"
            />
          )}

          {activeKind === 'file' && (
            <div className="space-y-1.5">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); e.target.value = ''; }}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center gap-1.5 text-[10px] bg-panel-2 border border-line rounded-md px-2 py-1.5">
                  <FileText size={11} className="text-ember-soft shrink-0" />
                  <span className="truncate text-sand">{file.name}</span>
                  <span className="font-mono text-faint shrink-0">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="ml-auto text-faint hover:text-rust cursor-pointer shrink-0"
                    title="Remove the file"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-1.5 text-[10px] font-medium text-faint hover:text-cream bg-panel-2 border border-dashed border-line-2 rounded-md px-2 py-2.5 transition-colors cursor-pointer"
                >
                  <FileText size={11} />
                  Choose a file — up to {Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB, stored inline
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-ember/15 border border-ember/30 text-ember-soft hover:bg-ember/25 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={10} className="animate-spin" /> : null}
              Attach
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-2 py-1 rounded-md text-[10px] font-medium text-faint hover:text-cream transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {evidence && evidence.length > 0 ? (
        <div className="space-y-1">
          {evidence.map((item) => {
            const Icon = KIND_ICON[item.kind];
            const canDelete = canContribute && (moderator || (item.authorId && user?.id === item.authorId));
            return (
              <div
                key={item.id}
                className={`group relative rounded-lg border bg-panel-2/60 ${pad} ${
                  item.aiGenerated ? 'border-cat-violet/30' : 'border-line'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={11} className={item.aiGenerated ? 'text-cat-violet shrink-0' : 'text-ember-soft shrink-0'} />
                  <p className="text-[11px] font-semibold text-cream truncate">{item.title}</p>
                  {item.aiGenerated && (
                    <span
                      title="This reference was generated by an AI model from the claim's source response. It has not been verified by anyone — confirm it against the source before relying on it."
                      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-cat-violet/10 border border-cat-violet/30 text-cat-violet text-[9px] font-bold shrink-0"
                    >
                      <ShieldAlert size={8} />
                      AI · unverified
                    </span>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      title={item.aiGenerated ? 'Remove this AI reference (owner or admin)' : 'Delete this evidence'}
                      className="ml-auto p-0.5 rounded text-faint opacity-0 group-hover:opacity-100 hover:text-rust hover:bg-rust/10 transition-all cursor-pointer shrink-0"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>

                {item.kind === 'url' && (
                  <a
                    href={item.url as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-ember-soft hover:text-ember transition-colors"
                  >
                    <ExternalLink size={9} className="shrink-0" />
                    <span className="truncate">{hostOf(item.url)}</span>
                  </a>
                )}

                {item.kind === 'file' && (
                  <a
                    href={item.data as string}
                    download={item.fileName as string}
                    className="flex items-center gap-1 text-[10px] text-ember-soft hover:text-ember transition-colors"
                  >
                    <Download size={9} className="shrink-0" />
                    <span className="truncate">{item.fileName}</span>
                    {item.sizeBytes ? <span className="font-mono text-faint shrink-0">{formatBytes(item.sizeBytes)}</span> : null}
                  </a>
                )}

                {(item.kind === 'quote' || item.kind === 'user' || item.kind === 'ai') && (
                  <>
                    <blockquote
                      className={`text-[10.5px] leading-relaxed text-sand border-l-2 pl-2 ${
                        item.aiGenerated ? 'border-cat-violet/40 bg-cat-violet/[0.04]' : 'border-line-2 bg-line/20'
                      } rounded-r py-1 px-1.5`}
                    >
                      {item.excerpt}
                    </blockquote>
                    {item.kind === 'quote' && item.source && (
                      <p className="text-[9px] text-faint italic mt-1">— {item.source}</p>
                    )}
                    {item.aiGenerated && (
                      <p className="text-[9px] text-faint/80 mt-1 leading-relaxed">
                        Generated by {item.modelName || 'a language model'} from this claim's source response. A model's reading, not proof — the room decides what it is worth.
                      </p>
                    )}
                  </>
                )}

                <p className="text-[9px] font-mono text-faint/70 mt-1">
                  {item.aiGenerated
                    ? 'AI reference'
                    : item.authorName
                      ? item.authorName
                      : 'member'}
                  {' · '}
                  {new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </p>
              </div>
            );
          })}
        </div>
      ) : evidence ? (
        <p className="text-[10px] text-faint/70 leading-relaxed px-0.5">
          Nothing backing this claim yet. {canContribute ? 'Attach a link, file, quote, or note — or ask the AI for a reference.' : ''}
        </p>
      ) : (
        <p className="text-[10px] text-faint/70 leading-relaxed px-0.5">Loading evidence…</p>
      )}
    </div>
  );
}
