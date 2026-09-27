import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KeyRound, LogOut, Power, ShieldCheck, Unlock } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, Badge, Modal, runAction, useConfirm, DataTable } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { ROLES } from '../../lib/labels';
import TempPassword from './TempPassword';

function RolesModal({ user, onClose, onDone }) {
  const { user: me } = useAuth();
  const isAdmin = me.roles.includes('ADMIN');
  const options = isAdmin ? Object.keys(ROLES) : ['CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'];
  const [roles, setRoles] = useState(user.roles);
  const toggle = (r) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  const save = async () => { await runAction(() => api.put(`/users/${user.id}/roles`, { roles }), 'Rôles mis à jour.'); onDone(); };
  return (
    <Modal open title="Rôles du compte" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!roles.length} onClick={save}>Enregistrer</button></>}>
      <p className="mb-3 text-sm text-slate-600">Le rôle doit être cohérent avec l’affectation : un Chef de Division est affecté au niveau d’une Division ; le Chef du Bureau Secrétariat de Direction reste un Chef de Bureau.</p>
      <div className="space-y-2">{options.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} /> {ROLES[r]}</label>)}</div>
    </Modal>
  );
}

export default function UserDetail() {
  const { id } = useParams();
  const state = useApi(`/users/${id}`);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [temp, setTemp] = useState(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const act = async (path, msg, opts) => {
    if (opts && !(await confirm(opts))) return;
    const r = await runAction(() => api.post(`/users/${id}/${path}`, {}), msg);
    if (r.data.motDePasseTemporaire) setTemp(r.data);
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(u) => (
        <>
          <PageHeader title={u.username} subtitle={[u.prenom, u.nom, u.postnom].filter(Boolean).join(' ')} breadcrumb={[{ label: 'Comptes', to: '/comptes' }, { label: u.username }]}
            actions={<>
              {can('comptes.activer') && (u.statut === 'DESACTIVE'
                ? <button type="button" className="btn-secondary" onClick={() => act('activer', 'Compte activé.')}><Power size={16} /> Activer</button>
                : <button type="button" className="btn-secondary" onClick={() => act('desactiver', 'Compte désactivé.', { title: 'Désactiver le compte', message: 'Le compte sera désactivé et toutes ses sessions révoquées.', danger: true })}><Power size={16} /> Désactiver</button>)}
              {u.statut === 'VERROUILLE' && can('comptes.deverrouiller') && <button type="button" className="btn-secondary" onClick={() => act('deverrouiller', 'Compte déverrouillé.')}><Unlock size={16} /> Déverrouiller</button>}
              {can('comptes.reinitialiser') && <button type="button" className="btn-secondary" onClick={() => act('reinitialiser-mot-de-passe', 'Mot de passe réinitialisé.', { title: 'Réinitialiser le mot de passe', message: 'Un mot de passe temporaire sera généré ; les sessions seront révoquées.' })}><KeyRound size={16} /> Réinitialiser le mot de passe</button>}
              {can('sessions.revoquer') && <button type="button" className="btn-secondary" onClick={() => act('revoquer-sessions', 'Sessions révoquées.', { title: 'Révoquer les sessions', message: 'L’utilisateur sera déconnecté de tous ses appareils.' })}><LogOut size={16} /> Révoquer les sessions</button>}
              {can('roles.gerer') && <button type="button" className="btn-primary" onClick={() => setRolesOpen(true)}><ShieldCheck size={16} /> Rôles</button>}
            </>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Compte" className="lg:col-span-2">
              <KeyValues items={[
                ['Statut', <StatusBadge key="s" value={u.statut} />], ['Rôle(s)', <div key="r" className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{ROLES[r]}</Badge>)}</div>],
                ['Titulaire', u.agent_id ? <Link key="a" className="text-dep-700 hover:underline" to={`/personnel/${u.agent_id}`}>{[u.prenom, u.nom].join(' ')} ({u.matricule})</Link> : 'Compte technique'],
                ['Structure', u.bureau_nom ? `${u.bureau_nom}${u.est_secretariat_direction ? ' (Bureau directement rattaché au Directeur)' : ''}` : u.division_nom || (u.niveau === 'DIRECTION' ? 'Direction' : '—')],
                ['Changement de mot de passe requis', u.must_change_password ? 'Oui' : 'Non'], ['Tentatives échouées', u.failed_attempts],
                ['Verrouillé jusqu’au', fmtDateTime(u.locked_until)], ['Dernière connexion', fmtDateTime(u.last_login_at)],
                ['Créé le', fmtDateTime(u.created_at)], ['Autorisé par', u.autorise_par_username ? `${u.autorise_par_username} le ${fmtDateTime(u.autorise_at)}` : '—'],
              ]} />
            </Card>
            <Card title="Délégations reçues">
              {u.delegations.length ? <ul className="space-y-2 text-sm">{u.delegations.map((d) => <li key={d.id}><b>{d.libelle}</b><div className="text-xs text-slate-500">Accordée par {d.granted_by} le {fmtDateTime(d.granted_at)}</div></li>)}</ul> : <p className="text-sm text-slate-500">Aucune.</p>}
            </Card>
            <Card title="Sessions actives" className="lg:col-span-3" bodyClass="p-0">
              <DataTable searchable={false} rows={u.sessions} empty="Aucune session active." columns={[{ key: 'created_at', header: 'Ouverte le', render: (s) => fmtDateTime(s.created_at) }, { key: 'ip', header: 'Adresse IP' }, { key: 'user_agent', header: 'Navigateur', render: (s) => <span className="text-xs">{s.user_agent}</span> }, { key: 'expires_at', header: 'Expire le', render: (s) => fmtDateTime(s.expires_at) }]} />
            </Card>
            <Card title="Historique des connexions" className="lg:col-span-3" bodyClass="p-0">
              <DataTable searchable={false} rows={u.connexions} columns={[{ key: 'created_at', header: 'Date et heure', render: (c) => fmtDateTime(c.created_at) }, { key: 'succes', header: 'Résultat', render: (c) => (c.succes ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Réussie</Badge> : <Badge className="bg-red-50 text-red-800 ring-red-200">Échec</Badge>) }, { key: 'motif', header: 'Détail' }, { key: 'ip', header: 'Adresse IP' }]} />
            </Card>
          </div>
          {rolesOpen && <RolesModal user={u} onClose={() => setRolesOpen(false)} onDone={() => { setRolesOpen(false); state.reload(); }} />}
          <TempPassword data={temp} onClose={() => setTemp(null)} />
        </>
      )}
    </Loadable>
  );
}
