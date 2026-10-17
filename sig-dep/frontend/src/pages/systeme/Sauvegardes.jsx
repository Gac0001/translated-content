import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseBackup, Download, FlaskConical, History, Lock, LockOpen, Save, ShieldCheck, Trash2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDateTime, fmtTaille } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, DataTable, Badge, Stat, InfoAlert, IconButton, NumberInput, runAction, toast, useConfirm, Tabs, useOnglet } from '../../components/ui';

const ORIGINES = { MANUELLE: 'Manuelle', PROGRAMMEE: 'Programmée', AVANT_REINITIALISATION: 'Avant réinitialisation', AVANT_RESTAURATION: 'Avant restauration', AVANT_MIGRATION: 'Avant migration' };
const PALIERS = { QUOTIDIENNE: 'Quotidienne', HEBDOMADAIRE: 'Hebdomadaire', MENSUELLE: 'Mensuelle' };
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const ok = 'bg-emerald-50 text-emerald-800 ring-emerald-200';
const ko = 'bg-red-50 text-red-800 ring-red-200';
const att = 'bg-amber-50 text-amber-800 ring-amber-200';

function Planification({ p, onDone }) {
  const can = useAuth((s) => s.can);
  const [v, setV] = useState(p);
  useEffect(() => setV(p), [p]);
  const modifie = Object.keys(v).some((k) => v[k] !== p[k]);
  const [enCours, setEnCours] = useState(false);
  const num = (k, min, max) => <NumberInput className="w-20" min={min} max={max} disabled={!can('systeme.configurer')} value={v[k]} onChange={(n) => { if (n !== null) setV((x) => ({ ...x, [k]: n })); }} />;
  const save = async () => {
    const changes = Object.fromEntries(Object.keys(v).filter((k) => v[k] !== p[k]).map((k) => [k, v[k]]));
    setEnCours(true);
    try { await runAction(() => api.put('/sauvegardes/planification', changes), 'Planification enregistrée.'); onDone(); } catch { /* erreur déjà signalée */ } finally { setEnCours(false); }
  };
  return (
    <Card title="Planification et conservation">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3"><span>Sauvegarde automatique quotidienne</span><input type="checkbox" disabled={!can('systeme.configurer')} checked={v.sauvegarde_auto} onChange={(e) => setV((x) => ({ ...x, sauvegarde_auto: e.target.checked }))} /></label>
          <label className="flex items-center justify-between gap-3"><span>Heure (Kinshasa)</span><input type="time" className="input w-32" disabled={!can('systeme.configurer')} value={v.sauvegarde_heure} onChange={(e) => setV((x) => ({ ...x, sauvegarde_heure: e.target.value }))} /></label>
          <label className="flex items-center justify-between gap-3"><span>Test de restauration hebdomadaire</span><input type="checkbox" disabled={!can('systeme.configurer')} checked={v.test_restauration_auto} onChange={(e) => setV((x) => ({ ...x, test_restauration_auto: e.target.checked }))} /></label>
          <label className="flex items-center justify-between gap-3"><span>Jour du test</span>
            <select className="input w-40" disabled={!can('systeme.configurer')} value={v.test_restauration_jour} onChange={(e) => setV((x) => ({ ...x, test_restauration_jour: Number(e.target.value) }))}>{JOURS.map((j, i) => <option key={j} value={i}>{j}</option>)}</select></label>
        </div>
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3"><span>Sauvegardes quotidiennes conservées</span>{num('retention_quotidienne', 3, 60)}</label>
          <label className="flex items-center justify-between gap-3"><span>Sauvegardes hebdomadaires conservées</span>{num('retention_hebdomadaire', 0, 52)}</label>
          <label className="flex items-center justify-between gap-3"><span>Sauvegardes mensuelles conservées</span>{num('retention_mensuelle', 0, 120)}</label>
          <label className="flex items-center justify-between gap-3"><span>Sauvegardes ponctuelles (jours)</span>{num('retention_ponctuelle_jours', 7, 3650)}</label>
        </div>
      </div>
      {can('systeme.configurer') && <button type="button" className="btn-primary mt-4" disabled={!modifie || enCours} onClick={save}><Save size={16} aria-hidden /> {enCours ? 'Enregistrement…' : 'Enregistrer'}</button>}
    </Card>
  );
}


export default function Sauvegardes() {
  const state = useApi('/sauvegardes');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [tab, setTab] = useOnglet('sauvegardes', { valeurs: ['sauvegardes', 'verifications', 'registre', 'planification'] });
  const [busy, setBusy] = useState(null);

  const agir = async (cle, fn, msg) => { setBusy(cle); try { const r = await runAction(fn, msg); state.reload(); return r; } catch { return null; } finally { setBusy(null); } };
  const tester = async (s) => {
    if (!(await confirm({ title: 'Test de restauration', message: 'La sauvegarde sera restaurée dans une base temporaire, contrôlée puis supprimée. Cela peut prendre quelques minutes et occupe temporairement l’espace d’une copie de la base.', confirmLabel: 'Lancer le test' }))) return;
    const r = await agir(`t${s.id}`, () => api.post(`/sauvegardes/${s.id}/tester`));
    if (r) (r.data.statut === 'OK' ? toast.success : toast.error)(r.data.statut === 'OK' ? `Restauration réussie : ${r.data.detail.tables} tables, ${r.data.detail.comptes} comptes, audit intègre.` : `Test échoué : ${r.data.detail.erreur}`);
  };
  const demanderRestauration = async (s) => {
    const motif = await confirm({
      title: 'Demander une restauration', danger: true, confirmLabel: 'Transmettre au Directeur',
      message: `Sauvegarde du ${fmtDateTime(s.created_at)} (${s.fichier}). La base reviendra à l’état de cette date : toutes les données saisies depuis seront perdues (les traces d’audit, de connexion et les alertes seront réintégrées). La demande doit être validée par le Directeur, puis exécutée par vous avec votre double authentification.`,
      input: { label: 'Motif de la restauration', required: true, min: 10, placeholder: 'Incident constaté, données à récupérer…' },
    });
    if (motif) agir(`r${s.id}`, () => api.post(`/sauvegardes/${s.id}/restauration`, { motif }), 'Demande transmise au Directeur.');
  };
  const verifier = async (s) => {
    const r = await agir(`v${s.id}`, () => api.post(`/sauvegardes/${s.id}/verifier`));
    if (r) (r.data.statut === 'OK' ? toast.success : toast.error)(r.data.statut === 'OK' ? `Sauvegarde intègre (${r.data.detail.tables} tables).` : `Sauvegarde inutilisable : ${r.data.detail.erreur}`);
  };
  return (
    <>
      <PageHeader title="Sauvegardes" subtitle="Sauvegardes chiffrées, vérifiées et testées ; restauration soumise à la validation du Directeur." breadcrumb={[{ label: 'Sécurité et système' }, { label: 'Sauvegardes' }]}
        actions={<>
          {can('sauvegarde.restaurer') && <Link to="/restaurations" className="btn-secondary"><History size={16} aria-hidden /> Restaurations</Link>}
          {can('sauvegarde.creer') && <button type="button" className="btn-primary" disabled={!!busy} onClick={() => agir('creer', () => api.post('/sauvegardes'), 'Sauvegarde réalisée et vérifiée.')}><DatabaseBackup size={16} aria-hidden /> {busy === 'creer' ? 'Sauvegarde…' : 'Sauvegarder maintenant'}</button>}
        </>} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Dernière sauvegarde réussie" value={d.etat.derniereReussie ? fmtDateTime(d.etat.derniereReussie.date) : 'aucune'} icon={DatabaseBackup} tone={d.etat.derniereReussie ? 'vert' : 'rouge'} />
              <Stat label="Échecs (30 jours)" value={d.etat.echecs30j} tone={d.etat.echecs30j ? 'rouge' : 'gris'} />
              <Stat label="Dernier test de restauration" value={d.etat.dernierTest ? fmtDateTime(d.etat.dernierTest.date) : 'jamais'} icon={FlaskConical} tone={!d.etat.dernierTest ? 'jaune' : d.etat.dernierTest.statut === 'OK' ? 'vert' : 'rouge'} hint={d.etat.dernierTest ? (d.etat.dernierTest.statut === 'OK' ? 'réussi' : 'ÉCHOUÉ') : null} />
              <Stat label="Sauvegardes conservées" value={d.sauvegardes.length} icon={History} />
            </div>
            {!d.configuration.chiffrement && <InfoAlert tone="warning">Sauvegardes <b>non chiffrées</b> : définissez <code>BACKUP_ENC_KEY</code> dans le fichier <code>.env</code> du serveur et conservez la clé hors ligne (sans elle, les sauvegardes chiffrées sont illisibles).</InfoAlert>}
            {!d.configuration.copie && <InfoAlert tone="warning">Aucune <b>copie hors du serveur</b> : définissez <code>BACKUP_COPY_DIR</code> (disque externe, partage réseau). Une panne du serveur emporterait sinon toutes les sauvegardes.</InfoAlert>}
            <Tabs tabs={[{ value: 'sauvegardes', label: 'Sauvegardes', count: d.sauvegardes.length }, { value: 'verifications', label: 'Vérifications' }, { value: 'registre', label: 'Registre' }, { value: 'planification', label: 'Planification' }]} value={tab} onChange={setTab} />
            {tab === 'sauvegardes' && (
              <DataTable rows={d.sauvegardes} label="Sauvegardes" pageSize={20} empty="Aucune sauvegarde." columns={[
                { key: 'created_at', header: 'Date', className: 'whitespace-nowrap', render: (s) => fmtDateTime(s.created_at) },
                { key: 'origine', header: 'Origine', render: (s) => <span>{ORIGINES[s.origine] || s.origine}{s.palier ? <span className="block text-xs text-slate-500">{PALIERS[s.palier]}</span> : null}</span> },
                { key: 'taille', header: 'Taille', render: (s) => fmtTaille(Number(s.taille_octets)) },
                { key: 'chiffre', header: 'Chiffrée', render: (s) => (s.chiffre ? <Badge className={ok}><Lock size={12} /> Oui</Badge> : <Badge className={att}><LockOpen size={12} /> Non</Badge>) },
                { key: 'copie', header: 'Copie', render: (s) => (s.copie_statut === 'OK' ? <Badge className={ok}>Hors serveur</Badge> : s.copie_statut === 'ECHEC' ? <Badge className={ko} title={s.copie_detail}>Échec</Badge> : <Badge className={att}>Aucune</Badge>) },
                { key: 'verif', header: 'Intégrité', render: (s) => (!s.presente ? <Badge className={ko}>Fichier absent</Badge> : s.verification_statut === 'OK' ? <Badge className={ok}><ShieldCheck size={12} /> {fmtDateTime(s.verifiee_at)}</Badge> : s.verification_statut === 'ECHEC' ? <Badge className={ko}>Altérée</Badge> : <Badge>Non vérifiée</Badge>) },
                { key: 'act', header: '', render: (s) => (
                  <div className="flex flex-wrap justify-end gap-1">
                    <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => verifier(s)}>{busy === `v${s.id}` ? 'Vérification…' : 'Vérifier'}</button>
                    <button type="button" className="btn-ghost btn-sm" disabled={!!busy} onClick={() => tester(s)}>{busy === `t${s.id}` ? 'Test…' : 'Tester'}</button>
                    <IconButton icon={Download} size={15} label={`Télécharger ${s.fichier}`} onClick={() => download(`/sauvegardes/${s.id}/telecharger`, s.fichier).catch((e) => toast.error(errorMessage(e)))} />
                    {can('sauvegarde.restaurer') && <button type="button" className="btn-ghost btn-sm text-red-700" disabled={!!busy} onClick={() => demanderRestauration(s)}>Restaurer…</button>}
                  </div>
                ) },
              ]} />
            )}
            {tab === 'verifications' && (
              <DataTable rows={d.verifications} label="Vérifications" empty="Aucune vérification." columns={[
                { key: 'created_at', header: 'Date', render: (v) => fmtDateTime(v.created_at) },
                { key: 'type', header: 'Type', render: (v) => (v.type === 'RESTAURATION' ? 'Test de restauration' : 'Intégrité') },
                { key: 'statut', header: 'Résultat', render: (v) => <Badge className={v.statut === 'OK' ? ok : ko}>{v.statut === 'OK' ? 'Réussi' : 'Échec'}</Badge> },
                { key: 'fichier', header: 'Sauvegarde', render: (v) => <span className="text-xs">{v.fichier}</span> },
                { key: 'detail', header: 'Détail', render: (v) => <span className="text-xs">{v.detail?.erreur || (v.type === 'RESTAURATION' ? `${v.detail?.tables} tables, ${v.detail?.comptes} comptes, audit ${v.detail?.auditIntegre ? 'intègre' : 'altéré'}` : `${v.detail?.tables} tables lisibles`)}</span> },
                { key: 'origine', header: 'Par', render: (v) => (v.origine === 'AUTO' ? 'automatique' : v.username) },
              ]} />
            )}
            {tab === 'registre' && (
              <DataTable rows={d.historique} label="Registre des sauvegardes" pageSize={25} columns={[
                { key: 'created_at', header: 'Date', render: (h) => fmtDateTime(h.created_at) },
                { key: 'statut', header: 'Résultat', render: (h) => (h.statut === 'REUSSIE' ? <Badge className={ok}>Réussie</Badge> : <Badge className={ko}>Échec</Badge>) },
                { key: 'origine', header: 'Origine', render: (h) => ORIGINES[h.origine] || h.origine },
                { key: 'username', header: 'Par' },
                { key: 'detail', header: 'Détail', render: (h) => <span className="text-xs">{h.statut === 'REUSSIE' ? `${h.fichier} — ${fmtTaille(Number(h.taille_octets))} en ${Math.round(h.duree_ms / 100) / 10} s` : h.erreur}{h.supprimee_at ? <span className="ml-1 inline-flex items-center gap-1 text-slate-500"><Trash2 size={12} aria-hidden /> supprimée le {fmtDateTime(h.supprimee_at)}</span> : null}</span> },
              ]} />
            )}
            {tab === 'planification' && (
              <>
                <Planification p={d.planification} onDone={state.reload} />
                <Card title="Emplacements">
                  <ul className="space-y-1 text-sm"><li>Répertoire : <code>{d.configuration.repertoire}</code></li><li>Copie hors serveur : <code>{d.configuration.copie || 'non définie'}</code></li><li>Chiffrement : {d.configuration.chiffrement ? 'actif (AES-256-GCM)' : 'inactif'}</li></ul>
                  {can('systeme.maintenir') && <button type="button" className="btn-secondary mt-3" onClick={() => agir('ret', () => api.post('/sauvegardes/conservation/appliquer')).then((r) => r && toast.info(r.data.message))}><Trash2 size={16} aria-hidden /> Appliquer la conservation maintenant</button>}
                </Card>
              </>
            )}
          </div>
        )}
      </Loadable>
    </>
  );
}
