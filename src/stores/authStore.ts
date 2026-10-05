import { create } from 'zustand';
import { User } from '../types';

// Survives a reload of the "check your inbox" screen, so a refresh while the
// user waits for the mail still tells them which address it went to.
const PENDING_VERIFICATION_KEY = 'mindsync-pending-verification';

function readPendingVerificationEmail(): string | null {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(PENDING_VERIFICATION_KEY) : null;
  } catch {
    return null;
  }
}

export function persistPendingVerificationEmail(email: string | null) {
  try {
    if (email) localStorage.setItem(PENDING_VERIFICATION_KEY, email);
    else localStorage.removeItem(PENDING_VERIFICATION_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticating: boolean;
  authError: string | null;
  /** Email awaiting confirmation, held between signup and the verify click. */
  pendingVerificationEmail: string | null;
  /** Dev-only direct link, populated when SMTP is not configured. */
  pendingVerificationUrl: string | null;
  
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setAuthenticating: (isAuth: boolean) => void;
  setAuthError: (error: string | null) => void;
  clearAuthError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticating: true,
  authError: null,
  pendingVerificationEmail: readPendingVerificationEmail(),
  pendingVerificationUrl: null,

  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),
  setAuthenticating: (isAuth) => set({ isAuthenticating: isAuth }),
  setAuthError: (error) => set({ authError: error }),
  clearAuthError: () => set({ authError: null })
}));
