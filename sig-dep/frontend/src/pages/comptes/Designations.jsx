import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, InfoAlert, runAction, useConfirm, DataTable, Badge } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../lib/format';

const ETATS = {
  EN_VIGUEUR: ['En vigueur', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  A_VENIR: ['À venir', 'bg-sky-50 text-sky-800 ring-sky-200'],
  A_REGULARISER: ['À régulariser', 'bg-amber-50 text-amber-800 ring-amber-200'],
  ECHUE: ['Échue', 'bg-slate-100 text-slate-700 ring-slate-200'],
  RETIREE: ['Retirée', 'bg-slate-100 text-slate-700 ring-slate-200'],
};

/** Désignations temporaires : opérations administratives accordées sur acte, pour une période déterminée. */
export default function Designations() {
  const state = useApi('/users/designations');
  const confirm = useConfirm();
  const retirer = async (d) => {
    if (!(await confirm({ title: 'Retirer la désignation', message: `Retirer « ${d.libelle} » à ${d.username} ? Le retrait est immédiat et reste tracé.`, danger: true, confirmLabel: 'Retirer' }))) return;
    await runAction(() => api.delete(`/users/designations/${d.id}`), 'Désignation retirée.');
    state.reload();
  };
  return (
    <>
      <PageHeader title="Désignations" breadcrumb={[{ label: 'Comptes', to: '/comptes' }, { label: 'Désignations' }]}
        actions={<Link to="/actes/nouveau?type=DESIGNATION" className="btn-primary"><Plus size={16} /> Nouvelle désignation (acte)</Link>} />
      <InfoAlert>
        Une désignation accorde temporairement des opérations administratives (préparer les comptes, suivre le personnel, préparer les présences, enregistrer le courrier,
        transmettre les dossiers) sur la base d’un acte enregistré et validé. Elle expire d’elle-même à la date de fin et ne confère jamais le rang ni les pouvoirs d’un Chef de Division.
      </InfoAlert>
      <Loadable state={state}>
        {(d) => {
          const aRegulariser = d.data.filter((x) => x.etat === 'A_REGULARISER');
          return (
            <div className="mt-4 space-y-4">
              {aRegulariser.length > 0 && (
                <InfoAlert tone="warning">
                  {aRegulariser.length} droit(s) accordé(s) avant la mise en place des actes doivent être régularisés par un acte de désignation avant le {fmtDate(aRegulariser[0].a_regulariser_avant)} ; à défaut, ils seront retirés automatiquement.
                </InfoAlert>
              )}
              <DataTable rows={d.data} columns={[
                { key: 'libelle', header: 'Opération' },
                { key: 'username', header: 'Bénéficiaire', render: (x) => `${[x.prenom, x.nom].filter(Boolean).join(' ') || x.username}` },
                { key: 'acte', header: 'Acte', render: (x) => (x.acte_id ? <Link className="text-dep-700 hover:underline" to={`/actes/${x.acte_id}`}>{x.acte_numero}</Link> : <span className="text-amber-800">Sans acte</span>), search: (x) => x.acte_numero },
                { key: 'periode', header: 'Période', render: (x) => (x.date_debut ? `${fmtDate(x.date_debut)} → ${fmtDate(x.date_fin)}` : x.a_regulariser_avant ? `à régulariser avant le ${fmtDate(x.a_regulariser_avant)}` : '—') },
                { key: 'etat', header: 'État', render: (x) => <Badge className={ETATS[x.etat][1]} title={x.motif_revocation || undefined}>{ETATS[x.etat][0]}</Badge> },
                { key: 'granted_at', header: 'Accordée', render: (x) => `${fmtDateTime(x.granted_at)}${x.granted_by_username ? ` par ${x.granted_by_username}` : ''}` },
                { key: 'a', header: '', render: (x) => !x.revoked_at && <button type="button" className="text-red-600" onClick={() => retirer(x)} aria-label={`Retirer ${x.libelle}`}><Trash2 size={16} /></button> },
              ]} />
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
