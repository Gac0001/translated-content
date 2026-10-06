import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, PrioriteBadge, Progress, Select, Spinner, ErrorAlert, Tabs } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate, isOverdue } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

const ST = ['TRANSMISE', 'RECUE', 'EN_COURS', 'BLOQUEE', 'RAPPORT_INTERMEDIAIRE', 'A_CORRIGER', 'EXECUTEE', 'VALIDEE', 'CLOTUREE', 'EN_RETARD', 'ANNULEE'];

export default function TachesList() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mes, setMes] = useState(user.primaryRole === 'AGENT' ? 'true' : '');
  const [statut, setStatut] = useState(params.get('statut') || '');
  const qs = new URLSearchParams(Object.entries({ mes, statut }).filter(([, v]) => v)).toString();
  const state = useApi(`/taches?${qs}`);
  return (
    <>
      <PageHeader title="Tâches" subtitle="Tâches attribuées par les Chefs de Bureau aux Agents de leur Bureau." breadcrumb={[{ label: 'Tâches' }]}
        actions={<>
          <ExportButtons base="/taches/export" query={`?${qs}`} print={false} />
          {can('taches.attribuer') && <Link to="/taches/nouvelle" className="btn-primary"><Plus size={16} /> Attribuer une tâche</Link>}
        </>} />
      <Tabs value={mes} onChange={setMes} tabs={[{ value: '', label: 'Toutes (périmètre)' }, { value: 'true', label: 'Mes tâches' }]} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(t) => navigate(`/taches/${t.id}`)}
          toolbar={<Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={ST.map((s) => [s, STATUTS[s][0]])} />}
          columns={[
            { key: 'reference', header: 'Référence', render: (t) => <span className="whitespace-nowrap font-medium">{t.reference}</span> },
            { key: 'titre', header: 'Tâche' },
            { key: 'agent_nom', header: 'Agent', render: (t) => <span>{t.agent_nom}<span className="block text-xs text-slate-500">{t.bureau_nom}</span></span>, search: (t) => `${t.agent_nom} ${t.bureau_nom}` },
            { key: 'priorite', header: 'Priorité', render: (t) => <PrioriteBadge value={t.priorite} /> },
            { key: 'echeance', header: 'Échéance', render: (t) => <span className={isOverdue(t.echeance, t.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(t.echeance)}</span> },
            { key: 'statut', header: 'Statut', render: (t) => <StatusBadge value={t.statut} /> },
            { key: 'avancement', header: 'Avancement', className: 'min-w-[140px]', render: (t) => <Progress value={t.avancement} /> },
          ]} />
      )}
    </>
  );
}
