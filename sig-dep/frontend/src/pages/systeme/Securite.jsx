import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, LogOut, Play, Save, ShieldCheck, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import { COLORS, ROLES } from '../../lib/labels';
import { useApi, Loadable, PageHeader, Card, Tabs, DataTable, Badge, InfoAlert, runAction, useConfirm, Select, Stat } from '../../components/ui';

const GRAVITE = {
  CRITIQUE: ['Critique', COLORS.danger],
  ATTENTION: ['Attention', COLORS.attention],
  INFO: ['Info', COLORS.info],
};
const STATUT_CONTROLE = {
  OK: [CheckCircle2, 'text-emerald-700', 'Conforme'],
  ATTENTION: [AlertTriangle, 'text-amber-600', 'À surveiller'],
  CRITIQUE: [XCircle, 'text-red-700', 'Critique'],
};
const navigateur = (ua) => {
  if (!ua) return '—';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Autre';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [nav, os].filter(Boolean).join(' · ');
};

function Alertes() {
  const [statut, setStatut] = useState('ouvertes');
  const state = useApi(`/securite/alertes?statut=${statut}`);
  const confirm = useConfirm();
  const acquitter = async (a) => {
    const r = await confirm({ title: 'Marquer comme traitée', message: a.titre, confirmLabel: 'Marquer traitée', input: { label: 'Commentaire (facultatif)' } });
    if (r === false) return;
    await runAction(() => api.post(`/securite/alertes/${a.id}/acquitter`, { commentaire: r || undefined }), 'Alerte traitée.');
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Critiques ouvertes" value={d.resume.CRITIQUE} icon={XCircle} tone={d.resume.CRITIQUE ? 'rouge' : 'gris'} />
            <Stat label="À surveiller" value={d.resume.ATTENTION} icon={AlertTriangle} tone={d.resume.ATTENTION ? 'jaune' : 'gris'} />
            <Stat label="Informations" value={d.resume.INFO} icon={Info} tone="gris" />
          </div>
          <DataTable rows={d.data} pageSize={25} empty="Aucune alerte." toolbar={<Select value={statut} onChange={(v) => setStatut(v || 'ouvertes')} placeholder="Ouvertes" options={[['toutes', 'Toutes']]} />}
            columns={[
              { key: 'created_at', header: 'Date', className: 'whitespace-nowrap', render: (a) => fmtDateTime(a.created_at) },
              { key: 'gravite', header: 'Gravité', render: (a) => <Badge className={GRAVITE[a.gravite][1]}>{GRAVITE[a.gravite][0]}</Badge> },
              { key: 'titre', header: 'Alerte', render: (a) => <div><div className="font-medium">{a.titre}</div>{a.message && <div className="text-xs text-slate-600">{a.message}</div>}</div>, search: (a) => `${a.titre} ${a.message || ''}` },
              { key: 'ip', header: 'Adresse IP', className: 'text-xs' },
              { key: 'etat', header: 'Traitement', render: (a) => (a.acquittee_at
                ? <span className="text-xs text-slate-500">Traitée le {fmtDateTime(a.acquittee_at)}{a.acquittee_par_username ? ` par ${a.acquittee_par_username}` : ''}</span>
                : <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => acquitter(a)}><CheckCircle2 size={14} /> Traitée</button>) },
            ]} />
        </div>
      )}
    </Loadable>
  );
}

function Connexions() {
  const [f, setF] = useState({ resultat: '', heures: '168' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const state = useApi(`/securite/connexions?${qs}`);
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Bilan de la période">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div><div className="text-2xl font-semibold text-emerald-700">{d.resume.succes}</div><div className="text-xs text-slate-500">Connexions réussies</div></div>
                <div><div className="text-2xl font-semibold text-red-700">{d.resume.echecs}</div><div className="text-xs text-slate-500">Échecs</div></div>
              </div>
            </Card>
            <Card title="Adresses IP avec le plus d’échecs" className="lg:col-span-2" bodyClass="p-0">
              <DataTable encadre={false} searchable={false} label="Adresses IP avec le plus d’échecs" rows={d.ipsSuspectes} rowKey="ip" empty="Aucun échec sur la période." columns={[
                { key: 'ip', header: 'Adresse IP', render: (r) => <code className="text-xs">{r.ip || '—'}</code> },
                { key: 'echecs', header: 'Échecs' }, { key: 'comptes', header: 'Comptes visés' },
                { key: 'derniere', header: 'Dernier échec', render: (r) => fmtDateTime(r.derniere) },
              ]} />
            </Card>
          </div>
          <DataTable rows={d.data} pageSize={50}
            toolbar={<>
              <Select value={f.resultat} onChange={(v) => setF((x) => ({ ...x, resultat: v }))} placeholder="Tous résultats" options={[['echec', 'Échecs'], ['succes', 'Réussites']]} />
              <Select value={f.heures} onChange={(v) => setF((x) => ({ ...x, heures: v || '168' }))} placeholder="7 derniers jours" options={[['24', '24 heures'], ['720', '30 jours'], ['2160', '90 jours']]} />
            </>}
            columns={[
              { key: 'created_at', header: 'Date et heure', className: 'whitespace-nowrap', render: (c) => fmtDateTime(c.created_at) },
              { key: 'username', header: 'Utilisateur' },
              { key: 'succes', header: 'Résultat', render: (c) => (c.succes ? <Badge tone="succes">Réussie</Badge> : <Badge tone="danger">Échec</Badge>) },
              { key: 'motif', header: 'Détail' },
              { key: 'ip', header: 'Adresse IP', render: (c) => <code className="text-xs">{c.ip}</code> },
              { key: 'user_agent', header: 'Navigateur', render: (c) => <span className="text-xs">{navigateur(c.user_agent)}</span> },
            ]} />
        </div>
      )}
    </Loadable>
  );
}

function Sessions() {
  const state = useApi('/securite/sessions');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const fermer = async (s) => {
    const r = await confirm({ title: 'Fermer la session', message: `La session de « ${s.username} » (${s.ip || 'IP inconnue'}) ne pourra plus être renouvelée ; elle s’interrompt au plus tard à l’expiration du jeton d’accès (quelques minutes).`, danger: true, confirmLabel: 'Fermer la session', input: { label: 'Motif (facultatif)' } });
    if (r === false) return;
    await runAction(() => api.post(`/securite/sessions/${s.family_id}/revoquer`, { motif: r || undefined }), 'Session fermée.');
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <DataTable rows={d.data} rowKey="family_id" empty="Aucune session active."
          columns={[
            { key: 'username', header: 'Utilisateur', render: (s) => <Link to={`/comptes/${s.user_id}`} className="font-medium link">{s.username}</Link> },
            { key: 'roles', header: 'Rôle', render: (s) => s.roles.map((r) => ROLES[r]).join(', '), search: (s) => s.roles.join(' ') },
            { key: 'ip', header: 'Adresse IP', render: (s) => <code className="text-xs">{s.ip}</code> },
            { key: 'user_agent', header: 'Navigateur', render: (s) => <span className="text-xs">{navigateur(s.user_agent)}</span> },
            { key: 'ouverte_le', header: 'Ouverte le', render: (s) => fmtDateTime(s.ouverte_le) },
            { key: 'expires_at', header: 'Expire le', render: (s) => fmtDateTime(s.expires_at) },
            ...(can('session.revoquer') ? [{ key: 'act', header: '', render: (s) => <button type="button" className="btn-ghost text-red-700" onClick={() => fermer(s)} title="Fermer la session" aria-label={`Fermer la session de ${s.username}`}><LogOut size={16} aria-hidden /></button> }] : []),
          ]} />
      )}
    </Loadable>
  );
}

function Politique() {
  const state = useApi('/securite/politique');
  const can = useAuth((s) => s.can);
  const [v, setV] = useState(null);
  useEffect(() => { if (state.data) setV(state.data.valeurs); }, [state.data]);
  if (!state.data || !v) return <Loadable state={state}>{() => null}</Loadable>;
  const { libelles, bornes, valeurs } = state.data;
  const modifie = Object.keys(v).some((k) => v[k] !== valeurs[k]);
  const enregistrer = async () => {
    const changes = Object.fromEntries(Object.keys(v).filter((k) => v[k] !== valeurs[k]).map((k) => [k, v[k]]));
    await runAction(() => api.put('/securite/politique', changes), 'Politique enregistrée.');
    state.reload();
  };
  const groupes = [
    ['Mots de passe', ['mdp_longueur_min', 'mdp_exiger_majuscule', 'mdp_exiger_minuscule', 'mdp_exiger_chiffre', 'mdp_exiger_special', 'mdp_historique', 'mdp_expiration_jours']],
    ['Verrouillage et alertes', ['verrouillage_tentatives', 'verrouillage_minutes', 'alerte_echecs_seuil']],
    ['Sessions', ['session_duree_jours', 'session_inactivite_minutes']],
    ['Comptes inactifs', ['inactivite_compte_jours', 'inactivite_desactivation_auto']],
  ];
  const lecture = !can('systeme.configurer');
  return (
    <div className="space-y-4">
      <InfoAlert>Les valeurs sont encadrées pour empêcher un affaiblissement excessif. Toute modification est inscrite au journal d’audit et génère une alerte. Les nouveaux paramètres s’appliquent aux prochains changements de mot de passe et aux prochaines connexions.</InfoAlert>
      <div className="grid gap-4 lg:grid-cols-2">
        {groupes.map(([titre, cles]) => (
          <Card key={titre} title={titre}>
            <div className="space-y-3">
              {cles.map((k) => (typeof v[k] === 'boolean'
                ? <label key={k} className="flex items-center justify-between gap-3 text-sm"><span>{libelles[k]}</span><input type="checkbox" disabled={lecture} checked={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.checked }))} /></label>
                : (
                  <label key={k} className="flex items-center justify-between gap-3 text-sm">
                    <span>{libelles[k]} <span className="text-xs text-slate-400">({bornes[k][0]}–{bornes[k][1]})</span></span>
                    <input type="number" className="input w-24 text-right" disabled={lecture} min={bornes[k][0]} max={bornes[k][1]} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: Number(e.target.value) }))} />
                  </label>
                )))}
            </div>
          </Card>
        ))}
      </div>
      {!lecture && <button type="button" className="btn-primary" disabled={!modifie} onClick={enregistrer}><Save size={16} /> Enregistrer la politique</button>}
    </div>
  );
}

function Verification() {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const lancer = async () => { setBusy(true); try { setR((await runAction(() => api.post('/securite/verification'))).data); } catch { /* affiché */ } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <Card title="Vérification de sécurité" actions={<button type="button" className="btn-primary" disabled={busy} onClick={lancer}><Play size={16} /> {busy ? 'Vérification…' : 'Lancer la vérification'}</button>}>
        <p className="text-sm text-slate-600">Contrôle l’intégrité du journal d’audit, la double authentification et l’adresse de récupération des Admins, les mots de passe temporaires, les comptes inactifs ou verrouillés, les échecs de connexion, la politique, la configuration (secret JWT, cookies HTTPS, messagerie), la dernière sauvegarde et les fichiers téléversés.</p>
      </Card>
      {r && (
        <Card title={`Résultat — ${fmtDateTime(r.verifieAt)}`} actions={<Badge className={r.bilan === 'OK' ? COLORS.succes : GRAVITE[r.bilan][1]}>{r.bilan === 'OK' ? 'Conforme' : STATUT_CONTROLE[r.bilan][2]}</Badge>} bodyClass="p-0">
          <ul className="divide-y divide-slate-100">
            {r.controles.map((c) => {
              const [Icon, cls, lib] = STATUT_CONTROLE[c.statut];
              return (
                <li key={c.controle} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <Icon size={18} className={`mt-0.5 shrink-0 ${cls}`} aria-label={lib} />
                  <div className="min-w-0 flex-1"><div className="font-medium">{c.controle}</div><div className="text-slate-600">{c.detail}</div></div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function Securite() {
  const can = useAuth((s) => s.can);
  const tabs = [
    can('securite.superviser') && { value: 'alertes', label: 'Alertes' },
    can('securite.superviser') && { value: 'connexions', label: 'Connexions' },
    can('session.consulter') && { value: 'sessions', label: 'Sessions actives' },
    can('systeme.consulter', 'securite.superviser') && { value: 'politique', label: 'Politique' },
    can('securite.superviser') && { value: 'verification', label: 'Vérification' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.value);
  return (
    <>
      <PageHeader title="Sécurité" subtitle="Surveillance des accès, sessions, politique des mots de passe et contrôles de sécurité." breadcrumb={[{ label: 'Administration' }, { label: 'Sécurité' }]}
        actions={<Link to="/audit" className="btn-secondary"><ShieldCheck size={16} /> Journal d’audit</Link>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'alertes' && <Alertes />}
      {tab === 'connexions' && <Connexions />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'politique' && <Politique />}
      {tab === 'verification' && <Verification />}
    </>
  );
}
