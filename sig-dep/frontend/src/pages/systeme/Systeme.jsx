import { useState } from 'react';
import { DatabaseBackup, Download, Save } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, runAction, toast, DataTable, InfoAlert } from '../../components/ui';
import { fmtDateTime, fmtTaille } from '../../lib/format';

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
                <input className="input" disabled={p.cle === 'direction_nom'} value={edits[p.cle] ?? p.valeur ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [p.cle]: e.target.value }))} />
                <button type="button" className="btn-secondary" disabled={edits[p.cle] === undefined || edits[p.cle] === p.valeur} onClick={() => save(p.cle)}><Save size={16} /></button>
              </div>
            ))}
            <p className="text-xs text-slate-500">L’appellation officielle « Direction d’Études et Planification » n’est pas modifiable.</p>
          </div>
        )}
      </Loadable>
    </Card>
  );
}

function Sauvegardes() {
  const state = useApi('/systeme/sauvegardes');
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await runAction(() => api.post('/systeme/sauvegardes'), 'Sauvegarde réalisée.'); state.reload(); } catch { /* affiché */ } finally { setBusy(false); } };
  return (
    <Card title="Sauvegardes PostgreSQL" actions={<button type="button" className="btn-primary" disabled={busy} onClick={run}><DatabaseBackup size={16} /> {busy ? 'Sauvegarde…' : 'Lancer une sauvegarde'}</button>}>
      <InfoAlert>Sauvegardes au format pg_dump (personnalisé). Restauration : <code>pg_restore --clean --if-exists -d &lt;base&gt; fichier.dump</code>. Conservez une copie hors du serveur.</InfoAlert>
      <Loadable state={state}>
        {(d) => (
          <div className="mt-3">
            <DataTable searchable={false} rowKey="fichier" rows={d.data} empty="Aucune sauvegarde." columns={[
              { key: 'fichier', header: 'Fichier' }, { key: 'date', header: 'Date', render: (b) => fmtDateTime(b.date) }, { key: 'taille', header: 'Taille', render: (b) => fmtTaille(b.tailleOctets) },
              { key: 'dl', header: '', render: (b) => <button type="button" className="btn-ghost px-2" onClick={() => download(`/systeme/sauvegardes/${b.fichier}`, b.fichier).catch((e) => toast.error(errorMessage(e)))} aria-label="Télécharger"><Download size={16} /></button> },
            ]} />
            <p className="mt-2 text-xs text-slate-500">Répertoire : {d.repertoire}</p>
          </div>
        )}
      </Loadable>
    </Card>
  );
}

export default function Systeme() {
  const can = useAuth((s) => s.can);
  const etat = useApi(can('systeme.etat') ? '/systeme/etat' : null);
  return (
    <>
      <PageHeader title="Système" subtitle="État technique, paramètres et sauvegardes." breadcrumb={[{ label: 'Administration' }, { label: 'Système' }]} />
      <div className="space-y-4">
        {can('systeme.etat') && (
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
        {can('systeme.parametres') && <Parametres />}
        {can('systeme.sauvegardes') && <Sauvegardes />}
      </div>
    </>
  );
}
