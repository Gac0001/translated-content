import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, PrioriteBadge, Progress } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate, isOverdue } from '../../lib/format';
import { PRIORITES, STATUTS } from '../../lib/labels';

const ST = ['TRANSMISE', 'RECUE', 'EN_COURS', 'BLOQUEE', 'RAPPORT_INTERMEDIAIRE', 'A_CORRIGER', 'EXECUTEE', 'VALIDEE', 'CLOTUREE', 'EN_RETARD', 'ANNULEE'];

export default function TachesList() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  // Un Agent arrive sur « Mes tâches » ; les liens du tableau de bord passent ?statut=…
  const liste = useListParams({ mes: user.primaryRole === 'AGENT' ? 'true' : '', statut: '' });
  const v = liste.valeurs;
  const query = queryString({ mes: v.mes, statut: v.statut });
  const state = useApi(`/taches${query}`);
  return (
    <ListPage title="Tâches" subtitle="Tâches attribuées par les Chefs de Bureau aux Agents de leur Bureau." breadcrumb={[{ label: 'Tâches' }]}
      liste={liste} state={state} onRowClick={(t) => navigate(`/taches/${t.id}`)}
      actions={<>
        <ExportButtons base="/taches/export" query={query} print={false} />
        {can('taches.attribuer') && <Link to="/taches/nouvelle" className="btn-primary"><Plus size={16} aria-hidden /> Attribuer une tâche</Link>}
      </>}
      tabs={{ key: 'mes', label: 'Tâches', items: [{ value: '', label: 'Toutes (périmètre)' }, { value: 'true', label: 'Mes tâches' }] }}
      filtres={[{ key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: ST.map((s) => [s, STATUTS[s][0]]) }]}
      columns={[
        { key: 'reference', header: 'Référence', sortable: true, render: (t) => <span className="whitespace-nowrap font-medium">{t.reference}</span> },
        { key: 'titre', header: 'Tâche', primary: true, sortable: true },
        { key: 'agent_nom', header: 'Agent', sortable: true, search: (t) => `${t.agent_nom} ${t.bureau_nom}`, render: (t) => <span>{t.agent_nom}<span className="block text-xs text-slate-500">{t.bureau_nom}</span></span> },
        { key: 'priorite', header: 'Priorité', sortValue: (t) => Object.keys(PRIORITES).indexOf(t.priorite), render: (t) => <PrioriteBadge value={t.priorite} /> },
        { key: 'echeance', header: 'Échéance', sortable: true, render: (t) => <span className={isOverdue(t.echeance, t.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(t.echeance)}</span> },
        { key: 'statut', header: 'Statut', sortValue: (t) => STATUTS[t.statut]?.[0], render: (t) => <StatusBadge value={t.statut} /> },
        { key: 'avancement', header: 'Avancement', className: 'min-w-[140px]', sortValue: (t) => Number(t.avancement), render: (t) => <Progress value={t.avancement} /> },
      ]} />
  );
}
