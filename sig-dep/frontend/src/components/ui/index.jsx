import { useEffect, useMemo, useState, useCallback, createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Loader2, Search, X, Inbox } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { STATUTS, PRIORITES, URGENCES, CONFIDENTIALITES } from '../../lib/labels';

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

export function Toaster() {
  const { items, remove } = useToasts();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 no-print" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`flex items-start gap-2 rounded-md border p-3 text-sm shadow-lg ${t.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : t.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-sky-200 bg-sky-50 text-sky-800'}`}>
          {t.type === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : t.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <Info size={18} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{t.message}</span>
          <button type="button" onClick={() => remove(t.id)} aria-label="Fermer"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}

/** Exécute une action API avec toast de succès/erreur. */
export async function runAction(fn, successMessage) {
  try {
    const r = await fn();
    if (successMessage) toast.success(successMessage);
    return r;
  } catch (e) {
    toast.error(errorMessage(e));
    throw e;
  }
}

// ─── Mise en page ───────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, breadcrumb = [], actions }) {
  return (
    <div className="mb-5">
      {breadcrumb.length > 0 && (
        <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500 no-print" aria-label="Fil d’Ariane">
          <Link to="/" className="hover:text-dep-700">Accueil</Link>
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight size={12} />
              {b.to ? <Link to={b.to} className="hover:text-dep-700">{b.label}</Link> : <span className="text-slate-700">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
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
    <div className="card flex items-center gap-3 p-4 transition hover:shadow">
      {Icon && <div className={`rounded-md p-2.5 ${tones[tone]}`}><Icon size={20} /></div>}
      <div className="min-w-0">
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{value ?? '—'}</div>
        <div className="text-xs font-medium uppercase leading-tight tracking-wide text-slate-500">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

// ─── États ──────────────────────────────────────────────────────────────────
export function Spinner({ label = 'Chargement…' }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> {label}</div>;
}

export function ErrorAlert({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button type="button" className="font-medium underline" onClick={onRetry}>Réessayer</button>}
    </div>
  );
}

export function InfoAlert({ children, tone = 'info' }) {
  const cls = tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900';
  return <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${cls}`}><Info size={18} className="mt-0.5 shrink-0" /><div>{children}</div></div>;
}

export function Empty({ message = 'Aucun élément à afficher.' }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-slate-500"><Inbox size={28} className="text-slate-300" />{message}</div>;
}

export function Loadable({ state, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <ErrorAlert message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;
  return children(state.data);
}

// ─── Badges ─────────────────────────────────────────────────────────────────
export function Badge({ children, className = 'bg-slate-100 text-slate-700 ring-slate-200', title }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>{children}</span>;
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
  const map = { DIRECTION: ['Rang : Direction', 'bg-dep-700 text-white ring-dep-700'], DIVISION: ['Rang : Division', 'bg-indigo-600 text-white ring-indigo-600'], BUREAU: ['Rang : Bureau', 'bg-teal-600 text-white ring-teal-600'] };
  const v = map[rang];
  return v ? <Badge className={v[1]}>{v[0]}</Badge> : null;
}

export function Progress({ value = 0 }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2" title={`${v} %`}>
      <div className="h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${v === 100 ? 'bg-emerald-600' : 'bg-dep-600'}`} style={{ width: `${v}%` }} /></div>
      <span className="w-10 text-right text-xs tabular-nums text-slate-600">{v} %</span>
    </div>
  );
}

// ─── Fenêtres ───────────────────────────────────────────────────────────────
export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4 no-print" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-[92vh] w-full ${w} flex-col rounded-t-lg bg-white shadow-xl sm:rounded-lg`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t bg-slate-50 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
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
            <label className="label" htmlFor="confirm-input">{state.input.label}</label>
            <textarea id="confirm-input" className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={state.input.placeholder} />
            {state.input.required && <p className="mt-1 text-xs text-slate-500">Au moins 3 caractères.</p>}
          </div>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
/** confirm({ title, message, danger, confirmLabel, input: { label, required } }) → Promise<boolean|string> */
export const useConfirm = () => useContext(ConfirmCtx);

// ─── Formulaires ────────────────────────────────────────────────────────────
export function Field({ label, error, children, hint, required, className = '' }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}{required && <span className="text-red-600"> *</span>}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 no-print" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${value === t.value ? 'border-dep-700 text-dep-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}{t.count ? <span className="ml-1.5 rounded-full bg-dep-100 px-1.5 text-xs text-dep-800">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ─── Tableau avec recherche ─────────────────────────────────────────────────
/**
 * columns : [{ key, header, render?(row), className?, search?: (row) => string }]
 * Recherche plein texte côté client sur les colonnes, filtres fournis via `toolbar`.
 */
export function DataTable({ columns, rows = [], searchable = true, toolbar, onRowClick, empty, pageSize = 25, rowKey = 'id' }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const n = q.trim().toLowerCase();
    return rows.filter((r) => columns.some((c) => {
      const v = c.search ? c.search(r) : r[c.key];
      return v !== null && v !== undefined && String(v).toLowerCase().includes(n);
    }));
  }, [rows, q, columns]);
  useEffect(() => setPage(1), [q, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div className="card overflow-hidden">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 no-print">
          {searchable && (
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input className="input pl-8" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
            </div>
          )}
          {toolbar}
          <span className="ml-auto text-xs text-slate-500">{filtered.length} élément(s)</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead><tr>{columns.map((c) => <th key={c.key} className={`th ${c.className || ''}`}>{c.header}</th>)}</tr></thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r[rowKey] ?? i} className={onRowClick ? 'cursor-pointer hover:bg-dep-50/60' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => <td key={c.key} className={`td ${c.className || ''}`}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <Empty message={empty} />}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-2 text-sm no-print">
          <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button>
          <span className="text-slate-600">Page {page} / {pages}</span>
          <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</button>
        </div>
      )}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder = 'Tous', className = 'input w-auto' }) {
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function KeyValues({ items, cols = 2 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {items.filter(Boolean).map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}
