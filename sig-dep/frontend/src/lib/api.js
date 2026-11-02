import axios from 'axios';
import { useAuth } from '../store/auth';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials: true, timeout: 60000 });

api.interceptors.request.use((cfg) => {
  const t = useAuth.getState().accessToken;
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let refreshing = null;

export async function refreshSession() {
  // Les réponses 401 simultanées partagent un seul renouvellement de session.
  if (!refreshing) {
    refreshing = axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
      .then((r) => { useAuth.getState().setSession(r.data.accessToken, r.data.user); return r.data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// ─── Référentiels mis en cache le temps de la session ────────────────────────
// Listes de référence lues par plusieurs écrans (nomenclature, catégories, provinces, types…). Le cache
// est vidé à toute modification réussie (POST, PUT, PATCH, DELETE), à la déconnexion et après 10 minutes.
const REFERENTIELS = ['/planification/referentiel', '/donnees/referentiel', '/documents/types', '/pip/modele', '/organisation/bureaux', '/users/roles'];
const DUREE_CACHE = 10 * 60 * 1000;
const cache = new Map();
export const estReferentiel = (url) => REFERENTIELS.includes(url);
export const lireCache = (url) => {
  const e = cache.get(url);
  return e && Date.now() - e.t < DUREE_CACHE ? e.data : undefined;
};
const ecrireCache = (url, data) => cache.set(url, { t: Date.now(), data });
export const viderReferentiel = (url) => cache.delete(url);
export const viderCache = () => cache.clear();
const enCours = new Map();
/** Lecture d’un référentiel : depuis le cache, ou un seul appel partagé par les écrans qui le demandent. */
export function lireReferentiel(url) {
  const c = lireCache(url);
  if (c !== undefined) return Promise.resolve(c);
  if (!enCours.has(url)) {
    enCours.set(url, api.get(url).then((r) => { ecrireCache(url, r.data); return r.data; }).finally(() => enCours.delete(url)));
  }
  return enCours.get(url);
}
// Changement d’utilisateur (connexion, déconnexion) : les référentiels dépendent des droits.
useAuth.subscribe((s, avant) => { if (s.user?.id !== avant.user?.id) viderCache(); });

/** Signal émis après toute modification réussie : compteurs du menu à actualiser, référentiels à relire. */
export const MODIFICATION = 'sigdep:modification';

api.interceptors.response.use(
  (r) => {
    if (r.config.method && r.config.method !== 'get') {
      viderCache();
      window.dispatchEvent(new Event(MODIFICATION));
    }
    return r;
  },
  async (error) => {
    const { response, config } = error;
    if (!response) return Promise.reject(error);
    let code = response.data?.error?.code;
    if (!code && response.data instanceof Blob && response.data.type?.includes('json')) {
      try { const j = JSON.parse(await response.data.text()); response.data = j; code = j.error?.code; } catch { /* ignore */ }
    }
    if (response.status === 401 && ['TOKEN_EXPIRE', 'SESSION_REVOQUEE', 'TOKEN_INVALIDE'].includes(code) && !config._retry && !config.url.includes('/auth/')) {
      // Une requête métier n’est rejouée qu’une fois, après renouvellement du jeton d’accès.
      config._retry = true;
      try {
        await refreshSession();
        return api(config);
      } catch {
        useAuth.getState().clear();
        window.location.assign('/connexion');
      }
    }
    if (response.status === 503 && code === 'MAINTENANCE' && window.location.pathname !== '/maintenance') {
      window.location.assign('/maintenance');
    }
    if (response.status === 403 && ['CHANGEMENT_MDP_REQUIS', 'CONFIGURATION_SECURITE_REQUISE'].includes(code) && window.location.pathname !== '/premiere-connexion') {
      window.location.assign('/premiere-connexion');
    }
    return Promise.reject(error);
  },
);

/** Message d’erreur compréhensible à partir d’une erreur Axios. */
export function errorMessage(e, fallback = 'Une erreur est survenue.') {
  if (!e) return fallback;
  if (!e.response) return 'Le serveur est injoignable. Vérifiez votre connexion ou que l’API est démarrée.';
  return e.response.data?.error?.message || fallback;
}

/** Téléchargement authentifié d’un fichier (PDF, Excel, Word, pièce jointe). */
export async function download(url, fallbackName = 'document') {
  const r = await api.get(url, { responseType: 'blob' });
  const cd = r.headers['content-disposition'] || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="?([^";]+)"?/);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const href = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

export default api;
