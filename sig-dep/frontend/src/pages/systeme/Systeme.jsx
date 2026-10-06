import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseBackup, DatabaseZap, Mail, PlugZap, RotateCcw, Save, Send } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, runAction, toast, DataTable, InfoAlert, Badge, Field } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { COLORS } from '../../lib/labels';

function Parametres() {
  const state = useApi('/systeme/parametres');
  const [edits, setEdits] = useState({});
  const save = async (cle) => { await runAction(() => api.put(`/systeme/parametres/${cle}`, { valeur: edits[cle] }), 'Paramètre enregistré.'); state.reload(); };
  return (
    <Card title="Paramètres généraux">
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-3">
            {d.data.map((p) => (
              <div key={p.cle} className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <div className="text-sm"><div className="font-medium">{p.libelle}</div><code className="text-xs text-slate-500">{p.cle}</code></div>
                <input className="input" aria-label={p.libelle} disabled={p.cle === 'direction_nom'} value={edits[p.cle] ?? p.valeur ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [p.cle]: e.target.value }))} />
                <button type="button" className="btn-secondary" disabled={edits[p.cle] === undefined || edits[p.cle] === p.valeur} onClick={() => save(p.cle)} aria-label={`Enregistrer : ${p.libelle}`} title="Enregistrer"><Save size={16} aria-hidden /></button>
              </div>
            ))}
            <p className="text-xs text-slate-500">L’appellation officielle « Direction d’Études et Planification » n’est pas modifiable.</p>
          </div>
        )}
      </Loadable>
    </Card>
  );
}


const ETATS_MAIL = { EN_ATTENTE: ['En attente', COLORS.attention], ENVOYE: ['Envoyé', COLORS.succes], ECHEC: ['Échec', COLORS.danger], ANNULE: ['Annulé', COLORS.neutre] };

function Messagerie() {
  const state = useApi('/systeme/messagerie');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(null);
  const run = async (key, fn, msg) => {
    setBusy(key);
    try { const r = await runAction(fn, msg); state.reload(); return r; } catch { return null; } finally { setBusy(null); }
  };
  const verifier = async () => {
    const r = await run('verif', () => api.post('/systeme/messagerie/verifier'));
    if (r) (r.data.ok ? toast.success : toast.error)(r.data.message);
  };
  return (
    <Card title="Messagerie (notifications par e-mail)" actions={<>
      <button type="button" className="btn-secondary" disabled={!!busy} onClick={verifier}><PlugZap size={16} /> Tester la connexion</button>
      <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => run('traiter', () => api.post('/systeme/messagerie/traiter'), 'File d’envoi traitée.')}><Send size={16} /> Envoyer la file maintenant</button>
    </>}>
      <Loadable state={state}>
        {(m) => (
          <div className="space-y-4">
            {!m.configuration.active && <InfoAlert tone="warning">La messagerie est désactivée. Renseignez le serveur SMTP dans <code>backend/.env</code> (variables <code>SMTP_*</code>, <code>MAIL_FROM</code>, <code>APP_URL</code>) puis <code>MAIL_ENABLED=true</code>, et redémarrez l’API.</InfoAlert>}
            <div className="grid gap-4 lg:grid-cols-2">
              <KeyValues items={[
                ['État', m.configuration.active ? <Badge key="a" tone="succes">Activée</Badge> : <Badge key="a">Désactivée</Badge>],
                ['Transport', m.configuration.transport], ['Serveur', m.configuration.serveur], ['Sécurité', m.configuration.securite],
                ['Authentification', m.configuration.authentification ? 'Oui' : 'Non'], ['Expéditeur', m.configuration.expediteur],
                ['Liens vers', m.configuration.adresseApplication], ['Tentatives maximales', m.configuration.tentativesMax],
              ]} />
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {[['EN_ATTENTE', 'En attente'], ['ENVOYE', 'Envoyés'], ['ECHEC', 'Échecs'], ['ANNULE', 'Annulés']].map(([k, l]) => (
                    <div key={k} className="rounded-md bg-slate-50 p-2"><div className="text-lg font-semibold tabular-nums">{m.file[k] || 0}</div><div className="text-xs text-slate-600">{l}</div></div>
                  ))}
                </div>
                <p className="text-sm text-slate-600">Envoyés sur les dernières 24 h : <b>{m.envoyes24h}</b>. Comptes actifs sans adresse électronique : <b>{m.comptesSansAdresse}</b>.</p>
                {(m.file.ECHEC || 0) > 0 && <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => run('relancer', () => api.post('/systeme/messagerie/relancer'), 'E-mails en échec remis en file.')}><RotateCcw size={16} /> Relancer les échecs</button>}
                <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end">
                  <Field label="Envoyer un e-mail de test à" className="flex-1"><input type="email" className="input" placeholder="adresse@exemple.cd" value={dest} onChange={(e) => setDest(e.target.value)} /></Field>
                  <button type="button" className="btn-primary" disabled={!dest || !!busy || !m.configuration.active} onClick={() => run('test', () => api.post('/systeme/messagerie/test', { destinataire: dest }), `E-mail de test envoyé à ${dest}.`)}><Mail size={16} /> Envoyer</button>
                </div>
              </div>
            </div>
            <DataTable searchable={false} pageSize={10} rows={m.recents} empty="Aucun e-mail." columns={[
              { key: 'created_at', header: 'Créé le', render: (r) => fmtDateTime(r.created_at) },
              { key: 'to_email', header: 'Destinataire' },
              { key: 'subject', header: 'Sujet', render: (r) => <span className="text-xs">{r.subject}</span> },
              { key: 'statut', header: 'État', render: (r) => <Badge className={ETATS_MAIL[r.statut][1]}>{ETATS_MAIL[r.statut][0]}</Badge> },
              { key: 'tentatives', header: 'Tentatives' },
              { key: 'derniere_erreur', header: 'Dernière erreur / envoi', render: (r) => (r.statut === 'ENVOYE' ? <span className="text-xs">{fmtDateTime(r.sent_at)}</span> : <span className="text-xs text-red-700">{r.derniere_erreur}</span>) },
            ]} />
          </div>
        )}
      </Loadable>
    </Card>
  );
}

export default function Systeme() {
  const can = useAuth((s) => s.can);
  const etat = useApi(can('systeme.consulter') ? '/systeme/etat' : null);
  return (
    <>
      <PageHeader title="Système" subtitle="État technique, paramètres, messagerie et sauvegardes." breadcrumb={[{ label: 'Administration' }, { label: 'Système' }]}
        actions={can('systeme.maintenir') && <Link to="/systeme/reinitialisation" className="btn-secondary"><DatabaseZap size={16} /> Réinitialisation de la base</Link>} />
      <div className="space-y-4">
        {can('systeme.consulter') && (
          <Loadable state={etat}>
            {(e) => (
              <div className="grid gap-4 md:grid-cols-3">
                <Card title="API"><KeyValues cols={1} items={[['Statut', e.api.statut], ['Environnement', e.api.environnement], ['Node.js', e.api.node], ['Disponibilité', `${Math.round(e.api.uptimeSecondes / 60)} min`], ['Mémoire', `${e.api.memoireMo} Mo`]]} /></Card>
                <Card title="Base de données"><KeyValues cols={1} items={[['Statut', e.baseDeDonnees.statut], ['Version', e.baseDeDonnees.version], ['Taille', e.baseDeDonnees.taille], ['Latence', `${e.baseDeDonnees.latenceMs} ms`], ['Migrations', e.baseDeDonnees.migrations.length]]} /></Card>
                <Card title="Volumes"><KeyValues cols={1} items={[['Comptes', e.volumes.comptes], ['Agents', e.volumes.agents], ['Entrées d’audit', e.volumes.audit], ['Pièces jointes', `${e.stockage.piecesJointes} (${e.stockage.volumeMo} Mo)`], ['Sauvegardes', e.stockage.sauvegardes]]} /></Card>
              </div>
            )}
          </Loadable>
        )}
        {can('systeme.configurer') && <Parametres />}
        {can('systeme.configurer') && <Messagerie />}
        {can('sauvegarde.creer') && (
          <Card title="Sauvegardes et maintenance">
            <p className="text-sm text-slate-600">Les sauvegardes (programmation, chiffrement, vérification, tests de restauration), les restaurations et la maintenance ont leurs propres pages.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/systeme/sauvegardes" className="btn-secondary"><DatabaseBackup size={16} /> Sauvegardes</Link>
              <Link to="/restaurations" className="btn-secondary">Restaurations</Link>
              {can('systeme.maintenir') && <Link to="/systeme/maintenance" className="btn-secondary">Maintenance</Link>}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
