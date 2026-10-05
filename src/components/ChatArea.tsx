import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ArrowDown, ArrowUp, Network, Loader2, Trash2 } from 'lucide-react';
import MessageRow from './MessageRow';
import { dayLabel, isSameDay } from '../utils/date';

export default function ChatArea() {
  const { messages, activeConversation, saveResponse, savedResponses, deleteSavedResponse, submitPrompt, stopGeneration, hasMoreMessages, isLoadingOlder, loadOlderMessages, highlightMessageId, setHighlightMessageId, deleteMessage, clearChat } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedIdMap, setCopiedIdMap] = useState<Record<string, boolean>>({});
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  // Inline prompt editing: id of the message being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Two-step guard for clearing the whole room, matching the claims clear-all.
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Viewport anchor (px from bottom) preserved when older messages are prepended.
  const prependAnchorRef = useRef<number | null>(null);
  // Whether the reader is parked at the bottom of the feed. Drives the
  // "follow the stream" behaviour so a streaming model never yanks down
  // someone who scrolled up to read earlier history.
  const isNearBottomRef = useRef(true);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Instant jump — the container's scroll-smooth would queue an animation
    // for every chunk and make streaming feel like it's fighting itself.
    el.style.scrollBehavior = 'auto';
    el.scrollTop = el.scrollHeight;
    el.style.scrollBehavior = '';
  };

  useEffect(() => {
    // A jump-to-message is in progress — the highlight effect owns scrolling.
    if (highlightMessageId) return;
    const el = scrollRef.current;
    if (prependAnchorRef.current !== null && el) {
      // Older messages were prepended: keep the same content in view.
      // Instant — scroll-smooth would animate while the layout is still shifting.
      el.style.scrollBehavior = 'auto';
      el.scrollTop = el.scrollHeight - prependAnchorRef.current;
      el.style.scrollBehavior = '';
      prependAnchorRef.current = null;
      return;
    }
    // Only follow the stream while the reader is already at the bottom.
    if (isNearBottomRef.current) scrollToBottom();
  }, [messages, highlightMessageId]);

  // Which highlight id we have already animated to. Streaming token updates
  // swap `messages` constantly; without this we would restart a smooth scroll
  // on every token and the jump would never land.
  const jumpedForRef = useRef<string | null>(null);

  // Auto-release the highlight ring shortly after the jump. Deliberately
  // independent of `messages` so streaming tokens can't keep resetting it.
  useEffect(() => {
    if (!highlightMessageId) {
      jumpedForRef.current = null;
      return;
    }
    const t = setTimeout(() => setHighlightMessageId(null), 2600);
    return () => clearTimeout(t);
  }, [highlightMessageId, setHighlightMessageId]);

  // Centre the jumped-to message in the feed. Scrolls the container directly
  // via getBoundingClientRect math rather than relying on scrollIntoView, and
  // re-centres instantly whenever layout shifts (e.g. a model still streaming).
  useEffect(() => {
    if (!highlightMessageId) return;
    const container = scrollRef.current;
    const el = document.getElementById(`msg-${highlightMessageId}`);
    if (!container || !el) return; // still paging history in — keep the lock

    const centerInstantly = () => {
      const rel = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.style.scrollBehavior = 'auto';
      container.scrollTop = Math.max(0, rel - container.clientHeight / 2 + el.offsetHeight / 2);
      container.style.scrollBehavior = '';
    };

    if (jumpedForRef.current !== highlightMessageId) {
      // First arrival: animate, then guarantee we land even if a smooth scroll
      // is interrupted by a streaming token update.
      jumpedForRef.current = highlightMessageId;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(centerInstantly, 500);
      return () => clearTimeout(t);
    }
    // Already centred here once — a token update moved the row, so re-centre.
    centerInstantly();
  }, [highlightMessageId, messages]);

  // Land a freshly opened room on the newest messages.
  useEffect(() => {
    isNearBottomRef.current = true;
    setConfirmingClear(false);
  }, [activeConversation?.id]);

  const handleLoadOlder = async () => {
    const el = scrollRef.current;
    if (!el || isLoadingOlder) return;
    const beforeLen = useStore.getState().messages.length;
    prependAnchorRef.current = el.scrollHeight - el.scrollTop;
    await loadOlderMessages();
    if (useStore.getState().messages.length === beforeLen) prependAnchorRef.current = null;
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
    setShowScrollBottom(distanceFromBottom > 300);
  };

  const handleJumpToBottom = () => {
    isNearBottomRef.current = true;
    scrollToBottom();
  };

  const handleCopyText = useCallback(async (text: string, refKey: string) => {
    let ok = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch { ok = false; }
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); document.body.removeChild(ta); } catch { /* noop */ } }
    if (!ok) return;
    setCopiedIdMap(prev => ({ ...prev, [refKey]: true }));
    setTimeout(() => setCopiedIdMap(prev => ({ ...prev, [refKey]: false })), 1500);
  }, []);

  // Precompute the pinned-prompt keys once per savedResponses change so message
  // rows can be compared cheaply and stay memo-friendly.
  const pinnedKeys = useMemo(
    () => new Set(savedResponses.map(s => `${s.prompt.trim()}|${s.modelName.trim()}`)),
    [savedResponses]
  );

  const handlePinToggle = useCallback(async (prompt: string, modelName: string, responseContent: string, senderName: string) => {
    const existing = useStore.getState().savedResponses.find(s => s.prompt.trim() === prompt.trim() && s.modelName.trim() === modelName.trim());
    if (existing) await deleteSavedResponse(existing.id);
    else await saveResponse(prompt, modelName, responseContent, senderName);
  }, [deleteSavedResponse, saveResponse]);

  const startEditing = useCallback((id: string) => setEditingId(id), []);
  const cancelEditing = useCallback(() => setEditingId(null), []);

  // Clearing mid-generation would let a completion handler write the message
  // straight back, so the control waits for every model to finish. The server
  // refuses it too (HTTP 409).
  const anyBusy = messages.some((m) =>
    Object.values(m.modelResponses).some((r) => r.status === 'streaming' || r.status === 'pending')
  );

  const handleClearChat = async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    await clearChat();
    setConfirmingClear(false);
  };

  if (!activeConversation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-sand p-6 select-none relative overflow-hidden">
        <div className="absolute inset-0 brand-dot-grid opacity-20 pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--color-ember), transparent 70%)', filter: 'blur(60px)' }} />
        <div className="relative flex flex-col items-center max-w-md text-center">
          <div className="relative mb-5">
            <div className="absolute inset-0 rounded-2xl blur-xl opacity-30" style={{ background: 'var(--brand-gradient-accent)' }} />
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-ember/15 to-ember/5 border border-ember/25 flex items-center justify-center text-ember"><Network size={24} /></div>
          </div>
          <h3 className="text-base font-semibold text-cream">Select a Workspace Room</h3>
          <p className="text-[12px] text-sand mt-2 leading-relaxed">Pick or create a room from the sidebar to start parallel AI diagnostics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 relative bg-transparent">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-8 scroll-smooth mx-auto max-w-5xl w-full">
        {messages.length > 0 && (
          <div className="flex justify-end sticky top-0 z-10">
            <button
              type="button"
              onClick={handleClearChat}
              disabled={anyBusy}
              title={
                anyBusy
                  ? 'Wait for the current response to finish before clearing'
                  : confirmingClear
                  ? 'Click again to confirm — this removes every prompt, response, claim, and contradiction in this room'
                  : 'Remove every prompt and response in this room'
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border backdrop-blur-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                confirmingClear
                  ? 'bg-rust/15 border-rust/40 text-rust'
                  : 'bg-panel/90 border-line/60 text-faint hover:text-rust hover:border-rust/40'
              }`}
            >
              <Trash2 size={12} />
              {confirmingClear ? 'Confirm clear all chat?' : 'Clear all chat'}
            </button>
          </div>
        )}
        {messages.length > 0 && hasMoreMessages && (
          <div className="flex justify-center pt-1">
            <button type="button" onClick={handleLoadOlder} disabled={isLoadingOlder}
              className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium rounded-xl border border-line/60 bg-panel/80 hover:border-ember/40 hover:text-ember-soft text-sand transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait shadow-sm">
              {isLoadingOlder
                ? <><Loader2 size={13} className="animate-spin" /> Loading history…</>
                : <><ArrowUp size={13} /> Load older messages</>}
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-lg mx-auto relative">
            <div className="relative bg-panel/80 backdrop-blur-sm border border-line/60 p-8 rounded-2xl shadow-lg flex flex-col items-center">
              <div className="relative mb-4">
                <div className="absolute inset-0 rounded-xl blur-lg opacity-25" style={{ background: 'var(--brand-gradient-accent)' }} />
                <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-ember/15 to-ember/5 flex items-center justify-center border border-ember/25 text-ember animate-pulse"><Network size={20} /></div>
              </div>
              <h4 className="text-sm font-semibold text-cream">Room Ready</h4>
              <p className="text-[12px] text-sand mt-2 max-w-xs leading-relaxed">Type your prompt below, toggle models to compare, and broadcast parallel streams in real time.</p>
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            // First message of a new calendar day gets a WhatsApp-style
            // separator ("Today", "Yesterday", "Monday", or a date).
            const prev = messages[index - 1];
            const showSeparator = !prev || !isSameDay(prev.createdAt, msg.createdAt);
            return (
              <div key={msg.id} className="space-y-3">
                {showSeparator && (
                  <div className="flex justify-center pt-1 pb-0 select-none">
                    <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-faint bg-panel/80 border border-line/60 rounded-full px-3 py-1 backdrop-blur-sm">
                      {dayLabel(msg.createdAt)}
                    </span>
                  </div>
                )}
                <MessageRow
                  msg={msg}
                  isEditing={editingId === msg.id}
                  highlight={highlightMessageId === msg.id}
                  pinnedKeys={pinnedKeys}
                  copiedMap={copiedIdMap}
                  onStartEditing={startEditing}
                  onCancelEditing={cancelEditing}
                  onCopy={handleCopyText}
                  onPinToggle={handlePinToggle}
                  onStop={stopGeneration}
                  onSubmitPrompt={submitPrompt}
                  onDelete={deleteMessage}
                />
              </div>
            );
          })
        )}
      </div>

      {showScrollBottom && (
        <button type="button" onClick={handleJumpToBottom}
          className="absolute bottom-4 right-6 bg-gradient-to-br from-ember to-ember-2 text-on-ember rounded-xl p-2.5 shadow-lg shadow-ember/25 hover:scale-105 active:scale-95 transition-all cursor-pointer z-50 flex items-center justify-center">
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
