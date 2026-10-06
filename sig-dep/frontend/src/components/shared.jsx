import { useRef, useState } from 'react';
import { Download, FileDown, FileSpreadsheet, FileText, Paperclip, Plus, Printer, Trash2, Upload, X } from 'lucide-react';
import api, { download, errorMessage } from '../lib/api';
import { fmtDate, fmtDateTime, fmtTaille } from '../lib/format';
import { ACTIONS_HISTO } from '../lib/labels';
import { useAuth } from '../store/auth';
import { StatusBadge, toast, useApi, useConfirm, Empty } from './ui';

// ─── Historique horodaté ────────────────────────────────────────────────────
export function Timeline({ items = [] }) {
  if (!items.length) return <Empty message="Aucun historique." />;
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {items.map((h) => (
        <li key={h.id} className="mb-4 ml-4">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-dep-600 ring-2 ring-white" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-900">{ACTIONS_HISTO[h.action] || h.action}</span>
            {h.nouveau_statut && <StatusBadge value={h.nouveau_statut} />}
            {h.avancement !== null && h.avancement !== undefined && <span className="text-xs text-slate-500">{h.avancement} %</span>}
          </div>
          <div className="text-xs text-slate-500">{fmtDateTime(h.created_at)} · {h.auteur?.trim() || h.username || 'Système'}</div>
          {h.commentaire && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{h.commentaire}</p>}
        </li>
      ))}
    </ol>
  );
}

// ─── Exports ────────────────────────────────────────────────────────────────
export function ExportButtons({ base, formats = ['pdf', 'xlsx'], print = true, query = '' }) {
  const can = useAuth((s) => s.can);
  const [busy, setBusy] = useState(null);
  if (!can('exports.generer')) return print ? <button type="button" className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Imprimer</button> : null;
  const icons = { pdf: FileDown, xlsx: FileSpreadsheet, docx: FileText };
  const labels = { pdf: 'PDF', xlsx: 'Excel', docx: 'Word' };
  const go = async (f) => {
    setBusy(f);
    try { await download(`${base}/${f}${query}`, `export.${f}`); } catch (e) { toast.error(errorMessage(e, 'Export impossible.')); } finally { setBusy(null); }
  };
  return (
    <>
      {formats.map((f) => { const I = icons[f]; return <button key={f} type="button" className="btn-secondary" disabled={!!busy} onClick={() => go(f)}><I size={16} /> {busy === f ? '…' : labels[f]}</button>; })}
      {print && <button type="button" className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Imprimer</button>}
    </>
  );
}

// ─── Pièces jointes ─────────────────────────────────────────────────────────
/** Pièces jointes d’un élément ; avec `preuve`, l’envoi marque les fichiers comme preuves d’exécution. */
export function Attachments({ type, id, canUpload = true, preuve = false }) {
  const state = useApi(`/attachments/${type}/${id}`);
  const user = useAuth((s) => s.user);
  const confirm = useConfirm();
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('fichiers', f));
    setBusy(true);
    try {
      await api.post(`/attachments/${type}/${id}${preuve ? '?categorie=PREUVE' : ''}`, fd);
      toast.success('Pièce(s) jointe(s) ajoutée(s).');
      state.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  const remove = async (a) => {
    if (!(await confirm({ title: 'Retirer la pièce jointe', message: `Retirer « ${a.original_name} » ? Le fichier reste conservé pour la traçabilité.`, danger: true, confirmLabel: 'Retirer' }))) return;
    try { await api.delete(`/attachments/fichier/${a.id}`); state.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const rows = state.data?.data || [];
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {rows.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
            <Paperclip size={15} className="shrink-0 text-slate-400" />
            <button type="button" className="min-w-0 flex-1 truncate text-left text-dep-700 hover:underline" onClick={() => download(`/attachments/fichier/${a.id}`, a.original_name).catch((e) => toast.error(errorMessage(e)))}>{a.original_name}</button>
            {a.categorie === 'PREUVE' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">Preuve</span>}
            <span className="hidden text-xs text-slate-500 sm:inline">{fmtTaille(a.size_bytes)} · {fmtDate(a.created_at)} · {a.username}</span>
            <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => download(`/attachments/fichier/${a.id}`, a.original_name)} aria-label="Télécharger"><Download size={15} /></button>
            {a.uploaded_by === user.id && canUpload && <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => remove(a)} aria-label="Retirer"><Trash2 size={15} /></button>}
          </li>
        ))}
      </ul>
      {!rows.length && !state.loading && <p className="py-2 text-sm text-slate-500">Aucune pièce jointe.</p>}
      {canUpload && (
        <label className={`btn-secondary mt-2 cursor-pointer ${busy ? 'opacity-50' : ''}`}>
          <Upload size={16} /> {busy ? 'Envoi…' : preuve ? 'Joindre une preuve d’exécution' : 'Joindre des fichiers'}
          <input ref={ref} type="file" multiple className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt,.csv,.zip" />
        </label>
      )}
      {canUpload && <p className="mt-1 text-xs text-slate-500">PDF, Word, Excel, PowerPoint, images, texte ou ZIP — 15 Mo maximum par fichier.</p>}
    </div>
  );
}

// ─── Formulaires guidés dynamiques (documents, PIP) ─────────────────────────
function ListInput({ value = [], onChange, disabled }) {
  const items = value.length ? value : [''];
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex gap-2">
          <span className="mt-2 text-xs text-slate-400">{i + 1}.</span>
          <input className="input" value={v} disabled={disabled} onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n); }} />
          {!disabled && <button type="button" className="btn-ghost px-2" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Supprimer la ligne"><X size={16} /></button>}
        </div>
      ))}
      {!disabled && <button type="button" className="btn-ghost text-dep-700" onClick={() => onChange([...items, ''])}><Plus size={16} /> Ajouter une ligne</button>}
    </div>
  );
}

function TableInput({ columns, value = [], onChange, disabled }) {
  const rows = value;
  const set = (i, k, v) => { const n = rows.map((r) => ({ ...r })); n[i][k] = v; onChange(n); };
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full">
        <thead><tr>{columns.map((c) => <th key={c.key} className="th whitespace-nowrap">{c.label}</th>)}{!disabled && <th className="th w-10" />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className="border-b border-slate-100 p-1">
                  <input className="input min-w-[110px] py-1.5" type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'} step="any" disabled={disabled} value={r[c.key] ?? ''} onChange={(e) => set(i, c.key, e.target.value)} />
                </td>
              ))}
              {!disabled && <td className="border-b border-slate-100 p-1"><button type="button" className="btn-ghost px-2" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Supprimer la ligne"><X size={16} /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="p-3 text-sm text-slate-500">Aucune ligne.</p>}
      {!disabled && <div className="border-t border-slate-100 p-2"><button type="button" className="btn-ghost text-dep-700" onClick={() => onChange([...rows, {}])}><Plus size={16} /> Ajouter une ligne</button></div>}
    </div>
  );
}

/** Champ unique d’un formulaire guidé. */
export function DynamicField({ field, value, onChange, disabled }) {
  const common = { disabled, className: 'input', value: value ?? '', onChange: (e) => onChange(e.target.value) };
  switch (field.type) {
    case 'textarea': return <textarea rows={5} {...common} />;
    case 'date': return <input type="date" {...common} />;
    case 'number': return <input type="number" step="any" {...common} />;
    case 'select': return <select {...common}><option value="">— Choisir —</option>{field.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
    case 'list': return <ListInput value={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />;
    case 'table': return <TableInput columns={field.columns} value={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} />;
    default: return <input type="text" {...common} />;
  }
}

/** Affichage en lecture d’une valeur de formulaire guidé. */
export function DynamicValue({ field, value }) {
  if (field.type === 'list') return (value || []).length ? <ul className="list-disc space-y-1 pl-5 text-sm">{value.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-sm text-slate-400">—</span>;
  if (field.type === 'table') {
    return (value || []).length ? (
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full"><thead><tr>{field.columns.map((c) => <th key={c.key} className="th">{c.label}</th>)}</tr></thead>
          <tbody>{value.map((r, i) => <tr key={i}>{field.columns.map((c) => <td key={c.key} className="td">{c.type === 'date' ? fmtDate(r[c.key]) : c.type === 'number' && r[c.key] !== null ? Number(r[c.key]).toLocaleString('fr-FR') : (r[c.key] ?? '—')}</td>)}</tr>)}</tbody>
        </table>
      </div>
    ) : <span className="text-sm text-slate-400">—</span>;
  }
  if (field.type === 'date') return <span className="text-sm">{fmtDate(value)}</span>;
  if (field.type === 'number') return <span className="text-sm">{value === null || value === undefined || value === '' ? '—' : Number(value).toLocaleString('fr-FR')}</span>;
  return <p className="whitespace-pre-line text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</p>;
}
