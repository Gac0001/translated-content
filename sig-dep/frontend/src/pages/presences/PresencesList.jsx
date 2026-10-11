import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, Badge } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

export default function PresencesList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const liste = useListParams({ statut: '' });
  const state = useApi(`/presences${queryString({ statut: liste.valeurs.statut })}`);
  return (
    <ListPage title="Présences hebdomadaires" subtitle="Brouillon → Vérifiée → Soumise → Verrouillée. Toute correction après soumission passe par un rectificatif." breadcrumb={[{ label: 'Présences' }]}
      liste={liste} state={state} onRowClick={(s) => navigate(`/presences/${s.id}`)}
      actions={can('presences.saisir', 'presences.preparer_direction') && <Link to="/presences/nouvelle" className="btn-primary"><Plus size={16} aria-hidden /> Nouvelle liste</Link>}
      filtres={[{ key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: [['BROUILLON', 'Brouillon'], ['VERIFIEE', 'Vérifiée'], ['SOUMISE', 'Soumise'], ['VERROUILLEE', 'Verrouillée']] }]}
      columns={[
        { key: 'reference', header: 'Référence', primary: true, sortable: true, render: (s) => <span className="font-medium">{s.reference}{s.est_rectificatif && <Badge tone="orange" className="ml-1">Rectificatif</Badge>}</span> },
        { key: 'semaine', header: 'Semaine', sortValue: (s) => s.semaine_debut, search: (s) => `${s.numero_semaine}`, render: (s) => `S${s.numero_semaine} · ${fmtDate(s.semaine_debut)} → ${fmtDate(s.semaine_fin)}` },
        { key: 'structure', header: 'Structure', sortValue: (s) => (s.structure_type === 'DIRECTION' ? '' : s.bureau_nom), search: (s) => `${s.bureau_nom} ${s.division_nom}`, render: (s) => (s.structure_type === 'DIRECTION' ? 'Direction (toutes structures)' : <span>{s.bureau_nom}<span className="block text-xs text-slate-500">{s.est_secretariat_direction ? 'Bureau rattaché au Directeur' : s.division_nom}</span></span>) },
        { key: 'nb_agents', header: 'Agents', sortValue: (s) => Number(s.nb_agents) },
        { key: 'statut', header: 'Statut', sortValue: (s) => STATUTS[s.statut]?.[0], render: (s) => <StatusBadge value={s.statut} /> },
        { key: 'updated_at', header: 'Mise à jour', sortable: true, render: (s) => fmtDateTime(s.updated_at) },
      ]} />
  );
}
