import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  walletAddress: string | null;
  displayName:   string | null;
  sessionToken:  string | null; // only set after ownership verification
  isGuest:       boolean;
  isVerified:    boolean;    // proved ownership (payment/memo challenge)
  isAuthenticated: boolean; // guest or local profile still counts
  // True when guest status was granted implicitly by a standalone /<app> route
  // rather than chosen at the ZEC-OS splash. Standalone pages shouldn't make
  // people sign in to read a chart - but this must NOT let them slip past the
  // splash later, so SplashGate treats it as unauthenticated.
  standaloneGuest: boolean;
  /** Server-granted: may see the sysop's tooling, read-only. From the session poll. */
  sudobud: boolean;
  setSudobud: (on: boolean) => void;

  // Verified account: server session + sync
  setAuth: (params: {
    walletAddress: string;
    displayName?:  string | null;
    sessionToken:  string;
    isVerified?:   boolean;
  }) => void;
  setGuest:  () => void;
  /** Implicit guest for a standalone route. Never satisfies the ZEC-OS splash. */
  setStandaloneGuest: () => void;
  logout:    () => void;
}

// Admin gate for manual-refresh controls and the sysop console. Gated on the
// verified handle NEXT_PUBLIC_ADMIN_HANDLE (same as the backend ADMIN_HANDLE) - display names are DB-unique, so
// exactly one verified account can ever hold it.
const ADMIN_HANDLE = (process.env.NEXT_PUBLIC_ADMIN_HANDLE || 'sysop').toLowerCase();
export const useIsAdmin = () =>
  useAuthStore(s => Boolean(s.isVerified && s.sessionToken && s.displayName?.toLowerCase() === ADMIN_HANDLE));
/** Sees the sysop's tooling, read-only: every action in it stays disabled. */
export const useIsSudobud = () =>
  useAuthStore(s => Boolean(s.sudobud && s.isVerified && s.sessionToken));
/** Sysop or sudobud: who may SEE a sysop view (never user management). */
export const useCanViewAdmin = () => {
  const admin = useIsAdmin();
  return useIsSudobud() || admin;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      walletAddress:   null,
      displayName:     null,
      sessionToken:    null,
      isGuest:         false,
      isVerified:      false,
      isAuthenticated: false,
      standaloneGuest: false,
      sudobud:         false,
      setSudobud: (on) => { if (get().sudobud !== on) set({ sudobud: on }); },

      setAuth: ({ walletAddress, displayName = null, sessionToken, isVerified = false }) =>
        set({
          walletAddress,
          displayName,
          sessionToken,
          isVerified,
          isGuest:         false,
          isAuthenticated: true,
          standaloneGuest: false,
          sudobud:         false,
        }),

      setGuest: () =>
        set({
          walletAddress:   null,
          displayName:     'Guest',
          sessionToken:    null,
          isGuest:         true,
          isVerified:      false,
          isAuthenticated: true,
          standaloneGuest: false,
        }),

      setStandaloneGuest: () =>
        set({
          walletAddress:   null,
          displayName:     'Guest',
          sessionToken:    null,
          isGuest:         true,
          isVerified:      false,
          isAuthenticated: true,
          standaloneGuest: true,
        }),

      logout: () => {
        // Revoke the session server-side so it doesn't linger as "live" and get
        // miscounted as another active session on the next login (which would
        // falsely trigger the "signed you out elsewhere" notice).
        const t = get().sessionToken;
        if (t) {
          try { sessionStorage.removeItem('zec-signedout-others'); } catch { /* ignore */ }
          fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
        }
        set({
          walletAddress:   null,
          displayName:     null,
          sessionToken:    null,
          isGuest:         false,
          isVerified:      false,
          isAuthenticated: false,
          standaloneGuest: false,
          sudobud:         false,
        });
      },
    }),
    {
      name: 'zec-os-auth',
      // sessionToken IS persisted: it only exists for verified accounts and the
      // server bounds it (SESSION_EXPIRY_HOURS). Without it, verified users
      // would lose sync on every reload.
      partialize: (state) => ({
        walletAddress:   state.walletAddress,
        displayName:     state.displayName,
        sessionToken:    state.sessionToken,
        isGuest:         state.isGuest,
        isVerified:      state.isVerified,
        isAuthenticated: state.isAuthenticated,
        standaloneGuest: state.standaloneGuest,
        sudobud:         state.sudobud,
      }),
    },
  ),
);
