import { create } from 'zustand';
import { Workspace, Invitation } from '../types';

export interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  // Invitations awaiting this user's accept/reject decision. Held separately
  // from `workspaces` because a pending invite grants no workspace access.
  pendingInvitations: Invitation[];
  
  setWorkspaces: (workspaces: Workspace[]) => void;
  setActiveWorkspace: (ws: Workspace | null) => void;
  setPendingInvitations: (invitations: Invitation[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeWorkspace: null,
  pendingInvitations: [],

  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (activeWorkspace) => set({ activeWorkspace }),
  setPendingInvitations: (pendingInvitations) => set({ pendingInvitations })
}));
