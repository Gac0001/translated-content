import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, DataTable, Badge, Modal, InfoAlert, runAction, useConfirm, ErrorAlert } from '../../components/ui';

const STATUTS = {
  EN_ATTENTE: ['En attente du Directeur', 'bg-amber-50 text-amber-800 ring-amber-200'], VALIDEE: ['Validée — à exécuter', 'bg-sky-50 text-sky-800 ring-sky-200'],
  REFUSEE: ['Refusée', 'bg-slate-100 text-slate-700 ring-slate-200'], EXPIREE: ['Expirée', 'bg-slate-100 text-slate-700 ring-slate-200'],
  ANNULEE: ['Annulée', 'bg-slate-100 text-slate-700 ring-slate-200'], EXECUTEE: ['Exécutée', 'bg-emerald-50 text-emerald-800 ring-emerald-200'], ECHEC: ['Échec', 'bg-red-50 text-red-800 ring-red-200'],
};

function Decision({ d, onClose, onDone }) {
  const [motDePasse, setMdp] = useState(''); const [commentaire, setCom] = useState('');
  const decider = async (decision) => { await runAction(() => api.post(`/sauvegardes/restaurations/${d.id}/decision`, { decision, motDePasse, commentaire: commentaire || undefined }), decision === 'VALIDER' ? 'Restauration validée.' : 'Restauration refusée.'); onDone(); };
  return (
    <Modal open title="Décision sur la demande de restauration" onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
      <button type="button" className="btn-secondary" disabled={!motDePasse} onClick={() => decider('REFUSER')}><XCircle size={16} /> Refuser</button>
      <button type="button" className="btn-danger" disabled={!motDePasse} onClick={() => decider('VALIDER')}><CheckCircle2 size={16} /> Valider la restauration</button>
    </>}>
      <div className="space-y-3 text-sm">
        <p>L’Admin Système <b>{d.demande_par_username}</b> demande de ramener la base de données à son état du <b>{fmtDateTime(d.sauvegarde_date)}</b>.</p>
        <p className="rounded-md bg-slate-50 p-2"><b>Motif :</b> {d.motif}</p>
        <InfoAlert tone="warning">Toutes les données saisies depuis cette date (courriers, documents, présences, comptes…) seront perdues. Les traces d’audit, de connexion et les alertes seront conservées. Après votre validation, l’Admin dispose de 24 heures pour exécuter la restauration.</InfoAlert>
        <div><label className="label" htmlFor="com">Commentaire</label><textarea id="com" className="input" rows={2} value={commentaire} onChange={(e) => setCom(e.target.value)} /></div>
        <div><label className="label" htmlFor="mdp">Votre mot de passe (confirmation) <span className="text-red-600">*</span></label><input id="mdp" type="password" className="input" autoComplete="current-password" value={motDePasse} onChange={(e) => setMdp(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function Execution({ d, phrase, onClose }) {
  const [f, setF] = useState({ confirmation: '', motDePasse: '', code: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const executer = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/sauvegardes/restaurations/${d.id}/executer`, f);
      clear();
      navigate('/connexion', { replace: true, state: { message: 'La base a été restaurée et toutes les sessions ont été fermées. Reconnectez-vous.' } });
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open title="Exécuter la restauration" onClose={busy ? undefined : onClose} footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Annuler</button><button type="button" className="btn-danger" disabled={busy || f.confirmation.trim().toUpperCase() !== phrase || !f.motDePasse || f.code.length < 6} onClick={executer}>{busy ? 'Restauration en cours…' : 'Restaurer la base'}</button></>}>
      <div className="space-y-3 text-sm">
        <ErrorAlert message={error} />
        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div>
          La base va revenir à son état du <b>{fmtDateTime(d.sauvegarde_date)}</b>. Déroulement automatique : sauvegarde de l’état actuel, mode maintenance, restauration, réintégration des traces d’audit, fermeture de toutes les sessions. En cas d’échec, la base est remise dans son état actuel.
        </div></div>
        <div><label className="label" htmlFor="c">Saisissez {phrase}</label><input id="c" className="input font-mono" autoComplete="off" value={f.confirmation} onChange={up('confirmation')} /></div>
        <div><label className="label" htmlFor="m">Votre mot de passe</label><input id="m" type="password" className="input" autoComplete="current-password" value={f.motDePasse} onChange={up('motDePasse')} /></div>
        <div><label className="label" htmlFor="k">Code de double authentification</label><input id="k" className="input font-mono" autoComplete="one-time-code" value={f.code} onChange={up('code')} /></div>
      </div>
    </Modal>
  );
}

export default function Restaurations() {
  const state = useApi('/sauvegardes/restaurations');
  const confirm = useConfirm();
  const [decision, setDecision] = useState(null);
  const [execution, setExecution] = useState(null);
  const annuler = async (d) => {
    if (!(await confirm({ title: 'Annuler la demande', message: d.fichier, confirmLabel: 'Annuler la demande', danger: true }))) return;
    await runAction(() => api.post(`/sauvegardes/restaurations/${d.id}/annuler`), 'Demande annulée.'); state.reload();
  };
  return (
    <>
      <PageHeader title="Restaurations" subtitle="Demande de l’Admin Système, validation du Directeur, exécution sous double authentification." breadcrumb={[{ label: 'Restaurations' }]} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            {d.actions.decider && d.data.some((x) => x.statut === 'EN_ATTENTE') && <InfoAlert tone="warning">Une demande de restauration attend votre décision.</InfoAlert>}
            <DataTable rows={d.data} empty="Aucune demande de restauration." columns={[
              { key: 'demande_at', header: 'Demandée le', render: (r) => <span className="text-xs">{fmtDateTime(r.demande_at)}<span className="block text-slate-500">par {r.demande_par_username}</span></span> },
              { key: 'sauvegarde_date', header: 'État restauré', render: (r) => fmtDateTime(r.sauvegarde_date) },
              { key: 'motif', header: 'Motif', render: (r) => <span className="text-xs">{r.motif}</span> },
              { key: 'statut', header: 'Statut', render: (r) => <span><Badge className={STATUTS[r.statut][1]}>{STATUTS[r.statut][0]}</Badge>{r.decide_par_username && <span className="block text-xs text-slate-500">{r.statut === 'REFUSEE' ? 'refusée' : 'décidée'} par {r.decide_par_username}{r.decision_commentaire ? ` : ${r.decision_commentaire}` : ''}</span>}{['EN_ATTENTE', 'VALIDEE'].includes(r.statut) && <span className="block text-xs text-slate-500">expire le {fmtDateTime(r.expire_at)}</span>}</span> },
              { key: 'act', header: '', render: (r) => (
                <div className="flex flex-wrap justify-end gap-1">
                  {d.actions.decider && r.statut === 'EN_ATTENTE' && <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => setDecision(r)}>Décider</button>}
                  {d.actions.demander && r.statut === 'VALIDEE' && <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => setExecution(r)}>Exécuter</button>}
                  {d.actions.demander && ['EN_ATTENTE', 'VALIDEE'].includes(r.statut) && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => annuler(r)}>Annuler</button>}
                </div>
              ) },
            ]} />
          </div>
        )}
      </Loadable>
      {decision && <Decision d={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); state.reload(); }} />}
      {execution && <Execution d={execution} phrase={state.data.phrase} onClose={() => setExecution(null)} />}
    </>
  );
}
