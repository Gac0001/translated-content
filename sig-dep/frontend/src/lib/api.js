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
  if (!refreshing) {
    refreshing = axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
      .then((r) => { useAuth.getState().setSession(r.data.accessToken, r.data.user); return r.data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { response, config } = error;
    if (!response) return Promise.reject(error);
    let code = response.data?.error?.code;
    if (!code && response.data instanceof Blob && response.data.type?.includes('json')) {
      try { const j = JSON.parse(await response.data.text()); response.data = j; code = j.error?.code; } catch { /* ignore */ }
    }
    if (response.status === 401 && ['TOKEN_EXPIRE', 'SESSION_REVOQUEE', 'TOKEN_INVALIDE'].includes(code) && !config._retry && !config.url.includes('/auth/')) {
      config._retry = true;
      try {
        await refreshSession();
        return api(config);
      } catch {
        useAuth.getState().clear();
        window.location.assign('/connexion');
      }
    }
    if (response.status === 403 && code === 'CHANGEMENT_MDP_REQUIS' && window.location.pathname !== '/changer-mot-de-passe') {
      window.location.assign('/changer-mot-de-passe');
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
