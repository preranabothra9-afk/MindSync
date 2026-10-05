import { create } from 'zustand';
import { Conversation, Message, SavedResponse, PresenceUser, Claim, ClaimRelation, ContradictionDiscussion, Evidence, Decision, DecisionGateResult, DecisionReplay, DecisionSummary, WorkspaceMember } from '../types';

export interface ChatState {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  savedResponses: SavedResponse[];
  presence: PresenceUser[];
  collaborativePromptText: string;
  whoIsEditing: string | null;
  hasMoreMessages: boolean;
  isLoadingOlder: boolean;
  highlightMessageId: string | null;
  /** Durable claims extracted from this room's AI responses. */
  claims: Claim[];
  /** Contradiction-graph edges between this room's claims. */
  relations: ClaimRelation[];
  /** Human discussions for the room's contradictions, keyed by relation id. */
  discussions: Record<string, ContradictionDiscussion>;
  /**
   * Evidence attached to this room's claims, keyed by claim id. Populated
   * lazily as a claim's or contradiction's detail view is opened.
   */
  evidence: Record<string, Evidence[]>;
  /** This room's decisions, newest-first. */
  decisions: Decision[];
  /** The gate verdict for the decision the room is currently inspecting. */
  decisionGate: DecisionGateResult | null;
  /** The replay timeline for the decision currently being replayed. */
  decisionReplay: DecisionReplay | null;
  /** The summary for the decision currently being summarized. */
  decisionSummary: DecisionSummary | null;
  /** True while a replay or summary is loading. */
  decisionReplayBusy: boolean;
  /** The active workspace's members, for the decision approver picker. */
  workspaceMembers: WorkspaceMember[];

  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (conv: Conversation | null) => void;
  setMessages: (messages: Message[]) => void;
  setSavedResponses: (savedResponses: SavedResponse[]) => void;
  setPresence: (presence: PresenceUser[]) => void;
  setCollaborativePromptText: (text: string) => void;
  setWhoIsEditing: (who: string | null) => void;
  setHasMoreMessages: (hasMore: boolean) => void;
  setIsLoadingOlder: (loading: boolean) => void;
  setHighlightMessageId: (id: string | null) => void;
  setClaims: (claims: Claim[]) => void;
  setRelations: (relations: ClaimRelation[]) => void;
  setDiscussions: (discussions: Record<string, ContradictionDiscussion>) => void;
  /** Replaces the evidence list for one claim. */
  setEvidenceForClaim: (claimId: string, evidence: Evidence[]) => void;
  /** Merges one newly created evidence item in, newest-first. */
  upsertEvidence: (evidence: Evidence) => void;
  /** Drops one evidence item, and any citations of it, from the local state. */
  removeEvidence: (claimId: string, evidenceId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  activeConversation: null,
  messages: [],
  savedResponses: [],
  presence: [],
  collaborativePromptText: '',
  whoIsEditing: null,
  hasMoreMessages: false,
  isLoadingOlder: false,
  highlightMessageId: null,
  claims: [],
  relations: [],
  discussions: {},
  evidence: {},
  /** This room's decisions, newest-first. */
  decisions: [],
  /** The gate verdict for the decision the room is currently inspecting. */
  decisionGate: null as DecisionGateResult | null,
  /** The replay timeline for the decision currently being replayed. */
  decisionReplay: null as DecisionReplay | null,
  /** The summary for the decision currently being summarized. */
  decisionSummary: null as DecisionSummary | null,
  /** True while a replay or summary is loading. */
  decisionReplayBusy: false,
  /** The active workspace's members, for the approver picker. */
  workspaceMembers: [] as WorkspaceMember[],

  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (activeConversation) => set({ activeConversation, messages: [], hasMoreMessages: false }),
  setMessages: (messages) => set({ messages }),
  setSavedResponses: (savedResponses) => set({ savedResponses }),
  setPresence: (presence) => set({ presence }),
  setCollaborativePromptText: (collaborativePromptText) => set({ collaborativePromptText }),
  setWhoIsEditing: (whoIsEditing) => set({ whoIsEditing }),
  setHasMoreMessages: (hasMoreMessages) => set({ hasMoreMessages }),
  setIsLoadingOlder: (isLoadingOlder) => set({ isLoadingOlder }),
  setHighlightMessageId: (highlightMessageId) => set({ highlightMessageId }),
  setClaims: (claims) => set({ claims }),
  setRelations: (relations) => set({ relations }),
  setDiscussions: (discussions) => set({ discussions }),
  setEvidenceForClaim: (claimId, evidence) =>
    set((state) => ({ evidence: { ...state.evidence, [claimId]: evidence } })),
  upsertEvidence: (evidence) =>
    set((state) => {
      const existing = state.evidence[evidence.claimId] || [];
      const without = existing.filter((e) => e.id !== evidence.id);
      return {
        evidence: { ...state.evidence, [evidence.claimId]: [evidence, ...without] }
      };
    }),
  removeEvidence: (claimId, evidenceId) =>
    set((state) => {
      const existing = state.evidence[claimId] || [];
      if (!existing.some((e) => e.id === evidenceId)) return state;
      return {
        evidence: { ...state.evidence, [claimId]: existing.filter((e) => e.id !== evidenceId) },
        // Closed contradictions that cited the deleted evidence keep a clean
        // record locally too, matching the server's $pull.
        relations: state.relations.map((r) =>
          Array.isArray(r.citedEvidenceIds) && r.citedEvidenceIds.includes(evidenceId)
            ? { ...r, citedEvidenceIds: r.citedEvidenceIds.filter((id) => id !== evidenceId) }
            : r
        )
      };
    })
}));
