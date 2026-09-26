import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, Select, Spinner, ErrorAlert } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate, fmtMontant } from '../../lib/format';

export default function PipList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [statut, setStatut] = useState('');
  const state = useApi(`/pip${statut ? `?statut=${statut}` : ''}`);
  return (
    <>
      <PageHeader title="Projets PIP" subtitle="Fiches de projets du Programme d’Investissements Publics — modèle du Ministère du Plan." breadcrumb={[{ label: 'Projets PIP' }]}
        actions={<>
          <ExportButtons base="/pip/export" formats={['xlsx']} print={false} query={statut ? `?statut=${statut}` : ''} />
          {can('pip.rediger') && <Link to="/pip/nouveau" className="btn-primary"><Plus size={16} /> Nouvelle fiche PIP</Link>}
        </>} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(p) => navigate(`/pip/${p.id}`)}
          toolbar={<Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={[['BROUILLON', 'Brouillon'], ['EN_VERIFICATION', 'En vérification'], ['A_CORRIGER', 'À corriger'], ['VERIFIE', 'Vérifiée'], ['VALIDE', 'Validée'], ['ARCHIVE', 'Archivée']]} />}
          columns={[
            { key: 'code', header: 'Code', render: (p) => <span className="whitespace-nowrap font-medium">{p.code}</span> },
            { key: 'intitule', header: 'Intitulé du projet', render: (p) => <span>{p.intitule}<span className="block text-xs text-slate-500">{p.secteur}</span></span> },
            { key: 'cout_total', header: 'Coût total', render: (p) => <span className="whitespace-nowrap tabular-nums">{fmtMontant(p.cout_total, p.devise)}</span> },
            { key: 'duree', header: 'Durée', render: (p) => (p.duree_mois ? `${p.duree_mois} mois` : '—') },
            { key: 'date_debut', header: 'Démarrage', render: (p) => fmtDate(p.date_debut) },
            { key: 'auteur_nom', header: 'Élaborée par', render: (p) => <span>{p.auteur_nom}<span className="block text-xs text-slate-500">{p.bureau_nom || p.division_nom || 'Direction'}</span></span> },
            { key: 'statut', header: 'Statut', render: (p) => <StatusBadge value={p.statut} /> },
          ]} />
      )}
    </>
  );
}
