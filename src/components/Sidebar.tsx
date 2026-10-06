import React, { useState } from 'react';
import { useStore } from '../store';
import {
  ChevronDown, Trash2, Users, BookmarkCheck, Shield, LogOut, AlertTriangle, X,
  FolderPlus, Hash, Plus, PanelLeftClose, Menu, Building2, Home
} from 'lucide-react';
import { BrandLogoCompact, BrandLogoIcon } from '../brand';
import InviteModal from './InviteModal';
import AdminPanel from './AdminPanel';
import ThemeSwitcher from './ThemeSwitcher';

export default function Sidebar() {
  // Fine-grained selectors: this sidebar re-renders per stream chunk otherwise,
  // because the store swaps `messages` on every token a model emits.
  const user = useStore((s) => s.user);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const setActiveWorkspace = useStore((s) => s.setActiveWorkspace);
  const conversations = useStore((s) => s.conversations);
  const activeConversation = useStore((s) => s.activeConversation);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const createConversation = useStore((s) => s.createConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const presence = useStore((s) => s.presence);
  const socketConnected = useStore((s) => s.socketConnected);
  const isSidebarOpen = useStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const isSavedResponsesOpen = useStore((s) => s.isSavedResponsesOpen);
  const setSavedResponsesOpen = useStore((s) => s.setSavedResponsesOpen);
  const isAdminPanelOpen = useStore((s) => s.isAdminPanelOpen);
  const setAdminPanelOpen = useStore((s) => s.setAdminPanelOpen);
  const logout = useStore((s) => s.logout);
  const navigateTo = useStore((s) => s.navigateTo);
  const leaveWorkspace = useStore((s) => s.leaveWorkspace);

  const collapsed = !isSidebarOpen;
  const [isWsMenuOpen, setIsWsMenuOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceToLeave, setWorkspaceToLeave] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    await createWorkspace(newWorkspaceName.trim(), 'Collaborative multi-agent project room.');
    setNewWorkspaceName('');
    setShowNewWorkspace(false);
    setIsWsMenuOpen(false);
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    await createConversation(newChannelName.trim());
    setNewChannelName('');
    setShowNewChannel(false);
  };

  const confirmDeleteWorkspace = () => { if (workspaceToDelete) { deleteWorkspace(workspaceToDelete); setWorkspaceToDelete(null); } };
  const confirmDeleteConversation = () => { if (conversationToDelete) { deleteConversation(conversationToDelete); setConversationToDelete(null); } };

  // Owners need to pick a successor, which the hub's transfer dialog handles;
  // a member leaving is simple enough to confirm inline here.
  const handleLeaveClick = () => {
    if (!activeWorkspace) return;
    setLeaveError(null);
    if (activeWorkspace.ownerId === user?.id) {
      setWorkspaceToLeave(null);
      navigateTo('/workspaces');
      return;
    }
    setWorkspaceToLeave(activeWorkspace.id);
  };

  const confirmLeaveWorkspace = async () => {
    if (!workspaceToLeave) return;
    const result = await leaveWorkspace(workspaceToLeave);
    if (!result.success) {
      setLeaveError(result.error);
      return;
    }
    setWorkspaceToLeave(null);
    setLeaveError(null);
  };

  const workspaceNameBeingDeleted = workspaces.find(w => w.id === workspaceToDelete)?.name || '';
  const conversationTitleBeingDeleted = conversations.find(c => c.id === conversationToDelete)?.title || '';

  const renderContent = (labels: boolean, isDesktop: boolean) => (
    <div className="flex flex-col h-full select-none">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-line/60">
        <button
          type="button"
          onClick={() => {
            // Collapsed: a click expands. Expanded: a click goes home.
            if (collapsed) {
              setSidebarOpen(true);
            } else {
              navigateTo('/home');
              setMobileOpen(false);
            }
          }}
          className="shrink-0 flex items-center justify-center cursor-pointer"
          title={collapsed ? 'Expand' : 'Go to homepage'}
        >
          {labels ? <BrandLogoCompact /> : <BrandLogoIcon size={28} />}
        </button>
        {labels && <div className="flex-1" />}
        <ThemeSwitcher variant="icon" />
        {labels && isDesktop && (
          <button type="button" onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg text-faint hover:text-cream hover:bg-panel-2/80 transition-all cursor-pointer" title="Collapse">
            <PanelLeftClose size={15} />
          </button>
        )}
        {labels && !isDesktop && (
          <button type="button" onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-faint hover:text-cream hover:bg-panel-2/80 transition-all cursor-pointer" title="Close">
            <X size={15} />
          </button>
        )}
      </div>

      {/* Workspace Switcher */}
      <div className="shrink-0 px-3 pt-4 pb-1 relative">
        {labels && <p className="px-1 pb-2 text-[13px] font-mono font-bold uppercase tracking-widest text-faint">Workspace</p>}
        <div className="relative">
          <button type="button" onClick={() => { setIsWsMenuOpen(!isWsMenuOpen); setShowNewWorkspace(false); }}
            className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 bg-panel-2/60 hover:bg-panel-2 border border-line/50 hover:border-line-2 rounded-xl text-sm transition-all cursor-pointer`}>
            {labels ? (
              <>
                <Building2 size={15} className="text-ember shrink-0" />
                <span className="text-cream font-medium truncate text-[13px] flex-1 text-left">{activeWorkspace?.name || 'Workspace'}</span>
                <ChevronDown size={13} className={`text-faint shrink-0 transition-transform duration-200 ${isWsMenuOpen ? 'rotate-180' : ''}`} />
              </>
            ) : <Building2 size={16} className="text-ember" />}
          </button>
          {isWsMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => { setIsWsMenuOpen(false); setShowNewWorkspace(false); }} />
              <div className={`absolute z-50 w-72 bg-panel border border-line-2 rounded-2xl shadow-2xl overflow-hidden animate-fadeInScale ${labels ? 'left-0 top-full mt-2' : 'left-full ml-2 top-0'}`}>
                <div className="px-4 py-2.5 border-b border-line/60"><p className="text-[13px] font-mono font-bold uppercase tracking-widest text-faint">Workspaces</p></div>
                <div className="p-2 max-h-60 overflow-y-auto">
                  {workspaces.length === 0 && <p className="text-[13px] text-faint italic px-3 py-4 text-center">No workspaces yet.</p>}
                  {workspaces.map((ws) => {
                    const isActive = activeWorkspace?.id === ws.id;
                    return (
                      <div key={ws.id} onClick={() => { setActiveWorkspace(ws); setIsWsMenuOpen(false); setMobileOpen(false); }}
                        className={`group flex items-center justify-between px-3 py-2 rounded-xl text-[13px] cursor-pointer transition-all ${isActive ? 'bg-ember/10 text-ember-soft font-semibold border border-ember/15' : 'text-sand hover:bg-panel-2 hover:text-cream border border-transparent'}`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 ${isActive ? 'bg-ember/20 text-ember' : 'bg-panel-2 text-faint'}`}>{ws.name.charAt(0).toUpperCase()}</div>
                          <span className="truncate">{ws.name}</span>
                          <span className="ml-auto flex items-center gap-1 font-mono text-[13px] text-faint shrink-0" title={`${ws.memberIds?.length || 0} member(s)`}>
                            <Users size={9} />
                            {ws.memberIds?.length || 0}
                          </span>
                        </div>
                        {workspaces.length > 1 && ws.ownerId === user?.id && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setWorkspaceToDelete(ws.id); }} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rust/10 hover:text-rust rounded-lg transition-all cursor-pointer" title="Delete">
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-line/60 p-2">
                  {showNewWorkspace ? (
                    <form onSubmit={handleCreateWorkspace} className="space-y-2 px-1">
                      <input type="text" placeholder="Workspace name..." value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)}
                        className="w-full bg-ink border border-line rounded-xl px-3 py-2 text-[13px] text-cream placeholder-faint focus:outline-none focus:border-ember/50 focus:ring-2 focus:ring-ember/10 transition-all" autoFocus />
                      <div className="flex justify-end gap-2 text-[13px]">
                        <button type="button" onClick={() => setShowNewWorkspace(false)} className="px-3 py-1.5 text-faint hover:text-cream transition-colors cursor-pointer">Cancel</button>
                        <button type="submit" className="bg-ember hover:bg-ember-2 text-on-ember px-4 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer">Create</button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setShowNewWorkspace(true)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium text-ember hover:bg-ember/10 transition-colors cursor-pointer">
                      <FolderPlus size={13} /><span>New Workspace</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rooms */}
      <div className="shrink-0 px-3 pt-4">
        {labels && <p className="px-1 pb-2 text-[13px] font-mono font-bold uppercase tracking-widest text-faint">Rooms</p>}
        <div className="space-y-0.5">
          {!activeWorkspace && labels && <p className="text-[14px] text-faint italic px-2 py-2">Select a workspace to begin.</p>}
          {conversations.map((c) => {
            const isActive = activeConversation?.id === c.id;
            return (
              <div key={c.id} onClick={() => { setActiveConversation(c); setMobileOpen(false); }}
                className={`group flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 rounded-xl text-[13px] font-medium cursor-pointer transition-all relative ${isActive ? 'bg-ember/10 text-ember-soft border border-ember/15' : 'text-sand hover:bg-panel-2/70 hover:text-cream border border-transparent'}`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-ember/15 text-ember' : 'bg-panel-2/50 text-faint'}`}><Hash size={12} /></div>
                {labels && <span className="truncate flex-1 text-left">{c.title}</span>}
                {labels && conversations.length > 1 && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConversationToDelete(c.id); }} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rust/10 hover:text-rust rounded-lg transition-all cursor-pointer" title="Delete">
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            );
          })}
          {conversations.length === 0 && !showNewChannel && labels && <p className="text-[14px] text-faint italic px-2 py-1.5">No rooms yet.</p>}
        </div>
        {showNewChannel ? (
          <form onSubmit={handleCreateChannel} className="flex items-center gap-1.5 px-1 pt-1.5">
            <Hash size={12} className="text-faint shrink-0" />
            <input type="text" placeholder="Room name..." value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)}
              className="min-w-0 flex-1 bg-ink border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-cream placeholder-faint focus:outline-none focus:border-ember/50 transition-all" autoFocus />
            <button type="submit" className="text-[13px] bg-ember hover:bg-ember-2 text-on-ember px-2.5 py-1 rounded-lg font-semibold cursor-pointer">Create</button>
            <button type="button" onClick={() => setShowNewChannel(false)} className="p-1 text-faint hover:text-cream hover:bg-panel-2 rounded-lg transition-colors cursor-pointer"><X size={11} /></button>
          </form>
        ) : (
          <button type="button" onClick={() => setShowNewChannel(true)}
            className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 mt-0.5 rounded-xl text-[13px] font-medium text-faint hover:text-ember-soft hover:bg-panel-2/50 transition-colors cursor-pointer`}>
            <Plus size={13} className="shrink-0" />{labels && <span>New Room</span>}
          </button>
        )}
      </div>

      {/* Presence */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-4">
        {labels && <p className="px-1 pb-2 text-[13px] font-mono font-bold uppercase tracking-widest text-faint">Active Now</p>}
        <div className={labels ? 'space-y-0.5' : 'space-y-1 flex flex-col items-center'}>
          {presence.length === 0 && labels && <p className="text-[14px] text-faint italic px-2 py-1.5">No collaborators online.</p>}
          {presence.map((p) => {
            const isMe = p.userId === user?.id;
            const hasActivity = !!p.activity;
            return (
              <div key={p.userId} className="group relative cursor-help z-0 hover:z-10" title={`${p.userName} ${isMe ? '(You)' : ''} ${hasActivity ? `- ${p.activity}` : ''}`}>
                <div className={`flex items-center gap-2.5 ${labels ? 'px-3 py-1.5' : 'py-0.5 justify-center'} rounded-xl transition-all hover:bg-panel-2/60`}>
                  <div className="relative shrink-0">
                    <div className={`w-7 h-7 rounded-full text-[13px] font-bold flex items-center justify-center border-2 transition-all ${isMe ? 'bg-gradient-to-br from-ember to-ember-2 text-white border-ember/30' : 'bg-panel-2 text-sand border-line-2'}`}>{p.avatar}</div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-2 border-panel rounded-full ${hasActivity ? 'bg-ember-soft animate-pulse' : 'bg-leaf'}`} />
                  </div>
                  {labels && (
                    <div className="min-w-0 leading-tight">
                      <p className="text-[14px] text-cream truncate font-medium">{p.userName} {isMe && <span className="text-faint text-[13px]">(You)</span>}</p>
                      <p className="text-[13px] text-faint truncate">{hasActivity ? p.activity : 'Online'}</p>
                    </div>
                  )}
                </div>
                {!labels && (
                  <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 hidden group-hover:block bg-panel border border-line-2 px-2.5 py-1.5 rounded-lg text-[13px] text-cream whitespace-nowrap shadow-2xl z-[99]">
                    <p className="font-semibold">{p.userName} {isMe && '(You)'}</p>
                    <p className="text-faint">{hasActivity ? p.activity : 'Online'}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Socket Status */}
      <div className="shrink-0 px-3 py-2 border-t border-line/60">
        <div className={`flex items-center gap-1.5 text-[13px] font-mono font-bold uppercase tracking-widest ${labels ? '' : 'justify-center'}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${socketConnected ? 'bg-leaf animate-pulse' : 'bg-faint'}`} />
          {labels && <span className={socketConnected ? 'text-leaf' : 'text-faint'}>{socketConnected ? 'Realtime' : 'Offline'}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 px-3 pb-2 space-y-1">
        <button type="button" onClick={() => navigateTo('/home')}
          className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 font-medium text-[13px] rounded-xl border bg-panel-2/50 border-line/60 text-sand hover:text-cream hover:border-line-2 cursor-pointer transition-all`} title="Homepage">
          <Home size={13} className="shrink-0" />{labels && <span>Homepage</span>}
        </button>
        <button type="button" onClick={() => setSavedResponsesOpen(!isSavedResponsesOpen)}
          className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 font-medium text-[13px] rounded-xl border transition-all cursor-pointer ${isSavedResponsesOpen ? 'bg-ember/10 border-ember/30 text-ember-soft' : 'bg-panel-2/50 border-line/60 text-sand hover:text-cream hover:border-line-2'}`} title="Pinned">
          <BookmarkCheck size={13} className="shrink-0" />{labels && <span>Pinned</span>}
        </button>
        <button type="button" onClick={() => setIsInviteOpen(true)}
          className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 font-medium text-[13px] rounded-xl bg-gradient-to-r from-ember to-ember-2 text-white cursor-pointer transition-all btn-3d shadow-lg shadow-ember/20`} title="Invite">
          <Users size={13} className="shrink-0" />{labels && <span>Invite</span>}
        </button>
        {activeWorkspace && (
          <button type="button" onClick={handleLeaveClick}
            className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 font-medium text-[13px] rounded-xl border bg-panel-2/50 border-line/60 text-sand hover:text-rust hover:border-rust/40 cursor-pointer transition-all`} title="Leave workspace">
            <LogOut size={13} className="shrink-0" />{labels && <span>Leave workspace</span>}
          </button>
        )}
        {user?.role === 'admin' && (
          <button type="button" onClick={() => setAdminPanelOpen(true)}
            className={`w-full flex items-center gap-2.5 ${labels ? 'px-3' : 'px-0 justify-center'} py-2 font-medium text-[13px] rounded-xl border bg-ember/5 hover:bg-ember/10 text-ember-soft border-ember/20 cursor-pointer transition-all`} title="Admin">
            <Shield size={13} className="shrink-0" />{labels && <span>Admin</span>}
          </button>
        )}
      </div>

      {/* Identity */}
      <div className="shrink-0 px-3 py-2.5 border-t border-line/60">
        <div className={`flex items-center gap-2.5 ${labels ? '' : 'flex-col gap-1.5'}`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ember to-ember-2 text-on-ember font-bold flex items-center justify-center text-[14px] shrink-0 ring-2 ring-ember/20">
            {user?.avatar || user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          {labels && (
            <div className="leading-tight min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-cream truncate">{user?.name}</p>
              <p className="text-[13px] text-faint font-mono uppercase tracking-wider">{user?.role === 'admin' ? 'Admin' : 'Collaborator'}</p>
            </div>
          )}
          <button type="button" onClick={logout} className="p-1.5 hover:bg-rust/10 text-faint hover:text-rust rounded-lg transition-all cursor-pointer shrink-0" title="Sign Out">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => setMobileOpen(true)}
        className="fixed top-3 left-3 z-[105] lg:hidden flex items-center justify-center w-10 h-10 rounded-xl bg-panel border border-line-2 shadow-lg text-cream cursor-pointer hover:bg-panel-2 transition-colors" title="Menu">
        <Menu size={17} />
      </button>

      <aside className={`hidden lg:flex flex-col h-full bg-panel/90 backdrop-blur-sm border-r border-line/60 shrink-0 transition-all duration-300 z-30 ${collapsed ? 'w-[64px]' : 'w-60'}`}>
        {renderContent(!collapsed, true)}
      </aside>

      {mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} className="fixed inset-0 z-[100] lg:hidden modal-scrim animate-fadeIn" />
          <aside className="fixed inset-y-0 left-0 z-[110] w-72 flex lg:hidden bg-panel border-r border-line-2 shadow-2xl animate-slideInLeft">
            {renderContent(true, false)}
          </aside>
        </>
      )}

      <InviteModal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} />
      <AdminPanel isOpen={isAdminPanelOpen} onClose={() => setAdminPanelOpen(false)} />

      {workspaceToDelete && (
        <div className="fixed inset-0 modal-scrim z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-panel border border-line-2 p-5 rounded-2xl shadow-2xl relative animate-fadeInScale">
            <button type="button" onClick={() => setWorkspaceToDelete(null)} className="absolute right-3 top-3 text-faint hover:text-cream cursor-pointer"><X size={15} /></button>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-rust/10 text-rust flex items-center justify-center border border-rust/20 shrink-0"><AlertTriangle size={16} /></div>
              <h3 className="font-semibold text-cream text-sm">Delete Workspace?</h3>
            </div>
            <p className="text-[13px] text-sand leading-relaxed mb-4">Delete <span className="text-cream font-medium">"{workspaceNameBeingDeleted}"</span>? All rooms and history will be permanently erased.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setWorkspaceToDelete(null)} className="flex-1 py-2 bg-panel-2 hover:bg-line text-sand text-[13px] font-medium rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={confirmDeleteWorkspace} className="flex-1 py-2 bg-rust hover:bg-rust/85 text-white text-[13px] font-medium rounded-xl transition-colors cursor-pointer">Delete</button>
            </div>
          </div>
        </div>
      )}

      {conversationToDelete && (
        <div className="fixed inset-0 modal-scrim z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-panel border border-line-2 p-5 rounded-2xl shadow-2xl relative animate-fadeInScale">
            <button type="button" onClick={() => setConversationToDelete(null)} className="absolute right-3 top-3 text-faint hover:text-cream cursor-pointer"><X size={15} /></button>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-rust/10 text-rust flex items-center justify-center border border-rust/20 shrink-0"><AlertTriangle size={16} /></div>
              <h3 className="font-semibold text-cream text-sm">Delete Room?</h3>
            </div>
            <p className="text-[13px] text-sand leading-relaxed mb-4">Delete <span className="text-cream font-medium">"{conversationTitleBeingDeleted}"</span>? All shared AI sessions will be lost.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConversationToDelete(null)} className="flex-1 py-2 bg-panel-2 hover:bg-line text-sand text-[13px] font-medium rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={confirmDeleteConversation} className="flex-1 py-2 bg-rust hover:bg-rust/85 text-white text-[13px] font-medium rounded-xl transition-colors cursor-pointer">Delete</button>
            </div>
          </div>
        </div>
      )}

      {workspaceToLeave && (
        <div className="fixed inset-0 modal-scrim z-[200] flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-panel border border-line-2 p-5 rounded-2xl shadow-2xl relative animate-fadeInScale">
            <button type="button" onClick={() => { setWorkspaceToLeave(null); setLeaveError(null); }} className="absolute right-3 top-3 text-faint hover:text-cream cursor-pointer"><X size={15} /></button>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-rust/10 text-rust flex items-center justify-center border border-rust/20 shrink-0"><LogOut size={16} /></div>
              <h3 className="font-semibold text-cream text-sm">Leave Workspace?</h3>
            </div>
            <p className="text-[13px] text-sand leading-relaxed mb-4">Leave <span className="text-cream font-medium">"{activeWorkspace?.name}"</span>? You will lose access to its rooms and history until you are invited again.</p>
            {leaveError && (
              <p className="text-[13px] text-rust bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 mb-3">{leaveError}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setWorkspaceToLeave(null); setLeaveError(null); }} className="flex-1 py-2 bg-panel-2 hover:bg-line text-sand text-[13px] font-medium rounded-xl transition-colors cursor-pointer">Cancel</button>
              <button type="button" onClick={confirmLeaveWorkspace} className="flex-1 py-2 bg-rust hover:bg-rust/85 text-white text-[13px] font-medium rounded-xl transition-colors cursor-pointer">Leave</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
