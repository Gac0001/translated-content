import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Link2, Search, X } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, Select, Badge, Modal, Alert, SimpleTable, useListParams, toast } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export default function Audit() {
  // Filtres et page conservés dans l’adresse (filtrage côté serveur : page de 50 entrées).
  const { valeurs: f, set } = useListParams({ module: '', action: '', resultat: '', du: '', au: '' });
  const [detail, setDetail] = useState(null);
  const qs = new URLSearchParams(Object.entries({ q: f.q, module: f.module, action: f.action, resultat: f.resultat, du: f.du, au: f.au, page: f.page }).filter(([k, v]) => v && !(k === 'page' && v === '1'))).toString();
  const state = useApi(`/audit?${qs}`);
  const up = (k) => (v) => set({ [k]: v });
  const page = Number(f.page) || 1;
  const actifs = !!(f.q || f.module || f.action || f.resultat || f.du || f.au);
  const can = useAuth((s) => s.can);
  const [integrite, setIntegrite] = useState(null);
  const exporter = (format) => download(`/audit/export/${format}?${qs}`, `journal-audit.${format}`).catch((e) => toast.error(errorMessage(e, 'Export impossible.')));
  const verifier = async () => {
    try { setIntegrite((await api.get('/audit/integrite')).data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Lecture seule — aucune entrée ne peut être modifiée ni supprimée." breadcrumb={[{ label: 'Sécurité et système' }, { label: 'Journal d’audit' }]}
        actions={<button type="button" className="btn-secondary" onClick={verifier}><Link2 size={16} aria-hidden /> Vérifier l’intégrité</button>}
        menu={can('audit.exporter') ? [
          { label: 'Excel', icon: FileSpreadsheet, onClick: () => exporter('xlsx') },
          { label: 'CSV', icon: FileText, onClick: () => exporter('csv') },
          { label: 'PDF', icon: FileDown, onClick: () => exporter('pdf') },
        ] : []} />
      {integrite && (
        <div className="mb-4" role="status">
          {integrite.integre
            ? <Alert tone="succes" title="Journal intègre">{integrite.entrees} entrée(s) chaînée(s), aucune modification, suppression ni insertion frauduleuse détectée ({fmtDateTime(integrite.verifieAt)}).</Alert>
            : <Alert tone="danger" title="Intégrité rompue"><ul className="mt-1 list-disc pl-5">{integrite.problemes.map((p, i) => <li key={i}>{p.maillon ? `Maillon ${p.maillon} : ` : ''}{p.raison}</li>)}</ul></Alert>}
        </div>
      )}
      <Loadable state={state}>
        {(d) => (
          <Card bodyClass="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b p-3" role="group" aria-label="Filtres du journal">
              <div className="relative w-full sm:w-60">
                <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
                <input type="search" className="input pl-8" placeholder="Utilisateur, IP, message…" aria-label="Rechercher dans le journal" value={f.q} onChange={(e) => up('q')(e.target.value)} />
              </div>
              <Select label="Module" value={f.module} onChange={up('module')} placeholder="Tous modules" options={d.modules.map((m) => [m, m])} />
              <Select label="Action" value={f.action} onChange={up('action')} placeholder="Toutes actions" options={d.actions.map((m) => [m, m])} />
              <Select label="Résultat" value={f.resultat} onChange={up('resultat')} placeholder="Tous résultats" options={[['SUCCES', 'Succès'], ['ECHEC', 'Échec']]} />
              <input type="date" className="input w-auto" value={f.du} onChange={(e) => up('du')(e.target.value)} aria-label="Du" />
              <input type="date" className="input w-auto" value={f.au} onChange={(e) => up('au')(e.target.value)} aria-label="Au" />
              {actifs && <button type="button" className="btn-ghost btn-sm" onClick={() => set({ q: '', module: '', action: '', resultat: '', du: '', au: '' })}><X size={14} aria-hidden /> Effacer les filtres</button>}
              <span className="ml-auto text-xs text-slate-500" aria-live="polite">{d.total} entrée(s)</span>
            </div>
            <SimpleTable label="Journal d’audit" dense rows={d.data} onRowClick={setDetail} empty={actifs ? 'Aucune entrée pour ces critères.' : 'Aucune entrée.'}
              columns={[
                { key: 'created_at', header: 'Date et heure', className: 'whitespace-nowrap text-xs', render: (l) => fmtDateTime(l.created_at) },
                { key: 'username', header: 'Utilisateur', render: (l) => l.username || '—' },
                { key: 'role', header: 'Rôle', className: 'text-xs' },
                { key: 'ip', header: 'Adresse IP', className: 'text-xs' },
                { key: 'action', header: 'Action', render: (l) => <code className="text-xs">{l.action}</code> },
                { key: 'module', header: 'Module', className: 'text-xs' },
                { key: 'entite', header: 'Élément', className: 'text-xs', render: (l) => [l.entite, l.entite_id].filter(Boolean).join(' #') || '—' },
                { key: 'resultat', header: 'Résultat', render: (l) => (l.resultat === 'SUCCES' ? <Badge tone="succes">Succès</Badge> : <Badge tone="danger">Échec</Badge>) },
                { key: 'message', header: 'Message', className: 'max-w-xs truncate text-xs' },
              ]} />
            <nav className="flex items-center justify-end gap-2 border-t p-2 text-sm" aria-label="Pagination du journal">
              <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>Précédent</button>
              <span aria-live="polite">Page {d.page} / {Math.max(1, Math.ceil(d.total / d.limit))}</span>
              <button type="button" className="btn-ghost" disabled={d.page * d.limit >= d.total} onClick={() => set({ page: page + 1 })}>Suivant</button>
            </nav>
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
