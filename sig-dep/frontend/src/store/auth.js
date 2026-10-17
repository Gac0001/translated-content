import { create } from 'zustand';

/**
 * État d’authentification. Le jeton d’accès est conservé en mémoire uniquement ;
 * le refresh token est dans un cookie httpOnly inaccessible au JavaScript.
 */
export const useAuth = create((set, get) => ({
  user: null,
  accessToken: null,
  ready: false,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null }),
  setReady: () => set({ ready: true }),
  can: (...perms) => {
    const u = get().user;
    return !!u && perms.some((p) => u.permissions.includes(p));
  },
  hasRole: (...roles) => {
    const u = get().user;
    return !!u && roles.some((r) => u.roles.includes(r));
  },
}));

export const useCompteurs = create((set) => ({
  nonLues: 0,
  compteurs: {},
  setNonLues: (nonLues) => set({ nonLues }),
  setCompteurs: (compteurs) => set({ compteurs }),
}));
