import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Power, Send, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, Tabs, DataTable, Badge, InfoAlert, runAction, useConfirm, runCritique } from '../../components/ui';

function ModeMaintenance() {
  const state = useApi('/maintenance');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [f, setF] = useState({ message: '', fin: '' });
  useEffect(() => { if (state.data) setF({ message: state.data.etat.message || 'Maintenance technique du SIG-DEP en cours.', fin: state.data.etat.fin || '' }); }, [state.data]);
  const basculer = async (active) => {
    if (!(await confirm({ title: active ? 'Activer le mode maintenance' : 'Terminer la maintenance', message: active ? 'Tous les utilisateurs, sauf les Admins Système, seront déconnectés de fait et ne pourront plus se connecter.' : 'Les utilisateurs pourront de nouveau se connecter.', danger: active, confirmLabel: active ? 'Activer' : 'Terminer' }))) return;
    await runAction(() => api.put('/maintenance', { active, message: f.message, fin: f.fin }), active ? 'Mode maintenance activé.' : 'Mode maintenance désactivé.');
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <Card title="Mode maintenance">
          <div className={`mb-4 flex items-center gap-2 rounded-md p-3 text-sm ${d.etat.active ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>
            {d.etat.active ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            {d.etat.active ? <span><b>Maintenance en cours</b> — {d.etat.message}{d.etat.fin ? ` (fin prévue : ${d.etat.fin})` : ''}</span> : <span>Le SIG-DEP est ouvert à tous les utilisateurs.</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><label className="label" htmlFor="mm">Message affiché aux utilisateurs</label><input id="mm" className="input" maxLength={500} value={f.message} onChange={(e) => setF((x) => ({ ...x, message: e.target.value }))} /></div>
            <div><label className="label" htmlFor="mf">Fin prévue</label><input id="mf" className="input" placeholder="ex. samedi 10 h" maxLength={40} value={f.fin} onChange={(e) => setF((x) => ({ ...x, fin: e.target.value }))} /></div>
          </div>
          {can('systeme.maintenir') && (d.etat.active
            ? <button type="button" className="btn-primary mt-4" onClick={() => basculer(false)}><Power size={16} /> Terminer la maintenance</button>
            : <button type="button" className="btn-danger mt-4" disabled={f.message.trim().length < 5} onClick={() => basculer(true)}><Power size={16} /> Activer le mode maintenance</button>)}
          <p className="mt-3 text-xs text-slate-500">Conseil : prévenez les utilisateurs à l’avance par une annonce système.</p>
        </Card>
      )}
    </Loadable>
  );
}

function Annonces() {
  const state = useApi('/maintenance');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [f, setF] = useState({ titre: '', message: '' });
  const envoyer = async () => {
    if (!(await confirm({ title: 'Envoyer l’annonce', message: 'L’annonce sera adressée à tous les utilisateurs actifs (notification et e-mail selon leurs préférences).', confirmLabel: 'Envoyer' }))) return;
    await runAction(() => api.post('/maintenance/annonces', f), 'Annonce envoyée.'); setF({ titre: '', message: '' }); state.reload();
  };
  return (
    <div className="space-y-4">
      {can('notification_systeme.envoyer') && (
        <Card title="Nouvelle annonce système">
          <div className="space-y-3">
            <div><label className="label" htmlFor="at">Titre</label><input id="at" className="input" maxLength={150} value={f.titre} onChange={(e) => setF((x) => ({ ...x, titre: e.target.value }))} placeholder="Maintenance planifiée" /></div>
            <div><label className="label" htmlFor="am">Message</label><textarea id="am" className="input" rows={3} maxLength={2000} value={f.message} onChange={(e) => setF((x) => ({ ...x, message: e.target.value }))} placeholder="Le SIG-DEP sera indisponible samedi de 8 h à 10 h." /></div>
            <button type="button" className="btn-primary" disabled={f.titre.trim().length < 5 || f.message.trim().length < 10} onClick={envoyer}><Send size={16} /> Envoyer à tous les utilisateurs</button>
          </div>
        </Card>
      )}
      <Loadable state={state}>
        {(d) => <DataTable rows={d.annonces} searchable={false} empty="Aucune annonce." columns={[
          { key: 'created_at', header: 'Date', render: (a) => fmtDateTime(a.created_at) }, { key: 'titre', header: 'Titre' },
          { key: 'message', header: 'Message', render: (a) => <span className="text-xs">{a.message}</span> }, { key: 'destinataires', header: 'Destinataires' }, { key: 'envoye_par_username', header: 'Par' },
        ]} />}
      </Loadable>
    </div>
  );
}

function Migrations() {
  const state = useApi('/maintenance/migrations');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const appliquer = async () => {
    const mdp = await confirm({ title: 'Appliquer les migrations', message: 'Une sauvegarde de la base est faite automatiquement avant l’application.', confirmLabel: 'Appliquer', input: { label: 'Votre mot de passe', required: true } });
    if (!mdp) return;
    await runCritique(() => api.post('/maintenance/migrations/appliquer', { motDePasse: mdp }), 'Migrations appliquées.'); state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          {d.enAttente.length
            ? <InfoAlert tone="warning">{d.enAttente.length} migration(s) en attente : {d.enAttente.join(', ')}.</InfoAlert>
            : <InfoAlert>La structure de la base est à jour.</InfoAlert>}
          {can('systeme.maintenir') && d.enAttente.length > 0 && <button type="button" className="btn-primary" onClick={appliquer}>Appliquer les migrations</button>}
          <DataTable rows={d.appliquees} rowKey="nom" searchable={false} pageSize={50} columns={[{ key: 'nom', header: 'Migration', render: (m) => <code className="text-xs">{m.nom}</code> }, { key: 'date', header: 'Appliquée le', render: (m) => fmtDateTime(m.date) }]} />
        </div>
      )}
    </Loadable>
  );
}

function Environnement() {
  const state = useApi('/maintenance/environnement');
  const etat = { OK: [CheckCircle2, 'text-emerald-700'], ATTENTION: [AlertTriangle, 'text-amber-600'], CRITIQUE: [XCircle, 'text-red-700'] };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>Lecture seule : les paramètres d’environnement se modifient dans le fichier <code>backend/.env</code> du serveur, puis l’API est redémarrée. Les secrets ne sont jamais affichés.</InfoAlert>
          <Card title="Serveur"><p className="text-sm">Node.js {d.systeme.node} · {d.systeme.plateforme} · PostgreSQL {d.systeme.postgresql}</p></Card>
          <DataTable rows={d.parametres} rowKey="cle" pageSize={50} columns={[
            { key: 'cle', header: 'Paramètre', render: (p) => <code className="text-xs">{p.cle}</code> },
            { key: 'valeur', header: 'Valeur', render: (p) => (p.secret ? <Badge>{p.valeur}</Badge> : <span className="break-all text-xs">{p.valeur}</span>) },
            { key: 'statut', header: 'État', render: (p) => { if (!p.statut) return null; const [I, c] = etat[p.statut]; return <I size={16} className={c} aria-label={p.statut} />; } },
            { key: 'conseil', header: 'Observation', render: (p) => <span className="text-xs text-slate-600">{p.conseil}</span> },
          ]} />
        </div>
      )}
    </Loadable>
  );
}

export default function Maintenance() {
  const [tab, setTab] = useState('mode');
  return (
    <>
      <PageHeader title="Maintenance" subtitle="Mode maintenance, annonces aux utilisateurs, migrations de la base et paramètres d’environnement." breadcrumb={[{ label: 'Administration' }, { label: 'Maintenance' }]} />
      <Tabs tabs={[{ value: 'mode', label: 'Mode maintenance' }, { value: 'annonces', label: 'Annonces système' }, { value: 'migrations', label: 'Migrations' }, { value: 'env', label: 'Environnement' }]} value={tab} onChange={setTab} />
      {tab === 'mode' && <ModeMaintenance />}
      {tab === 'annonces' && <Annonces />}
      {tab === 'migrations' && <Migrations />}
      {tab === 'env' && <Environnement />}
    </>
  );
}

