import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, Select, Spinner, ErrorAlert, Badge } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../lib/format';

export default function PresencesList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [statut, setStatut] = useState('');
  const state = useApi(`/presences${statut ? `?statut=${statut}` : ''}`);
  return (
    <>
      <PageHeader title="Présences hebdomadaires" subtitle="Brouillon → Vérifiée → Soumise → Verrouillée. Toute correction après soumission passe par un rectificatif." breadcrumb={[{ label: 'Présences' }]}
        actions={can('presences.saisir', 'presences.preparer_direction') && <Link to="/presences/nouvelle" className="btn-primary"><Plus size={16} /> Nouvelle liste</Link>} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(s) => navigate(`/presences/${s.id}`)}
          toolbar={<Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={[['BROUILLON', 'Brouillon'], ['VERIFIEE', 'Vérifiée'], ['SOUMISE', 'Soumise'], ['VERROUILLEE', 'Verrouillée']]} />}
          columns={[
            { key: 'reference', header: 'Référence', render: (s) => <span className="font-medium">{s.reference}{s.est_rectificatif && <Badge tone="orange" className="ml-1">Rectificatif</Badge>}</span> },
            { key: 'semaine', header: 'Semaine', render: (s) => `S${s.numero_semaine} · ${fmtDate(s.semaine_debut)} → ${fmtDate(s.semaine_fin)}`, search: (s) => `${s.numero_semaine}` },
            { key: 'structure', header: 'Structure', render: (s) => (s.structure_type === 'DIRECTION' ? 'Direction (toutes structures)' : <span>{s.bureau_nom}<span className="block text-xs text-slate-500">{s.est_secretariat_direction ? 'Bureau rattaché au Directeur' : s.division_nom}</span></span>), search: (s) => `${s.bureau_nom} ${s.division_nom}` },
            { key: 'nb_agents', header: 'Agents' },
            { key: 'statut', header: 'Statut', render: (s) => <StatusBadge value={s.statut} /> },
            { key: 'updated_at', header: 'Mise à jour', render: (s) => fmtDateTime(s.updated_at) },
          ]} />
      )}
    </>
  );
}
