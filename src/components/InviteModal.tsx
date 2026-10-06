import React, { useState } from 'react';
import { useStore, secureFetch } from '../store';
import { Mail, CheckCircle, AlertTriangle, X, Loader2 } from 'lucide-react';

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function InviteModal({ isOpen, onClose }: InviteModalProps) {
  const { activeWorkspace, token } = useStore();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  if (!isOpen || !activeWorkspace) return null;

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('loading');
    setMsg('');

    try {
      const res = await secureFetch(`/api/workspaces/${activeWorkspace.id}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await res.json();
      
      if (res.ok) {
        setStatus('success');
        setMsg(`Invitation sent to ${data.invitation.inviteeEmail}. They can join once they accept it.`);
        setEmail('');
      } else {
        setStatus('error');
        setMsg(data.error || 'Invitation sequence aborted.');
      }
    } catch (err) {
      setStatus('error');
      setMsg('Network pipeline failed. Try again.');
    }
  };

  return (
    <div className="fixed inset-0 modal-scrim z-[150] flex items-start justify-center p-4 overflow-y-auto pt-20 md:pt-28 animate-fadeIn">
      <div className="w-full max-w-md bg-panel border border-line-2 p-6 rounded-2xl shadow-2xl relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-faint hover:text-cream transition-colors cursor-pointer"
        >
          <X size={16} />
        </button>

        <div className="mb-5 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-ember/10 flex items-center justify-center text-ember border border-ember/20">
            <Mail size={16} />
          </div>
          <div>
            <h3 className="font-semibold text-cream text-base">Invite Collaborator</h3>
            <p className="text-[13px] text-faint font-mono mt-0.5 uppercase tracking-wider">WORKSPACE: {activeWorkspace.name}</p>
          </div>
        </div>

        {status === 'success' && (
          <div className="bg-leaf/5 border border-leaf/20 text-leaf rounded-xl px-3 py-2.5 text-[13px] flex gap-2 mb-4 animate-fadeIn">
            <CheckCircle size={14} className="shrink-0 mt-0.5 text-leaf" />
            <p>{msg}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-rust/5 border border-rust/20 text-rust rounded-xl px-3 py-2.5 text-[13px] flex gap-2 mb-4 animate-fadeIn">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-rust" />
            <p>{msg}</p>
          </div>
        )}

        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="invite-email" className="text-[13px] uppercase font-bold text-sand block font-mono tracking-wider">Teammate Email Address</label>
            <div className="relative">
              <input
                id="invite-email"
                type="email"
                required
                placeholder="collaborator@mindsync.io"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-ink border border-line rounded-xl pl-10 pr-3.5 py-3 text-[13px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
              />
              <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            </div>
            <p className="text-[13px] text-faint font-sans mt-1">
              Tip: They will receive a request they can accept or reject. Anyone who declines 5 times can no longer be invited to this workspace.
            </p>
          </div>

          <div className="flex gap-2.5 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sand bg-panel-2 hover:bg-line rounded-xl text-[13px] font-semibold cursor-pointer transition-colors border border-line"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={status === 'loading'}
              className="flex-1 py-2.5 bg-ember hover:bg-ember-2 disabled:opacity-50 text-on-ember font-bold text-[13px] rounded-xl transition-colors shadow-lg shadow-ember/20 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Inviting Teammate...</span>
                </>
              ) : (
                <span>Send Invitation</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
