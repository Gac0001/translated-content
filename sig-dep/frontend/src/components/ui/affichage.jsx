// Composants d’affichage : tableau simple, état vide, indicateur clé, file « À traiter », barre de filtres.
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, Inbox, X } from 'lucide-react';
import { fmtDate, isOverdue } from '../../lib/format';
import { Card, CardLink, ErrorAlert, Select, ZoneDefilante } from './index';

const ALIGN = { right: 'text-right tabular-nums', center: 'text-center' };

// ─── Tableau simple ─────────────────────────────────────────────────────────
/**
 * Tableau de restitution sans recherche ni pagination (tableaux de chiffres, synthèses, annexes),
 * au style commun et défilant horizontalement sur téléphone.
 * columns : [{ key, header, render?(row), align?: 'right' | 'center', className?, rowHeader? }] —
 * la colonne `rowHeader` (sinon la première) est l’en-tête de ligne lu par les lecteurs d’écran.
 * footer : lignes de total, rendues en gras dans <tfoot> avec les mêmes colonnes.
 * rowClassName(row), onRowClick(row), dense, empty (message), figee (première colonne fixe).
 * groupes : ligne d’en-tête au-dessus des colonnes, [{ label, colSpan }] (« Réalisations », « 2027 »…) ;
 * une colonne `debutGroupe` reçoit un filet vertical à gauche.
 */
export function SimpleTable({
  columns, rows = [], footer = [], rowKey = 'id', label, caption, empty = 'Aucune donnée.', dense = false,
  rowClassName, onRowClick, figee = false, groupes,
}) {
  const tete = columns.find((c) => c.rowHeader) || columns[0];
  const pad = dense ? 'py-1.5' : '';
  // Première colonne fixe au défilement horizontal : fond opaque repris de la ligne (en-tête : fond de .th).
  const fixe = (c, entete = false) => (figee && c === columns[0] ? `sticky left-0 z-10 ${entete ? '' : 'bg-inherit'}` : '');
  const cellule = (c, r, i, pied) => {
    const contenu = c.render ? c.render(r, i) : (r[c.key] ?? '—');
    const cls = `td ${pad} ${ALIGN[c.align] || ''} ${c.debutGroupe ? 'border-l border-l-slate-200' : ''} ${c.className || ''} ${fixe(c)}`;
    return c === tete
      ? <th key={c.key} scope="row" className={`${cls} text-left ${pied ? 'font-semibold' : 'font-normal'}`}>{contenu}</th>
      : <td key={c.key} className={cls}>{contenu}</td>;
  };
  const ligneProps = (r) => (onRowClick ? {
    tabIndex: 0, onClick: () => onRowClick(r),
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(r); } },
  } : {});
  return (
    <ZoneDefilante label={label}>
      <table className="min-w-full" aria-label={caption ? undefined : label}>
        {caption && <caption className="px-3 py-2 text-left text-sm font-medium text-slate-700">{caption}</caption>}
        <thead>
          {groupes && (
            <tr>{groupes.map((g, i) => <th key={i} scope={g.label ? 'colgroup' : undefined} colSpan={g.colSpan || 1} className={`th border-b-0 pb-0 text-center ${i ? 'border-l border-l-slate-200' : ''}`}>{g.label}</th>)}</tr>
          )}
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={`th ${ALIGN[c.align] || ''} ${c.debutGroupe ? 'border-l border-l-slate-200' : ''} ${c.className || ''} ${fixe(c, true)}`}>{c.header ?? <span className="sr-only">Actions</span>}</th>)}</tr>
        </thead>
        <tbody className="bg-white">
          {rows.length === 0 && <tr><td colSpan={columns.length} className="td py-6 text-center text-slate-500">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} {...ligneProps(r)}
              className={[onRowClick && 'cursor-pointer hover:bg-dep-50/60 focus:bg-dep-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dep-400', rowClassName?.(r)].filter(Boolean).join(' ') || undefined}>
              {columns.map((c) => cellule(c, r, i, false))}
            </tr>
          ))}
        </tbody>
        {footer.length > 0 && (
          <tfoot className="bg-[#f1f4f8] font-semibold">
            {footer.map((r, i) => <tr key={r[rowKey] ?? `pied-${i}`}>{columns.map((c) => cellule(c, r, i, true))}</tr>)}
          </tfoot>
        )}
      </table>
    </ZoneDefilante>
  );
}

// ─── États ──────────────────────────────────────────────────────────────────
/**
 * État vide explicatif : pourquoi la liste est vide et quoi faire (action principale).
 * compact : marges réduites (section vide dans une page chargée). Pour un simple message dans une carte
 * de tableau de bord, utiliser Empty compact.
 */
export function EmptyState({ icon: Icon = Inbox, title, children, action, className = '', compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-4 text-center ${compact ? 'py-5' : 'py-10'} ${className}`}>
      <span className={`mb-1 rounded-full bg-dep-50 text-dep-600 ${compact ? 'p-2' : 'p-3'}`}><Icon size={compact ? 20 : 26} aria-hidden /></span>
      {title && <p className="font-display text-base font-semibold text-slate-800">{title}</p>}
      {children && <div className="max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

// ─── Indicateur clé ─────────────────────────────────────────────────────────
const TONS_KPI = { dep: 'border-t-dep-700', vert: 'border-t-emerald-700', rouge: 'border-t-red-700', jaune: 'border-t-amber-500', gris: 'border-t-slate-400' };

/**
 * Indicateur clé : valeur et unité, évolution par rapport à une valeur de référence, cible et progression.
 * valeur : texte déjà formaté (fmtNombre…) ; evolution : { valeur: nombre (écart), texte, favorable: bool | null } ;
 * cible : texte ; progression : 0–100 (barre « vers la cible ») ; to : lien vers le détail.
 */
export function KpiTile({ label, valeur, unite, evolution, reference, cible, progression, tone = 'dep', to, aide }) {
  const sens = !evolution || !evolution.valeur ? 0 : evolution.valeur > 0 ? 1 : -1;
  const Fleche = sens > 0 ? ArrowUpRight : sens < 0 ? ArrowDownRight : ArrowRight;
  const couleur = evolution?.favorable === true ? 'text-emerald-800 bg-emerald-50' : evolution?.favorable === false ? 'text-red-800 bg-red-50' : 'text-slate-700 bg-slate-100';
  const p = progression === null || progression === undefined ? null : Math.max(0, Math.min(100, Number(progression) || 0));
  const corps = (
    <div className={`card flex h-full flex-col gap-2 border-t-[3px] ${TONS_KPI[tone] || TONS_KPI.dep} p-4 ${to ? 'transition hover:shadow' : ''}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-display text-[28px] font-bold leading-none tabular-nums text-dep-700">{valeur ?? '—'}</span>
        {unite && <span className="text-sm text-slate-600">{unite}</span>}
      </div>
      {evolution && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold tabular-nums ${couleur}`}>
            <Fleche size={13} aria-hidden />{evolution.texte}
            {evolution.favorable !== null && evolution.favorable !== undefined && <span className="sr-only">{evolution.favorable ? ' (évolution favorable)' : ' (évolution défavorable)'}</span>}
          </span>
          {reference && <span className="text-slate-500">{reference}</span>}
        </div>
      )}
      {(cible || p !== null) && (
        <div className="mt-auto pt-1">
          {p !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-dep-100" role="progressbar" aria-label={`${label} : progression vers la cible`} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full ${p >= 100 ? 'bg-emerald-600' : 'bg-dep-600'}`} style={{ width: `${p}%` }} />
            </div>
          )}
          {cible && <div className="mt-1 text-xs text-slate-600">Cible : <span className="font-medium text-slate-800">{cible}</span>{p !== null && ` · ${p} %`}</div>}
        </div>
      )}
      {aide && <div className="text-xs text-slate-500">{aide}</div>}
    </div>
  );
  return to ? <Link to={to} className="block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400">{corps}</Link> : corps;
}

// ─── File « À traiter » ─────────────────────────────────────────────────────
/**
 * Carte de tableau de bord listant ce qui attend l’utilisateur (PTBA à vérifier, réponses à contrôler…).
 * items : [{ id, titre, detail?, to, badge?, echeance?, statut? }] — échéance dépassée en rouge ;
 * total : nombre total (si la liste est tronquée) ; voirTout : lien vers la liste complète.
 */
export function WorkQueue({ title, items = [], total, voirTout, vide = 'Rien à traiter.', loading = false, error, onRetry, max = 5 }) {
  const n = total ?? items.length;
  return (
    <Card bodyClass="p-0"
      title={<span className="inline-flex items-center gap-2">{title}<span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${n ? 'bg-dep-700 text-white' : 'bg-slate-200 text-slate-600'}`}>{loading ? '…' : n}</span></span>}
      actions={voirTout && <CardLink to={voirTout} />}>
      {error ? <div className="p-3"><ErrorAlert message={error} onRetry={onRetry} /></div>
        : loading && !items.length ? <p className="px-4 py-3 text-sm text-slate-500" role="status">Chargement…</p>
          : !items.length ? <p className="px-4 py-3 text-sm text-slate-500">{vide}</p>
            : (
              <ul className="divide-y divide-slate-100">
                {items.slice(0, max).map((it) => {
                  const retard = it.echeance && isOverdue(it.echeance, it.statut);
                  return (
                    <li key={it.id}>
                      <Link to={it.to} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-dep-50/60 focus:bg-dep-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dep-400">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900 group-hover:text-dep-700">{it.titre}</div>
                          {(it.detail || it.echeance) && (
                            <div className={`truncate text-xs ${it.alerte ? 'font-medium text-red-700' : 'text-slate-500'}`}>
                              {it.detail}{it.detail && it.echeance && ' · '}
                              {it.echeance && <span className={retard ? 'font-semibold text-red-700' : ''}>{retard ? 'En retard — ' : 'Échéance '}{fmtDate(it.echeance)}</span>}
                            </div>
                          )}
                        </div>
                        {it.badge}
                        <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
                {n > Math.min(max, items.length) && <li className="px-4 py-2 text-xs text-slate-500">et {n - Math.min(max, items.length)} autre(s)…</li>}
              </ul>
            )}
    </Card>
  );
}

// ─── Filtres ────────────────────────────────────────────────────────────────
/**
 * Barre de filtres hors tableau (tableaux croisés, exécution, rapports) : listes déroulantes,
 * contenu libre et « Effacer les filtres » lorsqu’un filtre diffère de sa valeur par défaut.
 * filtres : [{ key, label, placeholder, options: [[valeur, libellé]], defaut? }] ; valeurs ; onChange(key, v).
 */
export function FilterBar({ filtres = [], valeurs = {}, onChange, onReset, children, className = '' }) {
  const actifs = filtres.some((f) => (valeurs[f.key] ?? '') !== (f.defaut ?? ''));
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 no-print ${className}`} role="group" aria-label="Filtres">
      {filtres.map((f) => <Select key={f.key} label={f.label} placeholder={f.placeholder} value={valeurs[f.key]} onChange={(v) => onChange(f.key, v)} options={f.options} />)}
      {children}
      {actifs && onReset && <button type="button" className="btn-ghost btn-sm" onClick={onReset}><X size={14} aria-hidden /> Effacer les filtres</button>}
    </div>
  );
}
