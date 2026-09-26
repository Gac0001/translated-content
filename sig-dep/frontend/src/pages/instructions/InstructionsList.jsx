import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, PrioriteBadge, Progress, Select, Spinner, ErrorAlert, Tabs } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate, isOverdue } from '../../lib/format';
import { ROLES, STATUTS } from '../../lib/labels';

const ST = ['BROUILLON', 'TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EXECUTEE', 'VALIDEE', 'CLOTUREE', 'EN_RETARD'];

export default function InstructionsList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [boite, setBoite] = useState('toutes');
  const [statut, setStatut] = useState('');
  const qs = new URLSearchParams(Object.entries({ boite, statut }).filter(([, v]) => v)).toString();
  const state = useApi(`/instructions?${qs}`);
  return (
    <>
      <PageHeader title="Instructions" subtitle="Les instructions sont adressées au subordonné direct ; les comptes rendus remontent vers l’émetteur." breadcrumb={[{ label: 'Instructions' }]}
        actions={<>
          <ExportButtons base="/instructions/export" query={`?${qs}`} print={false} />
          {can('instructions.emettre') && <Link to="/instructions/nouvelle" className="btn-primary"><Plus size={16} /> Nouvelle instruction</Link>}
        </>} />
      <Tabs value={boite} onChange={setBoite} tabs={[{ value: 'toutes', label: 'Toutes (périmètre)' }, { value: 'recues', label: 'Reçues' }, ...(can('instructions.emettre') ? [{ value: 'emises', label: 'Émises' }] : [])]} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(i) => navigate(`/instructions/${i.id}`)}
          toolbar={<Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={ST.map((s) => [s, STATUTS[s][0]])} />}
          columns={[
            { key: 'reference', header: 'Référence', render: (i) => <span className="whitespace-nowrap font-medium">{i.reference}</span> },
            { key: 'objet', header: 'Objet' },
            { key: 'emetteur_nom', header: 'Émetteur → Destinataire', render: (i) => <span className="text-sm">{i.emetteur_nom} <span className="text-xs text-slate-500">({ROLES[i.emetteur_role]})</span><span className="block">→ {i.destinataire_nom} <span className="text-xs text-slate-500">({ROLES[i.destinataire_role]})</span></span></span>, search: (i) => `${i.emetteur_nom} ${i.destinataire_nom}` },
            { key: 'priorite', header: 'Priorité', render: (i) => <PrioriteBadge value={i.priorite} /> },
            { key: 'echeance', header: 'Échéance', render: (i) => <span className={isOverdue(i.echeance, i.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(i.echeance)}</span> },
            { key: 'statut', header: 'Statut', render: (i) => <StatusBadge value={i.statut} /> },
            { key: 'avancement', header: 'Avancement', className: 'min-w-[140px]', render: (i) => <Progress value={i.avancement} /> },
          ]} />
      )}
    </>
  );
}
