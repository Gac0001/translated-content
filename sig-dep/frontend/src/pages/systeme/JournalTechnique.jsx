import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, DataTable, Badge, Modal, Select, Stat, runAction, useConfirm, InfoAlert, useListParams } from '../../components/ui';

function Detail({ id, onClose }) {
  const state = useApi(`/supervision/erreurs/${id}`);
  return (
    <Modal open size="lg" title="Erreur technique" onClose={onClose}>
      <Loadable state={state}>
        {(e) => (
          <div className="space-y-2 text-sm">
            <p><code>{e.methode} {e.route}</code> — {e.occurrences} occurrence(s), du {fmtDateTime(e.premiere_at)} au {fmtDateTime(e.derniere_at)}</p>
            <p className="font-medium">{e.message}</p>
            {e.derniere_username && <p className="text-slate-600">Dernière occurrence : {e.derniere_username} ({e.derniere_ip})</p>}
            <pre className="max-h-96 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{e.pile || '—'}</pre>
          </div>
        )}
      </Loadable>
    </Modal>
  );
}

export default function JournalTechnique() {
  const { valeurs: v, set } = useListParams({ statut: 'ouvertes' });
  const statut = v.statut || 'ouvertes';
  const [detail, setDetail] = useState(null);
  const state = useApi(`/supervision/erreurs?statut=${statut}`);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const resoudre = async (e) => {
    const r = await confirm({ title: 'Marquer comme résolue', message: `${e.methode} ${e.route} — ${e.message}`, confirmLabel: 'Résolue', input: { label: 'Correction apportée (facultatif)' } });
    if (r === false) return;
    await runAction(() => api.post(`/supervision/erreurs/${e.id}/resoudre`, { commentaire: r || undefined }), 'Erreur marquée comme résolue.').catch(() => null);
    state.reload();
  };
  return (
    <>
      <PageHeader title="Journal technique" subtitle="Erreurs internes du serveur, regroupées par cause. Les utilisateurs ne voient jamais ces détails." breadcrumb={[{ label: 'Sécurité et système' }, { label: 'Journal technique' }]} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Groupes d’erreurs ouverts" value={d.resume.ouvertes} tone={d.resume.ouvertes ? 'jaune' : 'vert'} />
              <Stat label="Occurrences sur 24 h" value={d.resume.occurrences24h} tone={d.resume.occurrences24h ? 'rouge' : 'gris'} />
            </div>
            <InfoAlert>Ce journal n’est pas le journal d’audit : il sert au diagnostic et est purgé automatiquement selon la durée fixée dans la politique (90 jours par défaut).</InfoAlert>
            <DataTable rows={d.data} label="Erreurs techniques" onRowClick={(e) => setDetail(e.id)} empty={statut === 'ouvertes' ? 'Aucune erreur ouverte.' : 'Aucune erreur.'}
              controle={{ q: v.q, page: v.page, tri: v.tri }} onControle={set}
              toolbar={<Select label="État" value={statut === 'ouvertes' ? '' : statut} onChange={(x) => set({ statut: x || 'ouvertes' })} placeholder="Ouvertes" options={[['resolues', 'Résolues'], ['toutes', 'Toutes']]} />}
              columns={[
                { key: 'derniere_at', header: 'Dernière occurrence', className: 'whitespace-nowrap', sortValue: (e) => e.derniere_at, render: (e) => fmtDateTime(e.derniere_at) },
                { key: 'route', header: 'Requête', render: (e) => <code className="text-xs">{e.methode} {e.route}</code> },
                { key: 'message', header: 'Message', render: (e) => <span className="line-clamp-2 text-xs">{e.message}</span> },
                { key: 'occurrences', header: 'Nombre', render: (e) => <Badge className={e.occurrences > 10 ? 'bg-red-50 text-red-800 ring-red-200' : undefined}>{e.occurrences}</Badge> },
                { key: 'etat', header: 'État', render: (e) => (e.resolue_at
                  ? <span className="text-xs text-slate-500">Résolue le {fmtDateTime(e.resolue_at)}{e.resolue_par_username ? ` par ${e.resolue_par_username}` : ''}</span>
                  : can('systeme.maintenir') ? <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={(ev) => { ev.stopPropagation(); resoudre(e); }}><CheckCircle2 size={14} aria-hidden /> Résolue</button> : <Badge>Ouverte</Badge>) },
              ]} />
          </div>
        )}
      </Loadable>
      {detail && <Detail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
