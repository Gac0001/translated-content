import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth, useCompteurs } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, UrgenceBadge, ConfidBadge } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate } from '../../lib/format';
import { CONFIDENTIALITES, STATUTS, URGENCES } from '../../lib/labels';

export default function CourriersList() {
  const can = useAuth((s) => s.can);
  const { compteurs } = useCompteurs();
  const navigate = useNavigate();
  const liste = useListParams({ onglet: 'tous', statut: '', urgence: '' });
  const v = liste.valeurs;
  const query = queryString({ sens: v.onglet === 'ENTRANT' || v.onglet === 'SORTANT' ? v.onglet : '', a_recevoir: v.onglet === 'recevoir' ? 'true' : '', statut: v.statut, urgence: v.urgence });
  const state = useApi(`/courriers${query}`);
  return (
    <ListPage title="Courriers" subtitle="Registre des courriers entrants et sortants et suivi de leur circulation." breadcrumb={[{ label: 'Courriers' }]}
      liste={liste} state={state} onRowClick={(c) => navigate(`/courriers/${c.id}`)}
      actions={<>
        <ExportButtons base="/courriers/export" query={query} print={false} />
        {can('courriers.enregistrer') && <Link to="/courriers/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Enregistrer un courrier</Link>}
      </>}
      tabs={{ key: 'onglet', label: 'Courriers', items: [{ value: 'tous', label: 'Tous' }, { value: 'recevoir', label: 'À réceptionner', count: compteurs.courriers }, { value: 'ENTRANT', label: 'Entrants' }, { value: 'SORTANT', label: 'Sortants' }] }}
      filtres={[
        { key: 'statut', label: 'Statut', placeholder: 'Statuts actifs', options: [['ENREGISTRE', 'Enregistré'], ['EN_CIRCULATION', 'En circulation'], ['TRAITE', 'Traité'], ['CLASSE', 'Classé'], ['ARCHIVE', 'Archivé']] },
        { key: 'urgence', label: 'Degré d’urgence', placeholder: 'Toute urgence', options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent'], ['TRES_URGENT', 'Très urgent']] },
      ]}
      columns={[
        { key: 'numero_enregistrement', header: 'N° d’enregistrement', sortable: true, render: (c) => <span className="whitespace-nowrap font-medium">{c.numero_enregistrement}</span> },
        { key: 'date_courrier', header: 'Date', sortable: true, render: (c) => fmtDate(c.date_courrier) },
        { key: 'expediteur', header: 'Expéditeur → Destinataire', sortable: true, search: (c) => `${c.expediteur} ${c.destinataire}`, render: (c) => <span>{c.expediteur}<span className="block text-xs text-slate-500">→ {c.destinataire}</span></span> },
        { key: 'objet', header: 'Objet', primary: true, sortable: true },
        { key: 'urgence', header: 'Urgence', sortValue: (c) => Object.keys(URGENCES).indexOf(c.urgence), render: (c) => <UrgenceBadge value={c.urgence} /> },
        { key: 'confidentialite', header: 'Confidentialité', sortValue: (c) => Object.keys(CONFIDENTIALITES).indexOf(c.confidentialite), render: (c) => <ConfidBadge value={c.confidentialite} /> },
        { key: 'statut', header: 'Statut', sortValue: (c) => STATUTS[c.statut]?.[0], render: (c) => <StatusBadge value={c.statut} /> },
        { key: 'detenteur_nom', header: 'Détenteur', sortable: true },
      ]} />
  );
}
