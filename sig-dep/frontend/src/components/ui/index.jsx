import { Fragment, useEffect, useId, useMemo, useRef, useState, useCallback, createContext, useContext, cloneElement, isValidElement } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router-dom';
import { create } from 'zustand';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCircle2, ChevronRight, Info, Loader2, Search, X, Inbox, XCircle } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { STATUTS, PRIORITES, URGENCES, CONFIDENTIALITES, COLORS } from '../../lib/labels';
import { IconButton } from './Button';
import { useFocusTrap, useScrollLock } from './focus';

export { Button, IconButton } from './Button';
export { DropdownMenu } from './DropdownMenu';
export { useFocusTrap, useScrollLock } from './focus';

// ─── Données ────────────────────────────────────────────────────────────────
export function useApi(url, deps = []) {
  const [state, setState] = useState({ data: null, loading: !!url, error: null });
  const load = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.get(url);
      setState({ data: r.data, loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: errorMessage(e), status: e.response?.status });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}

// ─── Notifications éphémères (toasts) ───────────────────────────────────────
export const useToasts = create((set) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ items: [...s.items, { id, ...t }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.duration || 5000);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));
export const toast = {
  success: (message) => useToasts.getState().push({ type: 'success', message }),
  error: (message) => useToasts.getState().push({ type: 'error', message, duration: 8000 }),
  info: (message) => useToasts.getState().push({ type: 'info', message }),
};

const TOAST = {
  error: ['border-red-200 bg-red-50 text-red-800', AlertTriangle],
  success: ['border-emerald-200 bg-emerald-50 text-emerald-800', CheckCircle2],
  info: ['border-sky-200 bg-sky-50 text-sky-800', Info],
};

export function Toaster() {
  const { items, remove } = useToasts();
  const rendu = (t) => {
    const [cls, Icon] = TOAST[t.type] || TOAST.info;
    return (
      <div key={t.id} className={`pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm shadow-lg ${cls}`}>
        <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
        <span className="flex-1">{t.message}</span>
        <button type="button" className="rounded p-0.5 hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-current" onClick={() => remove(t.id)} aria-label="Fermer la notification"><X size={16} aria-hidden /></button>
      </div>
    );
  };
  // Deux régions : les erreurs sont annoncées immédiatement, les autres messages poliment.
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 no-print">
      <div role="alert" aria-live="assertive" className="flex flex-col gap-2">{items.filter((t) => t.type === 'error').map(rendu)}</div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">{items.filter((t) => t.type !== 'error').map(rendu)}</div>
    </div>
  );
}

/** Exécute une action API avec toast de succès/erreur. */
/**
 * Opération critique de l’Admin Système : la première tentative crée une demande de confirmation
 * adressée au Directeur (réponse 202) ; une fois confirmée, la même opération s’exécute.
 * Renvoie la réponse si l’opération a été exécutée, null si elle attend une confirmation.
 */
export async function runCritique(fn, successMessage) {
  const r = await runAction(fn);
  if (r && r.status === 202) {
    toast.info(`${r.data.message} Suivi : Administration → Gouvernance.`);
    return null;
  }
  if (successMessage) toast.success(successMessage);
  return r;
}

export async function runAction(fn, successMessage) {
  try {
    const r = await fn();
    if (successMessage) toast.success(successMessage);
    return r;
  } catch (e) {
    toast.error(errorMessage(e));
    // L’appelant interrompt son traitement ; l’erreur ayant été affichée, elle est marquée comme signalée.
    if (e && typeof e === 'object') e.dejaSignale = true;
    throw e;
  }
}

// ─── Mise en page ───────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, breadcrumb = [], actions }) {
  return (
    <div className="mb-5">
      {breadcrumb.length > 0 && (
        <nav className="mb-2 no-print" aria-label="Fil d’Ariane">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            <li><Link to="/" className="rounded-sm text-slate-600 hover:text-dep-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400">Accueil</Link></li>
            {breadcrumb.map((b, i) => {
              const dernier = i === breadcrumb.length - 1;
              return (
                <li key={i} className="flex items-center gap-1">
                  <ChevronRight size={12} aria-hidden />
                  {b.to && !dernier
                    ? <Link to={b.to} className="rounded-sm text-slate-600 hover:text-dep-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400">{b.label}</Link>
                    : <span className={dernier ? 'text-slate-700' : ''} aria-current={dernier ? 'page' : undefined}>{b.label}</span>}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = '', bodyClass = 'p-4' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-dep-800">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'dep', icon: Icon, to }) {
  const tones = { dep: 'text-dep-700 bg-dep-50', rouge: 'text-red-700 bg-red-50', vert: 'text-emerald-700 bg-emerald-50', jaune: 'text-amber-700 bg-amber-50', gris: 'text-slate-700 bg-slate-100', violet: 'text-violet-700 bg-violet-50' };
  const body = (
    <div className={`card flex h-full items-center gap-3 p-4 transition ${to ? 'hover:border-dep-300 hover:shadow' : ''}`}>
      {Icon && <div className={`rounded-md p-2.5 ${tones[tone]}`}><Icon size={20} aria-hidden /></div>}
      <div className="min-w-0">
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{value ?? '—'}</div>
        <div className="text-xs font-medium uppercase leading-tight tracking-wide text-slate-600">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-lg">{body}</Link> : body;
}

// ─── États ──────────────────────────────────────────────────────────────────
export function Spinner({ label = 'Chargement…' }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status"><Loader2 className="animate-spin" size={18} aria-hidden /> {label}</div>;
}

const ALERTES = {
  info: ['border-sky-200 bg-sky-50 text-sky-900', Info],
  succes: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2],
  attention: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle],
  danger: ['border-red-200 bg-red-50 text-red-800', XCircle],
};

/** Message encadré : tone = info | succes | attention | danger (danger est annoncé aux lecteurs d’écran). */
export function Alert({ tone = 'info', title, children, action, className = '' }) {
  const [cls, Icon] = ALERTES[tone] || ALERTES.info;
  return (
    <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${cls} ${className}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{title && <div className="font-semibold">{title}</div>}{children}</div>
      {action}
    </div>
  );
}

export function ErrorAlert({ message, onRetry }) {
  if (!message) return null;
  return <Alert tone="danger" action={onRetry && <button type="button" className="link font-medium text-red-800 underline" onClick={onRetry}>Réessayer</button>}>{message}</Alert>;
}

/** Compatibilité : tone = info | warning (→ attention) | succes | danger. */
export function InfoAlert({ children, tone = 'info' }) {
  return <Alert tone={tone === 'warning' ? 'attention' : tone}>{children}</Alert>;
}

/** État vide ; compact dans les cartes de tableau de bord. */
export function Empty({ message = 'Aucun élément à afficher.', action, compact = false }) {
  if (compact) return <p className="py-3 text-sm text-slate-500">{message}</p>;
  return <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-slate-500"><Inbox size={28} className="text-slate-300" aria-hidden />{message}{action}</div>;
}

export function Loadable({ state, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <ErrorAlert message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;
  return children(state.data);
}

// ─── Badges ─────────────────────────────────────────────────────────────────
/** tone : clé de COLORS (succes, attention, danger, info, neutre, ambre, vert, rouge…). */
export function Badge({ children, tone, className = '', title }) {
  const couleur = tone ? COLORS[tone] : (/\bbg-/.test(className) ? '' : COLORS.neutre);
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${couleur} ${className}`}>{children}</span>;
}
function mapBadge(map, value) {
  const v = map[value];
  return v ? <Badge className={v[1]}>{v[0]}</Badge> : <Badge>{value || '—'}</Badge>;
}
export const StatusBadge = ({ value }) => mapBadge(STATUTS, value);
export const PrioriteBadge = ({ value }) => mapBadge(PRIORITES, value);
export const UrgenceBadge = ({ value }) => mapBadge(URGENCES, value);
export const ConfidBadge = ({ value }) => mapBadge(CONFIDENTIALITES, value);

/** Badge du rang organique — jamais d’icône de Division pour un Bureau. */
export function RangBadge({ rang }) {
  const map = { DIRECTION: ['Rang : Direction', 'bg-dep-700 text-white ring-dep-700'], DIVISION: ['Rang : Division', 'bg-indigo-600 text-white ring-indigo-600'], BUREAU: ['Rang : Bureau', 'bg-teal-700 text-white ring-teal-700'] };
  const v = map[rang];
  return v ? <Badge className={v[1]}>{v[0]}</Badge> : null;
}

export function Progress({ value = 0, label = 'Avancement' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${v === 100 ? 'bg-emerald-600' : 'bg-dep-600'}`} style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-slate-600" aria-hidden>{v} %</span>
    </div>
  );
}

// ─── Fenêtres ───────────────────────────────────────────────────────────────
function ModalContent({ title, onClose, children, footer, size, placement }) {
  const ref = useRef(null);
  const titreId = useId();
  useFocusTrap(ref, true, onClose);
  useScrollLock();
  const w = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  const haut = placement === 'top';
  return (
    <div className={`fixed inset-0 z-50 flex justify-center bg-slate-900/50 p-0 sm:p-4 no-print ${haut ? 'items-start sm:pt-16' : 'items-end sm:items-center'}`}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titreId} tabIndex={-1}
        className={`flex max-h-[92vh] w-full ${w} flex-col bg-white shadow-xl focus:outline-none sm:rounded-lg ${haut ? 'rounded-b-lg' : 'rounded-t-lg'}`}>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 id={titreId} className="font-semibold text-slate-900">{title}</h2>
          <IconButton label="Fermer" icon={X} size={18} className="-mr-1 p-1 text-slate-500" onClick={onClose} />
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Fenêtre modale : focus piégé et restitué, Échap pour fermer, défilement de la page bloqué. */
export function Modal({ open, title, onClose, children, footer, size = 'md', placement = 'center' }) {
  if (!open) return null;
  return <ModalContent title={title} onClose={onClose} footer={footer} size={size} placement={placement}>{children}</ModalContent>;
}

const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = useCallback((opts) => new Promise((resolve) => { setText(''); setState({ ...opts, resolve }); }), []);
  const close = (v) => { state?.resolve(v); setState(null); setBusy(false); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} title={state?.title || 'Confirmation'} onClose={() => close(false)} size="sm"
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => close(false)}>Annuler</button>
          <button type="button" disabled={busy || (state?.input?.required && text.trim().length < 3)} className={state?.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => { setBusy(true); close(state?.input ? text : true); }}>{state?.confirmLabel || 'Confirmer'}</button>
        </>}>
        <p className="text-sm text-slate-700">{state?.message}</p>
        {state?.input && (
          <div className="mt-3">
            <label className="label" htmlFor="confirm-input">{state.input.label}{state.input.required && <span className="text-red-600" aria-hidden> *</span>}</label>
            <textarea id="confirm-input" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={state.input.placeholder}
              aria-required={state.input.required || undefined} aria-describedby={state.input.required ? 'confirm-input-aide' : undefined} />
            {state.input.required && <p id="confirm-input-aide" className="mt-1 text-xs text-slate-500">Au moins 3 caractères.</p>}
          </div>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
/** confirm({ title, message, danger, confirmLabel, input: { label, required } }) → Promise<boolean|string> */
export const useConfirm = () => useContext(ConfirmCtx);

// ─── Formulaires ────────────────────────────────────────────────────────────
const CONTROLES = new Set(['input', 'select', 'textarea']);

/**
 * Libellé, aide et erreur d’un champ. Lorsque l’enfant est un input / select / textarea
 * (ou un composant marqué `champ = true`), Field lui attribue un id, relie le libellé
 * et expose aria-invalid, aria-required et aria-describedby.
 */
export function Field({ label, error, children, hint, required, className = '', id: idProp }) {
  const auto = useId();
  const el = isValidElement(children) ? children : null;
  const natif = !!el && CONTROLES.has(el.type);
  const relie = natif || !!el?.type?.champ;
  const id = idProp || el?.props.id || `champ${auto.replace(/:/g, '')}`;
  const aideId = `${id}-aide`;
  const erreurId = `${id}-erreur`;
  const libelleId = `${id}-libelle`;
  const decrit = [el?.props['aria-describedby'], error ? erreurId : hint ? aideId : null].filter(Boolean).join(' ') || undefined;
  const controle = relie
    ? cloneElement(el, {
      id, 'aria-describedby': decrit, 'aria-invalid': error ? true : el.props['aria-invalid'], 'aria-required': required || el.props['aria-required'],
      ...(natif ? {} : { labelId: libelleId }),
    })
    : children;
  const etoile = required && <><span className="text-red-600" aria-hidden> *</span><span className="sr-only"> (obligatoire)</span></>;
  return (
    <div className={className}>
      {label && (relie || idProp
        ? <label id={libelleId} htmlFor={id} className="label">{label}{required && <span className="text-red-600" aria-hidden> *</span>}</label>
        : <div id={libelleId} className="label">{label}{etoile}</div>)}
      {controle}
      {hint && !error && <p id={aideId} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={erreurId} className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Onglets : flèches gauche / droite, Début / Fin. */
export function Tabs({ tabs, value, onChange, label = 'Onglets' }) {
  const refs = useRef({});
  const actif = tabs.some((t) => t.value === value) ? value : tabs[0]?.value;
  const onKeyDown = (e, i) => {
    const cible = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    const t = tabs[(cible + tabs.length) % tabs.length];
    onChange(t.value);
    refs.current[t.value]?.focus();
  };
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 no-print" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.value} ref={(n) => { refs.current[t.value] = n; }} type="button" role="tab" aria-selected={actif === t.value} tabIndex={actif === t.value ? 0 : -1}
          onClick={() => onChange(t.value)} onKeyDown={(e) => onKeyDown(e, i)}
          className={`whitespace-nowrap rounded-t border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dep-400 ${actif === t.value ? 'border-dep-700 text-dep-800' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
          {t.label}{t.count ? <span className="ml-1.5 rounded-full bg-dep-100 px-1.5 text-xs text-dep-800">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ─── Tableau avec recherche, tri et vue mobile ──────────────────────────────
/**
 * Conteneur à défilement horizontal. Lorsqu’il déborde réellement, il devient atteignable au clavier
 * (Tab puis flèches) et porte un nom ; sinon il n’ajoute aucun arrêt de tabulation.
 */
export function ZoneDefilante({ label, className = '', children }) {
  const ref = useRef(null);
  const [deborde, setDeborde] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mesurer = () => setDeborde(el.scrollWidth > el.clientWidth + 1);
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dep-400 ${className}`}
      {...(deborde ? { tabIndex: 0, role: 'region', 'aria-label': `${label || 'Tableau'} (défilement horizontal)` } : {})}>
      {children}
    </div>
  );
}

/** Squelette de chargement d’un tableau (l’animation respecte la réduction des animations). */
function Squelette() {
  return (
    <div className="space-y-3 p-4" role="status">
      {[92, 84, 76, 88, 70].map((w) => <div key={w} className="h-4 rounded bg-slate-200 motion-safe:animate-pulse" style={{ width: `${w}%` }} />)}
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const vide = (x) => x === null || x === undefined || x === '';
const triable = (c) => !!(c.sortable || c.sortValue);
const valeurTri = (c, r) => (c.sortValue ? c.sortValue(r) : r[c.key]);
const cellule = (c, r) => (c.render ? c.render(r) : (r[c.key] ?? '—'));

/**
 * columns : [{ key, header, render?(row), className?, search?(row), sortable?, sortValue?(row), primary?, mobile? }]
 * - Recherche plein texte côté client, filtres fournis via `toolbar`.
 * - Tri : colonnes `sortable` (valeur brute) ou `sortValue` ; les valeurs vides sont toujours placées en dernier.
 * - Mobile (< md) : une carte par ligne ; la colonne `primary` (sinon la première) sert de titre, `mobile: false` la masque.
 * - Avec onRowClick, chaque ligne s’ouvre au clic, ou au clavier avec Entrée ou Espace.
 * - rowClassName(row) : classes d’une ligne ; encadre={false} : sans bordure, pour un tableau placé dans une carte.
 * - cartes="grille" : sur mobile, valeurs rangées sur trois colonnes (tableaux de chiffres, comme les rapports).
 * - `controle` / `onControle` ({ q, page, tri }) rendent la recherche, la page et le tri pilotables (ex. depuis l’URL).
 */
export function DataTable({
  columns, rows = [], searchable = true, toolbar, onRowClick, empty, emptyAction, pageSize = 25, rowKey = 'id', label, rowClassName, encadre = true,
  loading = false, error = null, onRetry, controle, onControle, cards = true, cartes = 'liste',
}) {
  const [interne, setInterne] = useState({ q: '', page: 1, tri: '' });
  const vue = controle || interne;
  const maj = onControle || ((patch) => setInterne((s) => ({ ...s, page: 'page' in patch ? patch.page : 1, ...patch })));
  const q = vue.q || '';
  const tri = vue.tri || '';

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const n = q.trim().toLowerCase();
    return rows.filter((r) => columns.some((c) => {
      const v = c.search ? c.search(r) : r[c.key];
      return !vide(v) && String(v).toLowerCase().includes(n);
    }));
  }, [rows, q, columns]);

  const desc = tri.startsWith('-');
  const colTri = columns.find((c) => triable(c) && c.key === (desc ? tri.slice(1) : tri));
  const sorted = useMemo(() => {
    if (!colTri) return filtered;
    return [...filtered].sort((x, y) => {
      const a = valeurTri(colTri, x);
      const b = valeurTri(colTri, y);
      if (vide(a) || vide(b)) return vide(a) === vide(b) ? 0 : vide(a) ? 1 : -1;
      const c = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
      return desc ? -c : c;
    });
  }, [filtered, colTri, desc]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(1, Number(vue.page) || 1), pages);
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize);
  const premiere = sorted.length ? (page - 1) * pageSize + 1 : 0;

  // Tri : sans tri → croissant → décroissant → sans tri.
  const trier = (c) => maj({ tri: tri === c.key ? `-${c.key}` : tri === `-${c.key}` ? '' : c.key });
  const triables = columns.filter(triable);
  const principale = columns.find((c) => c.primary) || columns[0];
  const secondaires = columns.filter((c) => c !== principale && c.mobile !== false && c.header);
  const actionsCol = columns.filter((c) => !c.header && c.mobile !== false);

  const ligneProps = (r) => (onRowClick ? {
    tabIndex: 0,
    onClick: () => onRowClick(r),
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(r); } },
  } : {});
  const focusLigne = 'focus:bg-dep-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dep-400';

  let corps;
  if (error && !rows.length) corps = <div className="p-3"><ErrorAlert message={error} onRetry={onRetry} /></div>;
  else if (loading && !rows.length) corps = <Squelette />;
  else if (!visible.length) corps = <Empty message={empty} action={emptyAction} />;

  return (
    <div className={`${encadre ? 'card ' : ''}overflow-hidden`} aria-busy={loading || undefined}>
      {(searchable || toolbar || triables.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 no-print">
          {searchable && (
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
              <input type="search" className="input pl-8" placeholder="Rechercher…" value={q} onChange={(e) => maj({ q: e.target.value })} aria-label="Rechercher dans le tableau" />
            </div>
          )}
          {toolbar}
          {cards && triables.length > 0 && (
            <select className="input w-auto md:hidden" aria-label="Trier par" value={tri} onChange={(e) => maj({ tri: e.target.value })}>
              <option value="">Ordre par défaut</option>
              {triables.flatMap((c) => [<option key={c.key} value={c.key}>{c.header} (croissant)</option>, <option key={`-${c.key}`} value={`-${c.key}`}>{c.header} (décroissant)</option>])}
            </select>
          )}
          <span className="ml-auto text-xs text-slate-500" aria-live="polite">{loading && rows.length ? 'Mise à jour…' : `${sorted.length} élément(s)`}</span>
        </div>
      )}
      {error && rows.length > 0 && <div className="border-b border-slate-100 p-3"><ErrorAlert message={error} onRetry={onRetry} /></div>}
      <ZoneDefilante label={label} className={`${cards ? 'hidden md:block' : ''} ${loading && rows.length ? 'opacity-60' : ''}`}>
        <table className="min-w-full" aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => {
                const actif = colTri === c;
                return (
                  <th key={c.key} scope="col" className={`th ${c.className || ''}`} aria-sort={triable(c) ? (actif ? (desc ? 'descending' : 'ascending') : 'none') : undefined}>
                    {triable(c) ? (
                      <button type="button" onClick={() => trier(c)} className="-mx-1 inline-flex items-center gap-1 rounded px-1 text-left uppercase tracking-wide hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400">
                        {c.header}
                        {actif ? (desc ? <ArrowDown size={13} aria-hidden /> : <ArrowUp size={13} aria-hidden />) : <ArrowUpDown size={13} className="text-slate-400" aria-hidden />}
                      </button>
                    ) : (c.header || <span className="sr-only">Actions</span>)}
                  </th>
                );
              })}
            </tr>
          </thead>
          {!corps && (
            <tbody>
              {visible.map((r, i) => (
                <tr key={r[rowKey] ?? i} {...ligneProps(r)} className={[onRowClick && `cursor-pointer hover:bg-dep-50/60 ${focusLigne}`, rowClassName?.(r)].filter(Boolean).join(' ') || undefined}>
                  {columns.map((c) => <td key={c.key} className={`td ${c.className || ''}`}>{cellule(c, r)}</td>)}
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {corps}
      </ZoneDefilante>
      {cards && (
        <div className={`md:hidden ${loading && rows.length ? 'opacity-60' : ''}`}>
          {corps || (
            <ul className="divide-y divide-slate-100" aria-label={label}>
              {visible.map((r, i) => (
                <li key={r[rowKey] ?? i} {...ligneProps(r)} className={`p-3 ${onRowClick ? `cursor-pointer active:bg-dep-50 ${focusLigne}` : ''}`}>
                  <div className="font-medium text-slate-900">{cellule(principale, r)}</div>
                  {secondaires.length > 0 && (
                    cartes === 'grille' ? (
                      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                        {secondaires.map((c) => (
                          <div key={c.key} className="flex min-w-0 flex-col-reverse">
                            <dt className="truncate text-xs text-slate-500">{c.header}</dt>
                            <dd className="min-w-0 break-words">{cellule(c, r)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <dl className="mt-1.5 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                        {secondaires.map((c) => (
                          <div key={c.key} className="contents">
                            <dt className="text-xs leading-5 text-slate-500">{c.header}</dt>
                            <dd className="min-w-0 break-words">{cellule(c, r)}</dd>
                          </div>
                        ))}
                      </dl>
                    )
                  )}
                  {actionsCol.map((c) => <div key={c.key} className="mt-2">{cellule(c, r)}</div>)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {pages > 1 && (
        <nav className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 p-2 text-sm no-print" aria-label="Pagination">
          <span className="mr-auto px-1 text-xs text-slate-500">{premiere}–{premiere + visible.length - 1} sur {sorted.length}</span>
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => maj({ page: page - 1 })}>Précédent</button>
          <span className="text-slate-600" aria-live="polite">Page {page} / {pages}</span>
          <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => maj({ page: page + 1 })}>Suivant</button>
        </nav>
      )}
    </div>
  );
}

/** Liste de filtre. `label` (sinon le texte de l’option vide) est lu par les lecteurs d’écran. */
export function Select({ value, onChange, options, placeholder = 'Tous', className = 'input w-auto', label }) {
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label || placeholder}>
      <option value="">{placeholder}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function KeyValues({ items, cols = 2 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${{ 1: '', 3: 'sm:grid-cols-3' }[cols] ?? 'sm:grid-cols-2'}`}>
      {items.filter(Boolean).map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Pages de liste ─────────────────────────────────────────────────────────
const enTexte = (x) => (x === undefined || x === null ? '' : String(x));

/** « ?a=1&b=2 » à partir d’un objet, en ignorant les valeurs vides ; chaîne vide si rien. */
export function queryString(obj) {
  const s = new URLSearchParams(Object.entries(obj).filter(([, v]) => !vide(v)).map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : '';
}

/**
 * État d’une liste conservé dans l’URL (filtres, onglet, recherche `q`, `page`, `tri`) :
 * il est retrouvé au retour d’une fiche et peut être partagé. Les valeurs égales aux défauts ne sont pas écrites.
 * Modifier autre chose que la page ramène à la première page.
 */
export function useListParams(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const defRef = useRef(defaults);
  defRef.current = defaults;
  const defaut = (k) => (k === 'page' ? '1' : enTexte(defRef.current[k]));
  const valeurs = { q: '', page: '1', tri: '', ...Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, enTexte(v)])), ...Object.fromEntries(params) };
  const set = useCallback((patch) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    const p = 'page' in patch ? patch : { ...patch, page: '1' };
    for (const [k, v] of Object.entries(p)) {
      if (enTexte(v) === defaut(k)) n.delete(k); else n.set(k, enTexte(v));
    }
    return n;
  }, { replace: true }), [setParams]); // eslint-disable-line react-hooks/exhaustive-deps
  return { valeurs, set, defaut };
}

/**
 * Page de liste standard : en-tête, onglets, filtres, recherche, tri et tableau, état conservé dans l’URL.
 * liste : retour de useListParams ; tabs : { key, label, items } ; filtres : [{ key, label, placeholder, options }].
 */
export function ListPage({
  title, subtitle, breadcrumb, actions, liste, tabs, filtres = [], toolbar, state, rows, columns, onRowClick, empty, rowKey, pageSize,
}) {
  const { valeurs: v, set, defaut } = liste;
  const cles = filtres.map((f) => f.key);
  const actifs = cles.some((k) => v[k] !== defaut(k)) || !!v.q;
  const effacer = () => set(Object.fromEntries([...cles, 'q'].map((k) => [k, defaut(k)])));
  const bouton = <button type="button" className="btn-ghost btn-sm" onClick={effacer}><X size={14} aria-hidden /> Effacer les filtres</button>;
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} breadcrumb={breadcrumb} actions={actions} />
      {tabs && <Tabs label={tabs.label} tabs={tabs.items} value={v[tabs.key]} onChange={(x) => set({ [tabs.key]: x })} />}
      <DataTable
        columns={columns} rows={rows ?? state.data?.data ?? []} label={title} rowKey={rowKey} pageSize={pageSize} onRowClick={onRowClick}
        loading={state.loading} error={state.error} onRetry={state.reload}
        controle={{ q: v.q, page: v.page, tri: v.tri }} onControle={set}
        empty={actifs ? 'Aucun résultat pour ces critères.' : empty} emptyAction={actifs && bouton}
        toolbar={<>
          {filtres.map((f) => <Select key={f.key} label={f.label} placeholder={f.placeholder} value={v[f.key]} onChange={(x) => set({ [f.key]: x })} options={f.options} />)}
          {toolbar}
          {actifs && bouton}
        </>} />
    </>
  );
}

// ─── Fiches et circuits ─────────────────────────────────────────────────────
const TON_ALERTE = { attention: 'bg-amber-500 text-white', danger: 'bg-red-600 text-white' };
const BARRE_ALERTE = { attention: 'bg-amber-500', danger: 'bg-red-600' };

/**
 * Frise des étapes d’un circuit (voir lib/workflows.js) : { etapes, courante, alerte, termine, sautees, details }.
 * Une étape « sautée » précède l’étape en cours mais n’a pas eu lieu (le circuit le permet).
 * Complète à partir de sm, réduite à « Étape n sur N » et une barre segmentée sur mobile.
 */
const LIBELLE_ETAT = { fait: ' : étape franchie', actif: ' : étape en cours', avenir: ' : à venir', saute: ' : étape non effectuée' };

export function WorkflowStatus({ etapes, courante, alerte, termine = false, sautees = [], details = {} }) {
  const etat = (i) => {
    if (i < courante) return sautees.includes(i) ? 'saute' : 'fait';
    if (i === courante) return termine ? 'fait' : 'actif';
    return 'avenir';
  };
  const pastille = (e) => (e === 'fait' ? 'bg-dep-600 text-white'
    : e === 'actif' ? (alerte ? TON_ALERTE[alerte.tone] : 'border-2 border-dep-600 bg-white text-dep-700')
      : e === 'saute' ? 'border-2 border-dashed border-slate-300 bg-white text-slate-400'
        : 'bg-slate-200 text-slate-600');
  return (
    <div>
      <ol className="hidden sm:flex sm:items-start" aria-label="Étapes du circuit">
        {etapes.map((l, i) => {
          const e = etat(i);
          return (
            <li key={l} aria-current={i === courante ? 'step' : undefined} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
              {i > 0 && <span aria-hidden className={`absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2 ${i <= courante ? 'bg-dep-600' : 'bg-slate-200'}`} />}
              <span aria-hidden className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-white ${pastille(e)}`}>
                {e === 'fait' ? <Check size={14} /> : e === 'saute' ? '–' : i + 1}
              </span>
              <span className={`mt-1.5 px-1 text-xs leading-tight ${e === 'actif' ? 'font-semibold text-slate-900' : e === 'fait' ? 'text-slate-700' : e === 'saute' ? 'italic text-slate-500' : 'text-slate-500'}`}>
                {l}<span className="sr-only">{LIBELLE_ETAT[e]}</span>
              </span>
              {e === 'saute' && <span className="px-1 text-xs italic leading-tight text-slate-500" aria-hidden>non effectuée</span>}
              {i === courante && alerte && <Badge tone={alerte.tone} className="mt-1">{alerte.label}</Badge>}
              {details[i] && <span className="mt-0.5 px-1 text-xs leading-tight text-slate-500">{details[i]}</span>}
            </li>
          );
        })}
      </ol>
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold text-slate-900">{etapes[courante]}</span>
          <span className="shrink-0 text-xs text-slate-500">Étape {courante + 1} sur {etapes.length}</span>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {etapes.map((l, i) => {
            const e = etat(i);
            return <span key={l} className={`h-1.5 flex-1 rounded-full ${e === 'fait' ? 'bg-dep-600' : e === 'actif' ? (alerte ? BARRE_ALERTE[alerte.tone] : 'bg-dep-300') : 'bg-slate-200'}`} />;
          })}
        </div>
        {(alerte || details[courante]) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {alerte && <Badge tone={alerte.tone}>{alerte.label}</Badge>}
            {details[courante]}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Encadré « Circuit de traitement » d’une fiche : frise, message éventuel, puis les actions possibles
 * à l’étape en cours (tableau d’éléments ; les valeurs fausses sont ignorées) ou, à défaut, qui doit agir.
 */
export function WorkflowPanel({ circuit, actions = [], message, attente }) {
  const liste = actions.filter(Boolean);
  return (
    <section className="card mb-4 p-4" aria-labelledby="circuit-titre">
      <h2 id="circuit-titre" className="mb-3 text-sm font-semibold uppercase tracking-wide text-dep-800">Circuit de traitement</h2>
      <WorkflowStatus {...circuit} />
      {message && <div className="mt-4">{message}</div>}
      {liste.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-dep-200 bg-dep-50/60 p-3 no-print sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-dep-900">Actions possibles à cette étape</p>
          <div className="flex flex-wrap gap-2 sm:ml-auto">{liste}</div>
        </div>
      ) : attente && <p className="mt-4 text-sm text-slate-600">{attente}</p>}
    </section>
  );
}

/** Mise en page d’une fiche : contenu principal (2/3) et colonne d’informations (1/3), empilés sur mobile. */
export function DetailLayout({ main, aside }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">{main}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  );
}

// ─── Formulaires : saisie non enregistrée ───────────────────────────────────
/**
 * Avertit avant de quitter une page dont la saisie n’est pas enregistrée : navigation dans l’application
 * (y compris le bouton Retour) par une fenêtre de confirmation, fermeture ou rechargement de l’onglet
 * par l’avertissement du navigateur. La déconnexion (inactivité, session expirée) n’est jamais bloquée.
 * when : vrai tant qu’il y a des modifications à perdre (faux pendant l’enregistrement).
 */
export function UnsavedChangesGuard({ when, message = 'Vos modifications n’ont pas été enregistrées. Si vous quittez cette page, elles seront perdues.' }) {
  const actif = useRef(when);
  actif.current = when;
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => actif.current
    && currentLocation.pathname !== nextLocation.pathname
    && nextLocation.pathname !== '/connexion' && !!useAuth.getState().user, []));
  useEffect(() => {
    if (!when) return undefined;
    const avant = (e) => { if (!useAuth.getState().user) return; e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avant);
    return () => window.removeEventListener('beforeunload', avant);
  }, [when]);
  // Si la saisie redevient enregistrée pendant que la fenêtre est ouverte, la navigation reprend.
  useEffect(() => { if (blocker.state === 'blocked' && !when) blocker.proceed(); }, [blocker, when]);
  return (
    <Modal open={blocker.state === 'blocked'} title="Quitter sans enregistrer ?" size="sm" onClose={() => blocker.reset?.()}
      footer={<>
        <button type="button" className="btn-secondary" data-autofocus onClick={() => blocker.reset?.()}>Rester sur la page</button>
        <button type="button" className="btn-danger" onClick={() => blocker.proceed?.()}>Quitter sans enregistrer</button>
      </>}>
      <p className="text-sm text-slate-700">{message}</p>
    </Modal>
  );
}

// ─── Tableaux de bord ───────────────────────────────────────────────────────
/** Lien d’en-tête de carte vers la liste complète. */
export function CardLink({ to, children = 'Voir tout' }) {
  return <Link to={to} className="link inline-flex items-center gap-1 text-sm no-underline hover:underline">{children}<ChevronRight size={14} aria-hidden /></Link>;
}

/**
 * Petites valeurs chiffrées en grille : la valeur au-dessus, son libellé dessous.
 * items : [[libellé, valeur, ton]] — ton 'danger' met en rouge une valeur non nulle (retards…).
 */
export function MiniStats({ items, cols = 2 }) {
  return (
    <dl className={`grid gap-3 ${cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
      {items.map(([libelle, valeur, ton]) => (
        <div key={libelle} className="flex flex-col-reverse rounded-md bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">{libelle}</dt>
          <dd className={`text-xl font-semibold tabular-nums ${ton === 'danger' && Number(valeur) > 0 ? 'text-red-700' : 'text-slate-900'}`}>{valeur ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Barres horizontales d’une seule série en pourcentage (taux d’exécution…) : une seule teinte,
 * piste d’un ton plus clair de la même gamme, valeur écrite au bout de chaque ligne.
 * Le détail s’affiche au survol et au focus clavier ; il n’est jamais le seul accès à l’information.
 * rows : [{ key, label, value (0–100 ou null), strong, indent, avant, apres, detail: [[libellé, valeur]] }]
 */
export function BarList({ rows, label, sansValeur = 'aucune activité' }) {
  const [actif, setActif] = useState(null);
  return (
    <ul className="space-y-0.5" aria-label={label}>
      {rows.map((r) => {
        const vide = r.value === null || r.value === undefined;
        const texte = vide ? sansValeur : `${r.value} %`;
        const infoId = `barre-${String(r.key).replace(/\W/g, '')}`;
        return (
          <li key={r.key} tabIndex={r.detail ? 0 : undefined} aria-describedby={r.detail ? infoId : undefined}
            onMouseEnter={() => setActif(r.key)} onMouseLeave={() => setActif(null)} onFocus={() => setActif(r.key)} onBlur={() => setActif(null)}
            className={`relative grid grid-cols-1 items-center gap-1 rounded px-1.5 py-1.5 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3`}>
            {/* Le retrait ne touche que le libellé : toutes les barres partent de la même ligne de base. */}
            <div className={`flex min-w-0 flex-wrap items-center gap-2 ${r.indent ? 'sm:pl-6' : ''}`}>
              {r.avant}
              <span className={`min-w-0 truncate text-sm ${r.strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{r.label}</span>
              {r.apres}
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 flex-1 overflow-hidden bg-dep-100" aria-hidden>
                {!vide && r.value > 0 && <div className="h-full rounded-r bg-dep-600" style={{ width: `${Math.min(100, r.value)}%` }} />}
              </div>
              <span className={`w-28 shrink-0 text-right text-xs tabular-nums ${vide ? 'text-slate-500' : 'font-medium text-slate-800'}`}>{texte}</span>
            </div>
            {r.detail && (
              <div id={infoId} role="tooltip" className={actif === r.key
                ? 'pointer-events-none absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2.5 text-xs shadow-lg'
                : 'sr-only'}>
                <div className="mb-1.5 text-slate-900"><b className="tabular-nums">{texte}</b> — {r.label}</div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
                  {r.detail.map(([k, v]) => <Fragment key={k}><dt className="text-slate-600">{k}</dt><dd className="text-right font-medium tabular-nums text-slate-900">{v}</dd></Fragment>)}
                </dl>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
