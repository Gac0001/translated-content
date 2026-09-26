import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth, useCompteurs } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, UrgenceBadge, ConfidBadge, Select, Spinner, ErrorAlert, Tabs } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate } from '../../lib/format';

export default function CourriersList() {
  const can = useAuth((s) => s.can);
  const { compteurs } = useCompteurs();
  const navigate = useNavigate();
  const [tab, setTab] = useState('tous');
  const [statut, setStatut] = useState('');
  const [urgence, setUrgence] = useState('');
  const params = { sens: tab === 'ENTRANT' || tab === 'SORTANT' ? tab : '', a_recevoir: tab === 'recevoir' ? 'true' : '', statut, urgence };
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  const state = useApi(`/courriers${qs ? `?${qs}` : ''}`);
  return (
    <>
      <PageHeader title="Courriers" subtitle="Registre des courriers entrants et sortants et suivi de leur circulation." breadcrumb={[{ label: 'Courriers' }]}
        actions={<>
          <ExportButtons base="/courriers/export" query={qs ? `?${qs}` : ''} print={false} />
          {can('courriers.enregistrer') && <Link to="/courriers/nouveau" className="btn-primary"><Plus size={16} /> Enregistrer un courrier</Link>}
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'tous', label: 'Tous' }, { value: 'recevoir', label: 'À réceptionner', count: compteurs.courriers }, { value: 'ENTRANT', label: 'Entrants' }, { value: 'SORTANT', label: 'Sortants' }]} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(c) => navigate(`/courriers/${c.id}`)}
          toolbar={<>
            <Select value={statut} onChange={setStatut} placeholder="Statuts actifs" options={[['ENREGISTRE', 'Enregistré'], ['EN_CIRCULATION', 'En circulation'], ['TRAITE', 'Traité'], ['CLASSE', 'Classé'], ['ARCHIVE', 'Archivé']]} />
            <Select value={urgence} onChange={setUrgence} placeholder="Toute urgence" options={[['NORMAL', 'Normal'], ['URGENT', 'Urgent'], ['TRES_URGENT', 'Très urgent']]} />
          </>}
          columns={[
            { key: 'numero_enregistrement', header: 'N° d’enregistrement', render: (c) => <span className="whitespace-nowrap font-medium">{c.numero_enregistrement}</span> },
            { key: 'date_courrier', header: 'Date', render: (c) => fmtDate(c.date_courrier) },
            { key: 'expediteur', header: 'Expéditeur → Destinataire', render: (c) => <span>{c.expediteur}<span className="block text-xs text-slate-500">→ {c.destinataire}</span></span>, search: (c) => `${c.expediteur} ${c.destinataire}` },
            { key: 'objet', header: 'Objet' },
            { key: 'urgence', header: 'Urgence', render: (c) => <UrgenceBadge value={c.urgence} /> },
            { key: 'confidentialite', header: 'Confidentialité', render: (c) => <ConfidBadge value={c.confidentialite} /> },
            { key: 'statut', header: 'Statut', render: (c) => <StatusBadge value={c.statut} /> },
            { key: 'detenteur_nom', header: 'Détenteur' },
          ]} />
      )}
    </>
  );
}
