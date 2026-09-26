import { useState } from 'react';
import { useApi, Loadable, PageHeader, Card, Select, Badge, Modal } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDateTime } from '../../lib/format';

export default function Audit() {
  const [f, setF] = useState({ q: '', module: '', action: '', resultat: '', du: '', au: '', page: 1 });
  const [detail, setDetail] = useState(null);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const state = useApi(`/audit?${qs}`);
  const up = (k) => (v) => setF((x) => ({ ...x, [k]: v, page: 1 }));
  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Lecture seule — aucune entrée ne peut être modifiée ni supprimée." breadcrumb={[{ label: 'Administration' }, { label: 'Journal d’audit' }]} actions={<ExportButtons base="/audit/export" formats={['xlsx']} query={`?${qs}`} print={false} />} />
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
