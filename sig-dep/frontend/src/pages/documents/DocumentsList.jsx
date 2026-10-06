import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth, useCompteurs } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, ConfidBadge, Select, Spinner, ErrorAlert, Tabs } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

export default function DocumentsList() {
  const can = useAuth((s) => s.can);
  const { compteurs } = useCompteurs();
  const navigate = useNavigate();
  const [boite, setBoite] = useState('tous');
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');
  const types = useApi('/documents/types');
  const qs = new URLSearchParams(Object.entries({ boite, type_document: type, statut }).filter(([, v]) => v)).toString();
  const state = useApi(`/documents?${qs}`);
  return (
    <>
      <PageHeader title="Documents de service" subtitle="Rédaction guidée, versionnement et validation hiérarchique." breadcrumb={[{ label: 'Documents' }]}
        actions={can('documents.rediger') && <Link to="/documents/nouveau" className="btn-primary"><Plus size={16} /> Nouveau document</Link>} />
      <Tabs value={boite} onChange={setBoite} tabs={[{ value: 'tous', label: 'Documents du périmètre' }, ...(can('documents.rediger') ? [{ value: 'mes', label: 'Mes documents' }] : []), ...(can('documents.examiner') ? [{ value: 'a_examiner', label: 'À examiner', count: compteurs.documents }] : [])]} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(d) => navigate(`/documents/${d.id}`)}
          toolbar={<>
            <Select value={type} onChange={setType} placeholder="Tous types" options={(types.data?.data || []).map((t) => [t.code, t.libelle])} />
            <Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={['BROUILLON', 'EN_RELECTURE', 'A_CORRIGER', 'VISE', 'VALIDE', 'PUBLIE', 'REJETE', 'ARCHIVE'].map((s) => [s, STATUTS[s][0]])} />
          </>}
          columns={[
            { key: 'reference', header: 'Référence', render: (d) => <span className="whitespace-nowrap font-medium">{d.reference}</span> },
            { key: 'titre', header: 'Titre', render: (d) => <span>{d.titre}<span className="block text-xs text-slate-500">{d.type_libelle} · v{d.version_courante}</span></span>, search: (d) => `${d.titre} ${d.type_libelle}` },
            { key: 'auteur_nom', header: 'Auteur', render: (d) => <span>{d.auteur_nom}<span className="block text-xs text-slate-500">{d.bureau_nom || d.division_nom || 'Direction'}</span></span> },
            { key: 'detenteur_nom', header: 'Détenteur' },
            { key: 'confidentialite', header: 'Confid.', render: (d) => <ConfidBadge value={d.confidentialite} /> },
            { key: 'statut', header: 'Statut', render: (d) => <StatusBadge value={d.statut} /> },
            { key: 'updated_at', header: 'Mise à jour', render: (d) => fmtDateTime(d.updated_at) },
          ]} />
      )}
    </>
  );
}
