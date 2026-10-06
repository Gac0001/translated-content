import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, Plus, Share2, UserPlus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, Badge } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { ROLES, STATUTS } from '../../lib/labels';

export default function UsersList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const liste = useListParams({ statut: '', role: '', inactifs: '' });
  const v = liste.valeurs;
  const state = useApi(`/users${queryString({ statut: v.statut, role: v.role, inactifs: v.inactifs })}`);
  const titulaire = (u) => [u.prenom, u.nom].filter(Boolean).join(' ');
  return (
    <ListPage title="Comptes utilisateurs" breadcrumb={[{ label: 'Administration' }, { label: 'Comptes' }]}
      liste={liste} state={state} onRowClick={(u) => navigate(`/comptes/${u.id}`)}
      actions={<>
        {can('delegations.gerer') && <Link to="/delegations" className="btn-secondary"><Share2 size={16} aria-hidden /> Délégations</Link>}
        {can('liste.consulter') && <Link to="/liste-declarative" className="btn-secondary"><ListChecks size={16} aria-hidden /> Liste déclarative</Link>}
        {can('compte.enroler') && <Link to="/comptes/enrolement" className="btn-secondary"><UserPlus size={16} aria-hidden /> Enrôler un agent</Link>}
        {can('compte.creer_initial') && <Link to="/comptes/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Compte institutionnel</Link>}
      </>}
      filtres={[
        { key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: [['ACTIF', 'Actif'], ['DESACTIVE', 'Désactivé'], ['VERROUILLE', 'Verrouillé']] },
        { key: 'role', label: 'Rôle', placeholder: 'Tous rôles', options: Object.entries(ROLES) },
        { key: 'inactifs', label: 'Activité', placeholder: 'Tous les comptes', options: [['1', `Inactifs (> ${state.data?.seuilInactiviteJours ?? 90} j)`]] },
      ]}
      columns={[
        { key: 'username', header: 'Utilisateur', primary: true, sortable: true, render: (u) => <span className="font-medium">{u.username}</span> },
        { key: 'nom', header: 'Titulaire', sortValue: (u) => [u.nom, u.prenom].filter(Boolean).join(' '), search: titulaire, render: (u) => titulaire(u) || <span className="text-slate-500">Compte technique</span> },
        { key: 'roles', header: 'Rôle(s)', sortValue: (u) => u.roles.map((r) => ROLES[r]).join(' '), search: (u) => u.roles.map((r) => ROLES[r]).join(' '), render: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{ROLES[r]}</Badge>)}</div> },
        { key: 'structure', header: 'Structure', sortValue: (u) => u.bureau_nom || u.division_nom, search: (u) => `${u.bureau_nom} ${u.division_nom}`, render: (u) => u.bureau_nom || u.division_nom || '—' },
        { key: 'statut', header: 'Statut', sortValue: (u) => STATUTS[u.statut]?.[0], render: (u) => <div className="flex flex-wrap gap-1"><StatusBadge value={u.statut} />{u.must_change_password && <Badge tone="info">Changement de MDP requis</Badge>}{u.inactif && <Badge tone="attention">Inactif</Badge>}</div> },
        { key: 'totp_actif', header: '2FA', render: (u) => (u.totp_actif ? <Badge tone="succes">Active</Badge> : <span className="text-xs text-slate-500">—</span>) },
        { key: 'last_login_at', header: 'Dernière connexion', sortable: true, render: (u) => fmtDateTime(u.last_login_at) },
      ]} />
  );
}
