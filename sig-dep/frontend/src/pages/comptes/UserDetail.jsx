import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, KeyRound, LogOut, Power, RefreshCcw, ShieldCheck, Unlock } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, Badge, Modal, runAction, useConfirm, DataTable } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { ROLES } from '../../lib/labels';
import TempPassword from './TempPassword';

// Rôles d’autorité : leur attribution exige une décision administrative enregistrée (non disponible ici).
const ROLES_DECISION = ['ADMIN_SYSTEME', 'SECRETAIRE_GENERAL', 'DIRECTEUR', 'CHEF_DIVISION'];

function BloquerModal({ user, onClose, onDone }) {
  const [minutes, setMinutes] = useState(60);
  const [motif, setMotif] = useState('');
  const save = async () => { await runAction(() => api.post(`/users/${user.id}/bloquer`, { minutes: Number(minutes), motif }), 'Compte bloqué.'); onDone(); };
  return (
    <Modal open title="Bloquer temporairement le compte" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-danger" disabled={motif.trim().length < 3} onClick={save}><Ban size={16} /> Bloquer</button></>}>
      <p className="mb-3 text-sm text-slate-600">À utiliser pour un compte compromis ou suspect : toutes ses sessions sont fermées et il ne peut plus se connecter jusqu’à l’échéance (déblocage automatique) ou jusqu’à son déblocage.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="b-min">Durée</label>
          <select id="b-min" className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            {[[30, '30 minutes'], [60, '1 heure'], [240, '4 heures'], [1440, '24 heures'], [4320, '3 jours'], [10080, '7 jours']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="b-motif">Motif <span className="text-red-600">*</span></label><textarea id="b-motif" className="input" rows={2} value={motif} onChange={(e) => setMotif(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function RolesModal({ user, onClose, onDone }) {
  const { user: me } = useAuth();
  const isAdmin = me.roles.includes('ADMIN_SYSTEME');
  const options = isAdmin ? Object.keys(ROLES).filter((r) => !ROLES_DECISION.includes(r) || user.roles.includes(r)) : ['CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'];
  const [roles, setRoles] = useState(user.roles);
  const toggle = (r) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  const save = async () => { await runAction(() => api.put(`/users/${user.id}/roles`, { roles }), 'Rôles mis à jour.'); onDone(); };
  return (
    <Modal open title="Rôles du compte" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!roles.length} onClick={save}>Enregistrer</button></>}>
      <p className="mb-3 text-sm text-slate-600">Le rôle doit être cohérent avec l’affectation : un Chef de Division est affecté au niveau d’une Division ; le Chef du Bureau Secrétariat de Direction reste un Chef de Bureau.</p>
      {isAdmin && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">Les rôles Directeur, Chef de Division, Secrétaire Général et Admin Système ne peuvent être attribués ou retirés qu’en exécution d’une décision administrative enregistrée.</p>}
      <div className="space-y-2">{options.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={isAdmin && ROLES_DECISION.includes(r)} checked={roles.includes(r)} onChange={() => toggle(r)} /> {ROLES[r]}</label>)}</div>
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
  const [bloquerOpen, setBloquerOpen] = useState(false);
  const fermerSession = async (s) => {
    if (!(await confirm({ title: 'Fermer cette session', message: `Session ouverte depuis ${s.ip || 'une adresse inconnue'} : elle ne pourra plus être renouvelée.`, danger: true, confirmLabel: 'Fermer' }))) return;
    await runAction(() => api.post(`/securite/sessions/${s.family_id}/revoquer`, {}), 'Session fermée.');
    state.reload();
  };
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
              {u.statut === 'DESACTIVE'
                ? can('compte.activer') && <button type="button" className="btn-secondary" onClick={() => act('activer', 'Compte activé.')}><Power size={16} /> Activer</button>
                : can('compte.desactiver') && <button type="button" className="btn-secondary" onClick={() => act('desactiver', 'Compte désactivé.', { title: 'Désactiver le compte', message: 'Le compte sera désactivé et toutes ses sessions révoquées.', danger: true })}><Power size={16} /> Désactiver</button>}
              {u.statut === 'ACTIF' && can('compte.desactiver') && <button type="button" className="btn-secondary" onClick={() => setBloquerOpen(true)}><Ban size={16} /> Bloquer temporairement</button>}
              {can('compte.reinitialiser_mot_de_passe') && !u.must_change_password && <button type="button" className="btn-secondary" onClick={() => act('imposer-changement', 'Changement de mot de passe imposé.', { title: 'Imposer un changement de mot de passe', message: 'Le titulaire devra choisir un nouveau mot de passe avant toute autre opération. Aucun mot de passe ne vous est communiqué.' })}><RefreshCcw size={16} /> Imposer un changement</button>}
              {u.statut === 'VERROUILLE' && can('compte.deverrouiller') && <button type="button" className="btn-secondary" onClick={() => act('deverrouiller', 'Compte déverrouillé.')}><Unlock size={16} /> Déverrouiller</button>}
              {can('compte.reinitialiser_mot_de_passe') && <button type="button" className="btn-secondary" onClick={() => act('reinitialiser-mot-de-passe', 'Mot de passe réinitialisé.', { title: 'Réinitialiser le mot de passe', message: 'Un mot de passe temporaire sera généré ; les sessions seront révoquées.' })}><KeyRound size={16} /> Réinitialiser le mot de passe</button>}
              {can('session.revoquer') && <button type="button" className="btn-secondary" onClick={() => act('revoquer-sessions', 'Sessions révoquées.', { title: 'Révoquer les sessions', message: 'L’utilisateur sera déconnecté de tous ses appareils.' })}><LogOut size={16} /> Révoquer les sessions</button>}
              {can('role.attribuer') && <button type="button" className="btn-primary" onClick={() => setRolesOpen(true)}><ShieldCheck size={16} /> Rôles</button>}
            </>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Compte" className="lg:col-span-2">
              <KeyValues items={[
                ['Statut', <StatusBadge key="s" value={u.statut} />], ['Rôle(s)', <div key="r" className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{ROLES[r]}</Badge>)}</div>],
                ['Titulaire', u.agent_id ? <Link key="a" className="text-dep-700 hover:underline" to={`/personnel/${u.agent_id}`}>{[u.prenom, u.nom].join(' ')} ({u.matricule})</Link> : 'Compte technique'],
                ['Structure', u.bureau_nom ? `${u.bureau_nom}${u.est_secretariat_direction ? ' (Bureau directement rattaché au Directeur)' : ''}` : u.division_nom || (u.niveau === 'DIRECTION' ? 'Direction' : '—')],
                ['Changement de mot de passe requis', u.must_change_password ? 'Oui' : 'Non'], ['Tentatives échouées', u.failed_attempts],
                ['Verrouillé jusqu’au', fmtDateTime(u.locked_until)], u.motif_blocage && ['Motif du blocage', u.motif_blocage], ['Dernière connexion', fmtDateTime(u.last_login_at)],
                ['Mot de passe changé le', fmtDateTime(u.password_changed_at)],
                ['Double authentification', u.totp_actif ? `Active depuis le ${fmtDateTime(u.totp_active_at)}` : 'Inactive'],
                u.email_recuperation && ['Adresse de récupération', `${u.email_recuperation} — ${u.email_recuperation_verifie_at ? 'vérifiée' : 'non vérifiée'}`],
                ['Créé le', fmtDateTime(u.created_at)], ['Créé (enrôlé) par', u.autorise_par_username ? `${u.autorise_par_username} le ${fmtDateTime(u.autorise_at)}` : '—'],
              ]} />
            </Card>
            <Card title="Délégations reçues">
              {u.delegations.length ? <ul className="space-y-2 text-sm">{u.delegations.map((d) => <li key={d.id}><b>{d.libelle}</b><div className="text-xs text-slate-500">Accordée par {d.granted_by} le {fmtDateTime(d.granted_at)}</div></li>)}</ul> : <p className="text-sm text-slate-500">Aucune.</p>}
            </Card>
            <Card title="Sessions actives" className="lg:col-span-3" bodyClass="p-0">
              <DataTable searchable={false} rows={u.sessions} empty="Aucune session active." columns={[
                { key: 'created_at', header: 'Dernier renouvellement', render: (s) => fmtDateTime(s.created_at) }, { key: 'ip', header: 'Adresse IP' },
                { key: 'user_agent', header: 'Navigateur', render: (s) => <span className="text-xs">{s.user_agent}</span> }, { key: 'expires_at', header: 'Expire le', render: (s) => fmtDateTime(s.expires_at) },
                ...(can('session.revoquer') ? [{ key: 'act', header: '', render: (s) => <button type="button" className="btn-ghost text-red-700" title="Fermer cette session" onClick={() => fermerSession(s)}><LogOut size={16} /></button> }] : []),
              ]} />
            </Card>
            <Card title="Historique des connexions" className="lg:col-span-3" bodyClass="p-0">
              <DataTable searchable={false} rows={u.connexions} columns={[{ key: 'created_at', header: 'Date et heure', render: (c) => fmtDateTime(c.created_at) }, { key: 'succes', header: 'Résultat', render: (c) => (c.succes ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Réussie</Badge> : <Badge className="bg-red-50 text-red-800 ring-red-200">Échec</Badge>) }, { key: 'motif', header: 'Détail' }, { key: 'ip', header: 'Adresse IP' }]} />
            </Card>
          </div>
          {bloquerOpen && <BloquerModal user={u} onClose={() => setBloquerOpen(false)} onDone={() => { setBloquerOpen(false); state.reload(); }} />}
          {rolesOpen && <RolesModal user={u} onClose={() => setRolesOpen(false)} onDone={() => { setRolesOpen(false); state.reload(); }} />}
          <TempPassword data={temp} onClose={() => setTemp(null)} />
        </>
      )}
    </Loadable>
  );
}
