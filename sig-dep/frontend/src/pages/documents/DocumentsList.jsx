import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth, useCompteurs } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, ConfidBadge } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { CONFIDENTIALITES, STATUTS } from '../../lib/labels';

export default function DocumentsList() {
  const can = useAuth((s) => s.can);
  const { compteurs } = useCompteurs();
  const navigate = useNavigate();
  const liste = useListParams({ boite: 'tous', type: '', statut: '' });
  const v = liste.valeurs;
  const types = useApi('/documents/types');
  const state = useApi(`/documents${queryString({ boite: v.boite, type_document: v.type, statut: v.statut })}`);
  return (
    <ListPage title="Documents de service" subtitle="Rédaction guidée, versionnement et validation hiérarchique." breadcrumb={[{ label: 'Documents' }]}
      liste={liste} state={state} onRowClick={(d) => navigate(`/documents/${d.id}`)}
      actions={can('documents.rediger') && <Link to="/documents/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Nouveau document</Link>}
      tabs={{
        key: 'boite', label: 'Documents',
        items: [{ value: 'tous', label: 'Documents du périmètre' }, ...(can('documents.rediger') ? [{ value: 'mes', label: 'Mes documents' }] : []), ...(can('documents.examiner') ? [{ value: 'a_examiner', label: 'À examiner', count: compteurs.documents }] : [])],
      }}
      filtres={[
        { key: 'type', label: 'Type de document', placeholder: 'Tous types', options: (types.data?.data || []).map((t) => [t.code, t.libelle]) },
        { key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: ['BROUILLON', 'EN_RELECTURE', 'A_CORRIGER', 'VISE', 'VALIDE', 'PUBLIE', 'REJETE', 'ARCHIVE'].map((s) => [s, STATUTS[s][0]]) },
      ]}
      columns={[
        { key: 'reference', header: 'Référence', sortable: true, render: (d) => <span className="whitespace-nowrap font-medium">{d.reference}</span> },
        { key: 'titre', header: 'Titre', primary: true, sortable: true, search: (d) => `${d.titre} ${d.type_libelle}`, render: (d) => <span>{d.titre}<span className="block text-xs font-normal text-slate-500">{d.type_libelle} · v{d.version_courante}</span></span> },
        { key: 'auteur_nom', header: 'Auteur', sortable: true, render: (d) => <span>{d.auteur_nom}<span className="block text-xs text-slate-500">{d.bureau_nom || d.division_nom || 'Direction'}</span></span> },
        { key: 'detenteur_nom', header: 'Détenteur', sortable: true },
        { key: 'confidentialite', header: 'Confid.', sortValue: (d) => Object.keys(CONFIDENTIALITES).indexOf(d.confidentialite), render: (d) => <ConfidBadge value={d.confidentialite} /> },
        { key: 'statut', header: 'Statut', sortValue: (d) => STATUTS[d.statut]?.[0], render: (d) => <StatusBadge value={d.statut} /> },
        { key: 'updated_at', header: 'Mise à jour', sortable: true, render: (d) => fmtDateTime(d.updated_at) },
      ]} />
  );
}
