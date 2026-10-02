import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Link2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, Select, Badge, Modal, toast } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export default function Audit() {
  const [f, setF] = useState({ q: '', module: '', action: '', resultat: '', du: '', au: '', page: 1 });
  const [detail, setDetail] = useState(null);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const state = useApi(`/audit?${qs}`);
  const up = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: 1 }));
  const can = useAuth((s) => s.can);
  const [integrite, setIntegrite] = useState(null);
  const exporter = (format) => download(`/audit/export/${format}?${qs}`, `journal-audit.${format}`).catch((e) => toast.error(errorMessage(e, 'Export impossible.')));
  const verifier = async () => {
    try { setIntegrite((await api.get('/audit/integrite')).data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Lecture seule — aucune entrée ne peut être modifiée ni supprimée." breadcrumb={[{ label: 'Administration' }, { label: 'Journal d’audit' }]} actions={<>
          <button type="button" className="btn-secondary" onClick={verifier}><Link2 size={16} /> Vérifier l’intégrité</button>
          {can('audit.exporter') && <>
            <button type="button" className="btn-secondary" onClick={() => exporter('xlsx')}><FileSpreadsheet size={16} /> Excel</button>
            <button type="button" className="btn-secondary" onClick={() => exporter('csv')}><FileText size={16} /> CSV</button>
            <button type="button" className="btn-secondary" onClick={() => exporter('pdf')}><FileDown size={16} /> PDF</button>
          </>}
        </>} />
      {integrite && (
        <div className={`mb-4 rounded-md border p-3 text-sm ${integrite.integre ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`} role="status">
          {integrite.integre
            ? <>Journal intègre : {integrite.entrees} entrée(s) chaînée(s), aucune modification, suppression ni insertion frauduleuse détectée ({fmtDateTime(integrite.verifieAt)}).</>
            : <><b>Intégrité rompue.</b><ul className="mt-1 list-disc pl-5">{integrite.problemes.map((p, i) => <li key={i}>{p.maillon ? `Maillon ${p.maillon} : ` : ''}{p.raison}</li>)}</ul></>}
        </div>
      )}
      <Loadable state={state}>
        {(d) => (
          <Card bodyClass="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <input className="input w-full sm:w-60" placeholder="Utilisateur, IP, message…" value={f.q} onChange={(e) => up('q')(e.target.value)} />
              <Select value={f.module} onChange={up('module')} placeholder="Tous modules" options={d.modules.map((m) => [m, m])} />
              <Select value={f.action} onChange={up('action')} placeholder="Toutes actions" options={d.actions.map((m) => [m, m])} />
              <Select value={f.resultat} onChange={up('resultat')} placeholder="Tous résultats" options={[['SUCCES', 'Succès'], ['ECHEC', 'Échec']]} />
              <input type="date" className="input w-auto" value={f.du} onChange={(e) => up('du')(e.target.value)} aria-label="Du" />
              <input type="date" className="input w-auto" value={f.au} onChange={(e) => up('au')(e.target.value)} aria-label="Au" />
              <span className="ml-auto text-xs text-slate-500">{d.total} entrée(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead><tr>{['Date et heure', 'Utilisateur', 'Rôle', 'Adresse IP', 'Action', 'Module', 'Élément', 'Résultat', 'Message'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {d.data.map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetail(l)}>
                      <td className="td whitespace-nowrap text-xs">{fmtDateTime(l.created_at)}</td><td className="td">{l.username || '—'}</td><td className="td text-xs">{l.role}</td>
                      <td className="td text-xs">{l.ip}</td><td className="td"><code className="text-xs">{l.action}</code></td><td className="td text-xs">{l.module}</td>
                      <td className="td text-xs">{[l.entite, l.entite_id].filter(Boolean).join(' #')}</td>
                      <td className="td">{l.resultat === 'SUCCES' ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Succès</Badge> : <Badge className="bg-red-50 text-red-800 ring-red-200">Échec</Badge>}</td>
                      <td className="td max-w-xs truncate text-xs">{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-2 text-sm">
              <button type="button" className="btn-ghost" disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}>Précédent</button>
              <span>Page {d.page} / {Math.max(1, Math.ceil(d.total / d.limit))}</span>
              <button type="button" className="btn-ghost" disabled={d.page * d.limit >= d.total} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))}>Suivant</button>
            </div>
          </Card>
        )}
      </Loadable>
      {detail && (
        <Modal open size="lg" title={`Entrée d’audit n° ${detail.id}`} onClose={() => setDetail(null)}>
          <div className="space-y-3 text-sm">
            <p><b>{detail.action}</b> · {detail.module} · {fmtDateTime(detail.created_at)} · {detail.username} ({detail.role}) · {detail.ip}</p>
            <p className="text-xs text-slate-500">Maillon n° {detail.maillon} · empreinte <code className="break-all">{detail.empreinte}</code></p>
            {detail.message && <p>{detail.message}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Ancienne valeur</div><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{detail.ancienne_valeur ? JSON.stringify(detail.ancienne_valeur, null, 2) : '—'}</pre></div>
              <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Nouvelle valeur</div><pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{detail.nouvelle_valeur ? JSON.stringify(detail.nouvelle_valeur, null, 2) : '—'}</pre></div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
