import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, Plus, Share2, UserPlus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, DataTable, StatusBadge, Select, Spinner, ErrorAlert, Badge } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { ROLES } from '../../lib/labels';

export default function UsersList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [statut, setStatut] = useState('');
  const [role, setRole] = useState('');
  const qs = new URLSearchParams(Object.entries({ statut, role }).filter(([, v]) => v)).toString();
  const state = useApi(`/users${qs ? `?${qs}` : ''}`);
  return (
    <>
      <PageHeader title="Comptes utilisateurs" breadcrumb={[{ label: 'Administration' }, { label: 'Comptes' }]}
        actions={<>
          {can('delegations.gerer') && <Link to="/delegations" className="btn-secondary"><Share2 size={16} /> Délégations</Link>}
          {can('liste.consulter') && <Link to="/liste-declarative" className="btn-secondary"><ListChecks size={16} /> Liste déclarative</Link>}
          {can('comptes.enroler') && <Link to="/comptes/enrolement" className="btn-secondary"><UserPlus size={16} /> Enrôler un agent</Link>}
          {can('comptes.creer_initial') && <Link to="/comptes/nouveau" className="btn-primary"><Plus size={16} /> Compte institutionnel</Link>}
        </>} />
      <ErrorAlert message={state.error} />
      {state.loading && !state.data ? <Spinner /> : (
        <DataTable rows={state.data?.data || []} onRowClick={(u) => navigate(`/comptes/${u.id}`)}
          toolbar={<>
            <Select value={statut} onChange={setStatut} placeholder="Tous statuts" options={[['ACTIF', 'Actif'], ['DESACTIVE', 'Désactivé'], ['VERROUILLE', 'Verrouillé']]} />
            <Select value={role} onChange={setRole} placeholder="Tous rôles" options={Object.entries(ROLES)} />
          </>}
          columns={[
            { key: 'username', header: 'Utilisateur', render: (u) => <span className="font-medium">{u.username}</span> },
            { key: 'nom', header: 'Titulaire', render: (u) => [u.prenom, u.nom].filter(Boolean).join(' ') || <span className="text-slate-400">Compte technique</span>, search: (u) => `${u.prenom} ${u.nom}` },
            { key: 'roles', header: 'Rôle(s)', render: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{ROLES[r]}</Badge>)}</div>, search: (u) => u.roles.map((r) => ROLES[r]).join(' ') },
            { key: 'structure', header: 'Structure', render: (u) => u.bureau_nom || u.division_nom || '—', search: (u) => `${u.bureau_nom} ${u.division_nom}` },
            { key: 'statut', header: 'Statut', render: (u) => <div className="flex flex-wrap gap-1"><StatusBadge value={u.statut} />{u.statut === 'DESACTIVE' && !u.autorise_par && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">En attente d’autorisation</Badge>}{u.must_change_password && <Badge className="bg-sky-50 text-sky-800 ring-sky-200">MDP temporaire</Badge>}</div> },
            { key: 'last_login_at', header: 'Dernière connexion', render: (u) => fmtDateTime(u.last_login_at) },
          ]} />
      )}
    </>
  );
}
