import { Link, useNavigate } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, Badge } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { STATUTS } from '../../lib/labels';

const nomListe = (a) => [a.nom, a.postnom, a.prenom].filter(Boolean).join(' ');

export default function AgentsList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const liste = useListParams({ statut: '', bureau: '' });
  const v = liste.valeurs;
  const bureaux = useApi('/organisation/bureaux');
  const query = queryString({ statut: v.statut, bureau_id: v.bureau });
  const state = useApi(`/agents${query}`);
  return (
    <ListPage title="Personnel" subtitle="Agents de votre périmètre administratif." breadcrumb={[{ label: 'Organisation' }, { label: 'Personnel' }]}
      liste={liste} state={state} onRowClick={(a) => navigate(`/personnel/${a.id}`)}
      actions={<>
        <ExportButtons base="/agents/export" query={query} print={false} />
        {can('personnel.gerer', 'personnel.suivre') && <Link to="/personnel/import" className="btn-secondary"><Upload size={16} aria-hidden /> Importer une liste</Link>}
        {can('personnel.gerer', 'personnel.suivre') && <Link to="/personnel/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Nouvel Agent</Link>}
      </>}
      filtres={[
        { key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: ['ACTIF', 'CONGE', 'DETACHE', 'SUSPENDU', 'RETRAITE', 'ARCHIVE'].map((s) => [s, STATUTS[s]?.[0] || 'Archivé']) },
        { key: 'bureau', label: 'Structure', placeholder: 'Toutes structures', options: (bureaux.data?.data || []).map((b) => [String(b.id), b.nom]) },
      ]}
      columns={[
        { key: 'matricule', header: 'Matricule', sortable: true, className: 'whitespace-nowrap' },
        { key: 'nom', header: 'Nom, postnom et prénom', primary: true, sortValue: nomListe, search: nomListe, render: (a) => <span className="font-medium">{nomListe(a)}</span> },
        { key: 'grade', header: 'Grade', sortable: true },
        {
          key: 'structure', header: 'Affectation', search: (a) => `${a.bureau_nom} ${a.division_nom}`, sortValue: (a) => a.bureau_nom || a.division_nom,
          render: (a) => (a.bureau_nom ? <span>{a.bureau_nom}{a.est_secretariat_direction ? <Badge tone="ambre" className="ml-1">rattaché au Directeur</Badge> : <span className="block text-xs text-slate-500">{a.division_nom}</span>}</span> : a.niveau === 'DIVISION' ? a.division_nom : a.niveau === 'DIRECTION' ? 'Direction' : <span className="text-slate-500">Sans affectation</span>),
        },
        { key: 'poste', header: 'Poste organique', sortable: true },
        { key: 'statut', header: 'Statut', sortValue: (a) => STATUTS[a.statut]?.[0], render: (a) => <StatusBadge value={a.statut} /> },
        { key: 'username', header: 'Compte', sortable: true, render: (a) => (a.username ? <span className="text-xs">{a.username}</span> : <span className="text-xs text-slate-500">aucun</span>) },
      ]} />
  );
}
