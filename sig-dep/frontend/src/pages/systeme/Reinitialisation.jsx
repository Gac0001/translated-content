import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, DatabaseZap, FlaskConical, ShieldCheck, UserPlus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, InfoAlert, Field, runAction, KeyValues, runCritique } from '../../components/ui';

const PHRASE = 'REINITIALISER';

const MODES = [
  {
    value: 'VIERGE', icon: DatabaseZap, titre: 'Base vierge — mise en service',
    texte: 'Supprime toutes les données fictives : agents, comptes, instructions, tâches, courriers, documents, PIP, présences, pièces jointes et journaux. L’organigramme, les grades, les fonctions, les rôles, les paramètres et votre compte Admin sont conservés. Le Directeur pourra ensuite importer et valider la liste officielle des agents.',
  },
  {
    value: 'DEMO', icon: FlaskConical, titre: 'Données fictives — formation',
    texte: 'Même nettoyage, puis rechargement des données fictives de démonstration (comptes de test, mot de passe Demo@2026). À utiliser pour une formation ou une démonstration, jamais en exploitation.',
  },
];

/** Réinitialisation de la base par l’Admin (mise en service ou retour aux données de démonstration). */
export default function Reinitialisation() {
  const state = useApi('/systeme/reinitialisation');
  const [mode, setMode] = useState('VIERGE');
  const [phrase, setPhrase] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [sauvegarde, setSauvegarde] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState(null);

  const lancer = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await runCritique(() => api.post('/systeme/reinitialisation', { mode, confirmation: phrase, motDePasse, sauvegarde }), 'Base réinitialisée.');
      if (r) { setResultat(r.data); state.reload(); }
      setPhrase(''); setMotDePasse('');
    } catch { /* message affiché */ } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Réinitialisation de la base" subtitle="Préparer la mise en service : retirer les données fictives avant la constitution de la liste officielle des agents."
        breadcrumb={[{ label: 'Administration' }, { label: 'Système', to: '/systeme' }, { label: 'Réinitialisation' }]} />
      {resultat && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-medium"><CheckCircle2 size={18} /> {resultat.message}</div>
          {resultat.sauvegarde && <p className="mt-1">Sauvegarde préalable : <code>{resultat.sauvegarde.fichier}</code> (Système → Sauvegardes).</p>}
          {resultat.mode === 'VIERGE' && (
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Créez le compte du Directeur : <Link to="/comptes/nouveau" className="font-medium underline">Compte institutionnel</Link>.</li>
              <li>Le Directeur importe la liste officielle des agents (Personnel → Importer une liste), la vérifie puis la valide.</li>
              <li>Vous enrôlez ensuite les agents du Bureau Secrétariat de Direction, qui enrôlent les agents des Divisions.</li>
            </ol>
          )}
          {resultat.mode === 'VIERGE' && <Link to="/comptes/nouveau" className="btn-primary mt-3"><UserPlus size={16} /> Créer le compte du Directeur</Link>}
        </div>
      )}
      <Loadable state={state}>
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Contenu actuel">
              {d.donneesDemo
                ? <InfoAlert tone="warning">La base contient des <b>données fictives</b> de démonstration.</InfoAlert>
                : <InfoAlert>La base ne contient pas de données fictives.</InfoAlert>}
              <div className="mt-3">
                <KeyValues cols={2} items={[
                  ['Agents', d.volumes.agents], ['Comptes', d.volumes.comptes], ['Instructions', d.volumes.instructions], ['Tâches', d.volumes.taches],
                  ['Courriers', d.volumes.courriers], ['Documents', d.volumes.documents], ['Fiches PIP', d.volumes.pip], ['Listes de présence', d.volumes.presences],
                  ['Pièces jointes', d.volumes.pieces], ['Entrées d’audit', d.volumes.audit],
                ]} />
              </div>
              <div className="mt-4 text-sm">
                <div className="mb-1 font-medium text-slate-700">Toujours conservés</div>
                <ul className="list-disc space-y-0.5 pl-5 text-slate-600">{d.conservees.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            </Card>

            <form onSubmit={lancer} className="space-y-4 lg:col-span-2">
              <Card title="Type de réinitialisation">
                <div className="grid gap-3 md:grid-cols-2" role="radiogroup">
                  {MODES.map((m) => (
                    <label key={m.value} className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm ${mode === m.value ? 'border-dep-600 bg-dep-50 ring-1 ring-dep-600' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-1" />
                      <span>
                        <span className="flex items-center gap-1.5 font-medium"><m.icon size={16} /> {m.titre}</span>
                        <span className="mt-1 block text-slate-600">{m.texte}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Card>

              <Card title="Confirmation">
                <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <span>Opération <b>irréversible</b> depuis l’application : toutes les données autres que celles conservées sont supprimées et les autres utilisateurs sont déconnectés. Seule une sauvegarde permet de revenir en arrière.</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-start gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" checked={sauvegarde} onChange={(e) => setSauvegarde(e.target.checked)} className="mt-0.5" />
                    <span>Faire d’abord une <b>sauvegarde</b> de la base (recommandé). Si elle échoue, rien n’est supprimé.</span>
                  </label>
                  <Field label={`Saisissez ${PHRASE} pour confirmer`} required>
                    <input className="input font-mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
                  </Field>
                  <Field label="Votre mot de passe Admin" required>
                    <input type="password" className="input" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="current-password" />
                  </Field>
                </div>
                <button className="btn-danger mt-4" disabled={busy || phrase.trim().toUpperCase() !== PHRASE || !motDePasse}>
                  <ShieldCheck size={16} /> {busy ? 'Réinitialisation…' : mode === 'VIERGE' ? 'Réinitialiser : base vierge' : 'Réinitialiser avec les données fictives'}
                </button>
              </Card>
            </form>
          </div>
        )}
      </Loadable>
    </>
  );
}
