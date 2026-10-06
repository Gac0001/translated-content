import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, PrioriteBadge, Progress } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate, isOverdue } from '../../lib/format';
import { PRIORITES, ROLES, STATUTS } from '../../lib/labels';

const ST = ['BROUILLON', 'TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EXECUTEE', 'VALIDEE', 'CLOTUREE', 'EN_RETARD'];

export default function InstructionsList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const liste = useListParams({ boite: 'toutes', statut: '' });
  const v = liste.valeurs;
  const query = queryString({ boite: v.boite, statut: v.statut });
  const state = useApi(`/instructions${query}`);
  return (
    <ListPage title="Instructions" subtitle="Les instructions sont adressées au subordonné direct ; les comptes rendus remontent vers l’émetteur." breadcrumb={[{ label: 'Instructions' }]}
      liste={liste} state={state} onRowClick={(i) => navigate(`/instructions/${i.id}`)}
      actions={<>
        <ExportButtons base="/instructions/export" query={query} print={false} />
        {can('instructions.emettre') && <Link to="/instructions/nouvelle" className="btn-primary"><Plus size={16} aria-hidden /> Nouvelle instruction</Link>}
      </>}
      tabs={{ key: 'boite', label: 'Boîte', items: [{ value: 'toutes', label: 'Toutes (périmètre)' }, { value: 'recues', label: 'Reçues' }, ...(can('instructions.emettre') ? [{ value: 'emises', label: 'Émises' }] : [])] }}
      filtres={[{ key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: ST.map((s) => [s, STATUTS[s][0]]) }]}
      columns={[
        { key: 'reference', header: 'Référence', sortable: true, render: (i) => <span className="whitespace-nowrap font-medium">{i.reference}</span> },
        { key: 'objet', header: 'Objet', primary: true, sortable: true },
        { key: 'emetteur_nom', header: 'Émetteur → Destinataire', sortable: true, search: (i) => `${i.emetteur_nom} ${i.destinataire_nom}`, render: (i) => <span className="text-sm">{i.emetteur_nom} <span className="text-xs text-slate-500">({ROLES[i.emetteur_role]})</span><span className="block">→ {i.destinataire_nom} <span className="text-xs text-slate-500">({ROLES[i.destinataire_role]})</span></span></span> },
        { key: 'priorite', header: 'Priorité', sortValue: (i) => Object.keys(PRIORITES).indexOf(i.priorite), render: (i) => <PrioriteBadge value={i.priorite} /> },
        { key: 'echeance', header: 'Échéance', sortable: true, render: (i) => <span className={isOverdue(i.echeance, i.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(i.echeance)}</span> },
        { key: 'statut', header: 'Statut', sortValue: (i) => STATUTS[i.statut]?.[0], render: (i) => <StatusBadge value={i.statut} /> },
        { key: 'avancement', header: 'Avancement', className: 'min-w-[140px]', sortValue: (i) => Number(i.avancement), render: (i) => <Progress value={i.avancement} /> },
      ]} />
  );
}
