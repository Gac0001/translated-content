import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, Select, ErrorAlert, Spinner, Badge } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { STATUTS } from '../../lib/labels';

export default function AgentsList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [statut, setStatut] = useState('');
  const [bureau, setBureau] = useState('');
  const bureaux = useApi('/organisation/bureaux');
  const qs = new URLSearchParams(Object.entries({ statut, bureau_id: bureau }).filter(([, v]) => v)).toString();
  const state = useApi(`/agents${qs ? `?${qs}` : ''}`);
  return (
    <>
      <PageHeader title="Personnel" subtitle="Agents de votre périmètre administratif." breadcrumb={[{ label: 'Personnel' }]}
        actions={<>
          <ExportButtons base="/agents/export" query={qs ? `?${qs}` : ''} print={false} />
          {can('personnel.gerer', 'personnel.suivre') && <Link to="/personnel/import" className="btn-secondary"><Upload size={16} /> Importer une liste</Link>}
          {can('personnel.gerer', 'personnel.suivre') && <Link to="/personnel/nouveau" className="btn-primary"><Plus size={16} /> Nouvel Agent</Link>}
        </>} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(a) => navigate(`/personnel/${a.id}`)}
          toolbar={<>
            <Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={['ACTIF', 'CONGE', 'DETACHE', 'SUSPENDU', 'RETRAITE', 'ARCHIVE'].map((s) => [s, STATUTS[s]?.[0] || 'Archivé'])} />
            <Select value={bureau} onChange={setBureau} placeholder="Toutes structures" options={(bureaux.data?.data || []).map((b) => [b.id, b.nom])} />
          </>}
          columns={[
            { key: 'matricule', header: 'Matricule' },
            { key: 'nom', header: 'Nom, postnom et prénom', render: (a) => <span className="font-medium">{[a.nom, a.postnom, a.prenom].filter(Boolean).join(' ')}</span>, search: (a) => `${a.nom} ${a.postnom} ${a.prenom}` },
            { key: 'grade', header: 'Grade' },
            { key: 'structure', header: 'Affectation', search: (a) => `${a.bureau_nom} ${a.division_nom}`, render: (a) => (a.bureau_nom ? <span>{a.bureau_nom}{a.est_secretariat_direction ? <Badge className="ml-1 bg-amber-50 text-amber-800 ring-amber-200">rattaché au Directeur</Badge> : <span className="block text-xs text-slate-500">{a.division_nom}</span>}</span> : a.niveau === 'DIVISION' ? a.division_nom : a.niveau === 'DIRECTION' ? 'Direction' : <span className="text-slate-400">Sans affectation</span>) },
            { key: 'poste', header: 'Poste organique' },
            { key: 'statut', header: 'Statut', render: (a) => <StatusBadge value={a.statut} /> },
            { key: 'username', header: 'Compte', render: (a) => (a.username ? <span className="text-xs">{a.username}</span> : <span className="text-xs text-slate-400">aucun</span>) },
          ]} />
      )}
    </>
  );
}
