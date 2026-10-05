import { useStore } from '../store';
import { Hash, Users, BookmarkCheck, Cpu, Circle, Wifi, LayoutGrid, Globe } from 'lucide-react';
import SearchPanel from './SearchPanel';
import ClaimsPanel from './ClaimsPanel';
import DecisionPanel from './DecisionPanel';

const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5',
  'gpt-oss-120b': 'GPT-OSS 120B',
  'qwen3.8-27b': 'Qwen3.8 27B',
  'gpt-oss-20b': 'GPT-OSS 20B',
  'mistral-small': 'Mistral Small',
  'deepseek-r1': 'DeepSeek R1',
  'llama-3.3-70b': 'Llama 3.3 70B',
};

const MODEL_COLORS: Record<string, string> = {
  'gemini-2.5-flash': 'bg-blue-500/10 text-cat-blue border-blue-500/20',
  'gpt-oss-120b': 'bg-emerald-500/10 text-leaf border-emerald-500/20',
  'qwen3.8-27b': 'bg-violet-500/10 text-cat-violet border-violet-500/20',
  'gpt-oss-20b': 'bg-amber-500/10 text-warn border-amber-500/20',
  'mistral-small': 'bg-sky-500/10 text-cat-indigo border-sky-500/20',
  'deepseek-r1': 'bg-rose-500/10 text-rust border-rose-500/20',
  'llama-3.3-70b': 'bg-amber-500/10 text-warn border-amber-500/20',
};

export default function WorkspaceHeader() {
  // Fine-grained selectors — otherwise this header re-renders on every token
  // a model streams, since the store swaps `messages` per chunk.
  const activeConversation = useStore((s) => s.activeConversation);
  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const presence = useStore((s) => s.presence);
  const selectedModels = useStore((s) => s.selectedModels);
  const isSavedResponsesOpen = useStore((s) => s.isSavedResponsesOpen);
  const setSavedResponsesOpen = useStore((s) => s.setSavedResponsesOpen);
  const socketConnected = useStore((s) => s.socketConnected);
  const navigateTo = useStore((s) => s.navigateTo);

  const seen = new Set<string>();
  const online = presence.filter((p) => { if (seen.has(p.userId)) return false; seen.add(p.userId); return true; });

  return (
    <header className="shrink-0 flex items-center gap-3 px-4 sm:px-6 h-14 border-b border-line/60 bg-panel/70 backdrop-blur-md z-20">
      {/* Room Identity */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={() => navigateTo('/workspaces')}
          title="Back to all workspaces"
          className="w-8 h-8 rounded-lg bg-panel-2/60 border border-line/60 hover:border-ember/40 hover:text-ember flex items-center justify-center text-sand transition-all cursor-pointer shrink-0"
        >
          <LayoutGrid size={14} />
        </button>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-ember/15 to-ember/5 border border-ember/20 flex items-center justify-center text-ember shrink-0">
          <Hash size={14} />
        </div>
        <div className="leading-tight min-w-0">
          <p className="text-[13px] font-semibold text-cream truncate">{activeConversation?.title || 'No room selected'}</p>
          <p className="text-[13px] text-faint font-mono truncate">{activeWorkspace?.name || 'Workspace'}</p>
        </div>
      </div>

      {/* Model Chips */}
      {activeConversation && selectedModels.length > 0 && (
        <div className="hidden md:flex items-center gap-1.5 ml-2 pl-3 border-l border-line/60">
          <Cpu size={11} className="text-faint shrink-0" />
          {selectedModels.map((key) => (
            <span key={key} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[13px] font-mono font-semibold ${MODEL_COLORS[key] || 'bg-ember/10 text-ember border-ember/20'}`}>
              <Circle size={4} className="fill-current" />
              {MODEL_LABELS[key] || key}
              {key === 'gemini-2.5-flash' && <span title="Searches the web"><Globe size={9} className="text-sky-400" /></span>}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Connection */}
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-panel-2/50 border border-line/50" title={socketConnected ? 'Connected' : 'Disconnected'}>
        <Wifi size={10} className={socketConnected ? 'text-leaf' : 'text-faint'} />
        <span className={`text-[13px] font-mono font-bold uppercase tracking-wider ${socketConnected ? 'text-leaf' : 'text-faint'}`}>{socketConnected ? 'Live' : 'Off'}</span>
      </div>

      {/* Presence */}
      {activeConversation && (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {online.slice(0, 4).map((p) => (
              <span key={p.userId} className="w-7 h-7 rounded-full bg-panel-2 border-2 border-panel text-[13px] font-bold flex items-center justify-center text-sand relative" title={p.userName}>
                {p.avatar || p.userName?.[0]?.toUpperCase() || '?'}
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-leaf border-2 border-panel rounded-full" />
              </span>
            ))}
          </div>
          <span className="hidden sm:flex items-center gap-1 text-[13px] font-mono text-faint"><Users size={10} />{online.length}</span>
        </div>
      )}

      <div className="w-px h-5 bg-line/60" />

      {/* Room search */}
      <SearchPanel />

      {/* Room claims (persistent AI context) */}
      <ClaimsPanel />

      {/* Decisions and the evidence gate */}
      <DecisionPanel />

      {/* Pinned Toggle */}
      <button type="button" onClick={() => setSavedResponsesOpen(!isSavedResponsesOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[14px] font-medium rounded-lg border transition-all cursor-pointer ${isSavedResponsesOpen ? 'bg-ember/10 border-ember/30 text-ember-soft' : 'bg-panel-2/50 border-line/60 text-sand hover:text-cream hover:border-line-2'}`} title="Pinned">
        <BookmarkCheck size={12} /><span className="hidden sm:inline">Pinned</span>
      </button>
    </header>
  );
}
