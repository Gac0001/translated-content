import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, CheckCircle2, FilePlus2, Gauge, Link2, ListTree, Lock, MessageSquareReply, Undo2, X } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, PrioriteBadge, Progress, runAction, InfoAlert, Modal, Field } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { AvancementModal, TextModal } from '../instructions/WorkflowActions';
import { BoutonsTraitement, ModalesTraitement, AlertesTraitement, CarteProlongations } from '../instructions/Traitement';

const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'RAPPORT_INTERMEDIAIRE', 'A_CORRIGER', 'EN_RETARD'];
const TERMINES = ['VALIDEE', 'CLOTUREE', 'ANNULEE'];

/** Ajout d’une dépendance : une des tâches attribuées par le même Chef de Bureau. */
function DependanceModal({ tache, onClose, onSave }) {
  const user = useAuth((s) => s.user);
  const liste = useApi('/taches');
  const [choix, setChoix] = useState('');
  const deja = new Set([tache.id, ...tache.dependances.map((d) => d.id), ...tache.sousTaches.map((s) => s.id)]);
  const options = (liste.data?.data || []).filter((t) => t.assigne_par_user_id === user.id && !deja.has(t.id) && !TERMINES.includes(t.statut));
  return (
    <Modal open title="Ajouter une dépendance" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!choix} onClick={() => onSave(Number(choix))}>Ajouter</button></>}>
      <Field label="Cette tâche ne pourra avancer qu’après l’exécution de :" required>
        <select className="input" value={choix} onChange={(e) => setChoix(e.target.value)}>
          <option value="">— Choisir —</option>
          {options.map((t) => <option key={t.id} value={t.id}>{t.reference} — {t.titre} ({t.agent_nom})</option>)}
        </select>
      </Field>
    </Modal>
  );
}

export default function TacheDetail() {
  const { id } = useParams();
  const state = useApi(`/taches/${id}`);
  const can = useAuth((s) => s.can);
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/taches/${id}/${path}`, body), msg); setModal(null); state.reload(); };
  const retirerDependance = async (dep) => { await runAction(() => api.delete(`/taches/${id}/dependances/${dep}`), 'Dépendance retirée.'); state.reload(); };
  return (
    <Loadable state={state}>
      {(t) => {
        const { estAgent, estChef } = t.actions;
        return (
          <>
            <PageHeader title={t.titre} subtitle={`${t.reference} · ${t.bureau_nom}`} breadcrumb={[{ label: 'Tâches', to: '/taches' }, { label: t.reference }]}
              actions={<>
                {estAgent && t.statut === 'TRANSMISE' && <button type="button" className="btn-success" onClick={() => post('accuser-reception', {}, 'Réception confirmée.')}><CheckCheck size={16} /> Accuser réception</button>}
                {estAgent && ACTIVE.includes(t.statut) && <>
                  {t.actions.avancer && <button type="button" className="btn-secondary" onClick={() => setModal('avancement')}><Gauge size={16} /> Avancement</button>}
                  {t.actions.avancer && <button type="button" className="btn-primary" onClick={() => setModal('cr')}><MessageSquareReply size={16} /> Rendre compte</button>}
                  {can('documents.rediger') && <Link className="btn-secondary" to={`/documents/nouveau?tache=${id}`}><FilePlus2 size={16} /> Rédiger un document</Link>}
                </>}
                {estChef && t.statut === 'EXECUTEE' && <>
                  <button type="button" className="btn-success" onClick={() => post('valider', {}, 'Tâche validée.')}><CheckCircle2 size={16} /> Valider</button>
                  <button type="button" className="btn-secondary" onClick={() => setModal('retour')}><Undo2 size={16} /> Retourner</button>
                </>}
                {estChef && t.statut === 'VALIDEE' && <button type="button" className="btn-primary" onClick={() => post('cloturer', {}, 'Tâche clôturée.')}><Lock size={16} /> Clôturer</button>}
                {t.actions.sousTache && <Link className="btn-secondary" to={`/taches/nouvelle?parent=${id}`}><ListTree size={16} /> Sous-tâche</Link>}
                <BoutonsTraitement a={t.actions} setModal={setModal} />
              </>} />
            {estAgent && t.statut === 'A_CORRIGER' && <div className="mb-3"><InfoAlert tone="warning">Retour du Chef de Bureau : {t.observations}</InfoAlert></div>}
            {t.bloquantes.length > 0 && !TERMINES.includes(t.statut) && <div className="mb-3"><InfoAlert tone="warning">Cette tâche attend l’exécution de : {t.bloquantes.map((b) => b.reference).join(', ')}. L’avancement et le compte rendu seront possibles ensuite.</InfoAlert></div>}
            <AlertesTraitement item={t} />
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Tâche" className="lg:col-span-2">
                <KeyValues items={[
                  ['Agent', t.agent_nom], ['Attribuée par', t.chef_nom], ['Priorité', <PrioriteBadge key="p" value={t.priorite} />], ['Statut', <StatusBadge key="s" value={t.statut} />],
                  ['Début', fmtDate(t.date_debut)], ['Échéance', fmtDate(t.echeance)], t.echeance_initiale && ['Échéance initiale', fmtDate(t.echeance_initiale)],
                  t.parent && ['Tâche parente', <Link key="pa" className="text-dep-700 hover:underline" to={`/taches/${t.parent.id}`}>{t.parent.reference} — {t.parent.titre}</Link>], ['Avancement', <Progress key="a" value={t.avancement} />], ['Clôturée le', fmtDateTime(t.date_cloture)],
                  t.instruction_id && ['Instruction liée', <Link key="i" className="text-dep-700 hover:underline" to={`/instructions/${t.instruction_id}`}>{t.instruction_reference}</Link>],
                ]} />
                {t.description && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Description</div><p className="mt-1 whitespace-pre-line text-sm">{t.description}</p></div>}
                {t.observations && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Observations</div><p className="mt-1 whitespace-pre-line text-sm">{t.observations}</p></div>}
              </Card>
              <Card title="Rapport d’exécution">{t.rapport_execution ? <p className="whitespace-pre-line text-sm">{t.rapport_execution}</p> : <p className="text-sm text-slate-500">Aucun rapport pour l’instant.</p>}</Card>
              <Card title="Pièces jointes et preuves d’exécution" className="lg:col-span-1"><Attachments type="TASK" id={id} preuve={estAgent} canUpload={(estAgent || estChef) && !['CLOTUREE', 'ANNULEE'].includes(t.statut)} /></Card>
              {(t.sousTaches.length > 0 || t.dependances.length > 0 || t.actions.dependances) && (
                <Card title="Sous-tâches et dépendances" className="lg:col-span-2">
                  {t.sousTaches.length > 0 && <>
                    <div className="text-xs font-medium uppercase text-slate-500">Sous-tâches</div>
                    <ul className="mb-3 mt-1 space-y-1 text-sm">{t.sousTaches.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2"><Link to={`/taches/${s.id}`} className="text-dep-700 hover:underline">{s.reference} — {s.titre}</Link><span className="text-xs text-slate-500">→ {s.agent_nom}</span><StatusBadge value={s.statut} /></li>)}</ul>
                  </>}
                  <div className="text-xs font-medium uppercase text-slate-500">Dépend de</div>
                  {t.dependances.length ? (
                    <ul className="mt-1 space-y-1 text-sm">{t.dependances.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2">
                        <Link to={`/taches/${d.id}`} className="text-dep-700 hover:underline">{d.reference} — {d.titre}</Link><StatusBadge value={d.statut} />
                        {t.actions.dependances && <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50" aria-label="Retirer la dépendance" onClick={() => retirerDependance(d.id)}><X size={14} /></button>}
                      </li>
                    ))}</ul>
                  ) : <p className="mt-1 text-sm text-slate-500">Aucune dépendance.</p>}
                  {t.actions.dependances && <button type="button" className="btn-secondary mt-3" onClick={() => setModal('dependance')}><Link2 size={16} /> Ajouter une dépendance</button>}
                </Card>
              )}
              <CarteProlongations items={t.prolongations} echeanceInitiale={t.echeance_initiale} />
              <Card title="Historique" className="lg:col-span-2"><Timeline items={t.historique} /></Card>
            </div>
            {modal === 'avancement' && <AvancementModal current={t.avancement} onClose={() => setModal(null)} onSave={(b) => post('avancement', b, 'Avancement mis à jour.')} />}
            {modal === 'cr' && <TextModal title="Rendre compte au Chef de Bureau" label="Rapport d’exécution" confirmLabel="Transmettre" onClose={() => setModal(null)} onSave={(x) => post('rendre-compte', { rapport_execution: x }, 'Compte rendu transmis.')} />}
            <ModalesTraitement modal={modal} setModal={setModal} post={post} item={t} />
            {modal === 'dependance' && <DependanceModal tache={t} onClose={() => setModal(null)} onSave={(dep) => post('dependances', { depend_de_task_id: dep }, 'Dépendance ajoutée.')} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Observations" danger confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(x) => post('retourner', { observations: x }, 'Tâche retournée.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
