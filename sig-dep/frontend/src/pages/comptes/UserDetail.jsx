import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, KeyRound, LogOut, Power, RefreshCcw, ShieldCheck, Unlock } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, Badge, Modal, Field, runAction, useConfirm, DataTable, Button, IconButton, DropdownMenu } from '../../components/ui';
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
  const options = isAdmin ? Object.keys(ROLES) : ['CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'];
  const [roles, setRoles] = useState(user.roles);
  const [acteId, setActeId] = useState('');
  const fondements = useApi(isAdmin && user.agent_id ? `/actes/fondements?agent_id=${user.agent_id}` : null);
  const toggle = (r) => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  // Rôles d’autorité modifiés : un acte validé (nomination, affectation, fin de fonction) est exigé.
  const sensible = ROLES_DECISION.some((r) => roles.includes(r) !== user.roles.includes(r));
  const save = async () => { await runAction(() => api.put(`/users/${user.id}/roles`, { roles, acte_id: acteId ? Number(acteId) : undefined }), 'Rôles mis à jour.'); onDone(); };
  const actes = fondements.data?.data || [];
  return (
    <Modal open title="Rôles du compte" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!roles.length || (sensible && !acteId)} onClick={save}>Enregistrer</button></>}>
      <p className="mb-3 text-sm text-slate-600">Le rôle doit être cohérent avec l’affectation : un Chef de Division est affecté au niveau d’une Division ; le Chef du Bureau Secrétariat de Direction reste un Chef de Bureau.</p>
      {isAdmin && <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">Les rôles Directeur, Chef de Division, Secrétaire Général et Admin Système ne s’attribuent ou ne se retirent qu’en exécution d’un acte validé (nomination, affectation ou fin de fonction) enregistré dans le registre des actes.</p>}
      <div className="space-y-2">{options.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} /> {ROLES[r]}</label>)}</div>
      {sensible && (
        <div className="mt-4">
          <Field label="Acte fondant la décision" required hint={actes.length ? undefined : 'Aucun acte validé ne concerne cette personne : faites enregistrer et valider l’acte au préalable.'}>
            <select className="input" value={acteId} onChange={(e) => setActeId(e.target.value)}>
              <option value="">— Choisir —</option>
              {actes.map((a) => <option key={a.id} value={a.id}>{a.numero} · {a.typeLibelle} · {a.reference}</option>)}
            </select>
          </Field>
        </div>
      )}
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
          <PageHeader title={u.username} subtitle={[u.prenom, u.nom, u.postnom].filter(Boolean).join(' ')} breadcrumb={[{ label: 'Administration' }, { label: 'Comptes', to: '/comptes' }, { label: u.username }]}
            actions={<>
              {u.statut === 'VERROUILLE' && can('compte.deverrouiller') && <Button icon={Unlock} onClick={() => act('deverrouiller', 'Compte déverrouillé.')}>Déverrouiller</Button>}
              <DropdownMenu label="Actions du compte" width="w-72" items={[
                u.statut === 'DESACTIVE' && can('compte.activer') && { label: 'Activer le compte', icon: Power, onClick: () => act('activer', 'Compte activé.') },
                u.statut !== 'DESACTIVE' && can('compte.desactiver') && { label: 'Désactiver le compte', icon: Power, danger: true, onClick: () => act('desactiver', 'Compte désactivé.', { title: 'Désactiver le compte', message: 'Le compte sera désactivé et toutes ses sessions révoquées.', danger: true }) },
                u.statut === 'ACTIF' && can('compte.desactiver') && { label: 'Bloquer temporairement', icon: Ban, danger: true, onClick: () => setBloquerOpen(true) },
                can('compte.reinitialiser_mot_de_passe') && !u.must_change_password && { label: 'Imposer un changement de mot de passe', icon: RefreshCcw, onClick: () => act('imposer-changement', 'Changement de mot de passe imposé.', { title: 'Imposer un changement de mot de passe', message: 'Le titulaire devra choisir un nouveau mot de passe avant toute autre opération. Aucun mot de passe ne vous est communiqué.' }) },
                can('compte.reinitialiser_mot_de_passe') && { label: 'Réinitialiser le mot de passe', icon: KeyRound, onClick: () => act('reinitialiser-mot-de-passe', 'Mot de passe réinitialisé.', { title: 'Réinitialiser le mot de passe', message: 'Un mot de passe temporaire sera généré ; les sessions seront révoquées.' }) },
                can('session.revoquer') && { label: 'Révoquer toutes les sessions', icon: LogOut, onClick: () => act('revoquer-sessions', 'Sessions révoquées.', { title: 'Révoquer les sessions', message: 'L’utilisateur sera déconnecté de tous ses appareils.' }) },
              ]} />
              {can('role.attribuer') && <Button variant="primary" icon={ShieldCheck} onClick={() => setRolesOpen(true)}>Rôles</Button>}
            </>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Compte" className="lg:col-span-2">
              <KeyValues items={[
                ['Statut', <StatusBadge key="s" value={u.statut} />], ['Rôle(s)', <div key="r" className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{ROLES[r]}</Badge>)}</div>],
                ['Titulaire', u.agent_id ? <Link key="a" className="link" to={`/personnel/${u.agent_id}`}>{[u.prenom, u.nom].join(' ')} ({u.matricule})</Link> : 'Compte technique'],
                ['Structure', u.bureau_nom ? `${u.bureau_nom}${u.est_secretariat_direction ? ' (Bureau directement rattaché au Directeur)' : ''}` : u.division_nom || (u.niveau === 'DIRECTION' ? 'Direction' : '—')],
                ['Changement de mot de passe requis', u.must_change_password ? 'Oui' : 'Non'], ['Tentatives échouées', u.failed_attempts],
                ['Verrouillé jusqu’au', fmtDateTime(u.locked_until)], u.motif_blocage && ['Motif du blocage', u.motif_blocage], ['Dernière connexion', fmtDateTime(u.last_login_at)],
                ['Mot de passe changé le', fmtDateTime(u.password_changed_at)],
                ['Double authentification', u.totp_actif ? `Active depuis le ${fmtDateTime(u.totp_active_at)}` : 'Inactive'],
                u.email_recuperation && ['Adresse de récupération', `${u.email_recuperation} — ${u.email_recuperation_verifie_at ? 'vérifiée' : 'non vérifiée'}`],
                ['Créé le', fmtDateTime(u.created_at)], ['Créé (enrôlé) par', u.autorise_par_username ? `${u.autorise_par_username} le ${fmtDateTime(u.autorise_at)}` : '—'],
              ]} />
            </Card>
            <Card title="Désignations en cours">
              {u.delegations.length ? <ul className="space-y-2 text-sm">{u.delegations.map((d) => <li key={d.id}><b>{d.libelle}</b><div className="text-xs text-slate-500">{d.acte_numero ? `Acte ${d.acte_numero}${d.date_fin ? ` — jusqu’au ${d.date_fin.split('-').reverse().join('/')}` : ''}` : `Sans acte — à régulariser`} · accordée par {d.granted_by} le {fmtDateTime(d.granted_at)}</div></li>)}</ul> : <p className="text-sm text-slate-500">Aucune.</p>}
            </Card>
            <Card title="Sessions actives" className="lg:col-span-3" bodyClass="p-0">
              <DataTable encadre={false} searchable={false} label="Sessions actives" rows={u.sessions} empty="Aucune session active." columns={[
                { key: 'created_at', header: 'Dernier renouvellement', render: (s) => fmtDateTime(s.created_at) }, { key: 'ip', header: 'Adresse IP' },
                { key: 'user_agent', header: 'Navigateur', render: (s) => <span className="text-xs">{s.user_agent}</span> }, { key: 'expires_at', header: 'Expire le', render: (s) => fmtDateTime(s.expires_at) },
                ...(can('session.revoquer') ? [{ key: 'act', header: '', render: (s) => <IconButton label={`Fermer la session ouverte depuis ${s.ip || 'une adresse inconnue'}`} icon={LogOut} className="text-red-700" onClick={() => fermerSession(s)} /> }] : []),
              ]} />
            </Card>
            <Card title="Historique des connexions" className="lg:col-span-3" bodyClass="p-0">
              <DataTable encadre={false} searchable={false} label="Historique des connexions" rows={u.connexions} columns={[{ key: 'created_at', header: 'Date et heure', render: (c) => fmtDateTime(c.created_at) }, { key: 'succes', header: 'Résultat', render: (c) => (c.succes ? <Badge tone="succes">Réussie</Badge> : <Badge tone="danger">Échec</Badge>) }, { key: 'motif', header: 'Détail' }, { key: 'ip', header: 'Adresse IP' }]} />
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
