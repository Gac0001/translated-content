import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, CheckCircle2, FilePlus2, Gauge, Link2, ListTree, Lock, MessageSquareReply, Undo2, X } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, PrioriteBadge, Progress, runAction, InfoAlert, Modal, Field, Button, IconButton, WorkflowPanel, DetailLayout } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime, isOverdue } from '../../lib/format';
import { circuitTache } from '../../lib/workflows';
import { AvancementModal, TextModal } from '../instructions/WorkflowActions';
import { boutonsTraitement, ModalesTraitement, AlertesTraitement, CarteProlongations } from '../instructions/Traitement';

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

function attente(t) {
  if (t.statut === 'CLOTUREE') return 'Circuit terminé : la tâche est clôturée.';
  if (t.statut === 'ANNULEE') return 'Tâche annulée par le Chef de Bureau.';
  if (t.statut === 'BLOQUEE') return `Traitement suspendu : blocage signalé par ${t.agent_nom}.`;
  if (ACTIVE.includes(t.statut)) return `Exécution en attente de ${t.agent_nom}.`;
  return `Validation en attente de ${t.chef_nom} (Chef de Bureau).`;
}

/** Le panneau n’affiche un message que s’il y a quelque chose à signaler. */
const aAlertes = (t, estAgent) => (t.bloquantes.length > 0 && !TERMINES.includes(t.statut)) || ['BLOQUEE', 'ANNULEE'].includes(t.statut)
  || (t.prolongations || []).some((p) => p.statut === 'DEMANDEE') || (estAgent && t.statut === 'A_CORRIGER');

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
        const actif = ACTIVE.includes(t.statut);
        return (
          <>
            <PageHeader title={t.titre} subtitle={`${t.reference} · ${t.bureau_nom}`} breadcrumb={[{ label: 'Tâches', to: '/taches' }, { label: t.reference }]}
              actions={<>
                {estAgent && actif && can('documents.rediger') && <Link className="btn-secondary" to={`/documents/nouveau?tache=${id}`}><FilePlus2 size={16} aria-hidden /> Rédiger un document</Link>}
                {t.actions.sousTache && <Link className="btn-secondary" to={`/taches/nouvelle?parent=${id}`}><ListTree size={16} aria-hidden /> Sous-tâche</Link>}
              </>} />
            <WorkflowPanel circuit={circuitTache(t)} attente={attente(t)}
              message={aAlertes(t, estAgent) && (
                <div className="space-y-2">
                  {t.bloquantes.length > 0 && !TERMINES.includes(t.statut) && <InfoAlert tone="warning">Cette tâche attend l’exécution de : {t.bloquantes.map((b) => b.reference).join(', ')}. L’avancement et le compte rendu seront possibles ensuite.</InfoAlert>}
                  <AlertesTraitement item={t} className="" />
                  {estAgent && t.statut === 'A_CORRIGER' && <InfoAlert tone="warning">Retour du Chef de Bureau : {t.observations}</InfoAlert>}
                </div>
              )}
              actions={[
                estAgent && t.statut === 'TRANSMISE' && <Button key="ar" variant="success" icon={CheckCheck} onClick={() => post('accuser-reception', {}, 'Réception confirmée.')}>Accuser réception</Button>,
                estAgent && actif && t.actions.avancer && <Button key="av" icon={Gauge} onClick={() => setModal('avancement')}>Avancement</Button>,
                estAgent && actif && t.actions.avancer && <Button key="cr" variant="primary" icon={MessageSquareReply} onClick={() => setModal('cr')}>Rendre compte</Button>,
                estChef && t.statut === 'EXECUTEE' && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => post('valider', {}, 'Tâche validée.')}>Valider</Button>,
                estChef && t.statut === 'EXECUTEE' && <Button key="re" icon={Undo2} onClick={() => setModal('retour')}>Retourner</Button>,
                estChef && t.statut === 'VALIDEE' && <Button key="cl" variant="primary" icon={Lock} onClick={() => post('cloturer', {}, 'Tâche clôturée.')}>Clôturer</Button>,
                ...boutonsTraitement(t.actions, setModal),
              ]} />
            <DetailLayout
              main={<>
                <Card title="Tâche">
                  {t.description ? <p className="whitespace-pre-line text-sm">{t.description}</p> : <p className="text-sm text-slate-500">Aucune description.</p>}
                  {t.observations && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Observations</div><p className="mt-1 whitespace-pre-line text-sm">{t.observations}</p></div>}
                </Card>
                <Card title="Rapport d’exécution">{t.rapport_execution ? <p className="whitespace-pre-line text-sm">{t.rapport_execution}</p> : <p className="text-sm text-slate-500">Aucun rapport pour l’instant.</p>}</Card>
                {(t.sousTaches.length > 0 || t.dependances.length > 0 || t.actions.dependances) && (
                  <Card title="Sous-tâches et dépendances">
                    {t.sousTaches.length > 0 && <>
                      <h3 className="text-xs font-medium uppercase text-slate-500">Sous-tâches</h3>
                      <ul className="mb-3 mt-1 space-y-1 text-sm">{t.sousTaches.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2"><Link to={`/taches/${s.id}`} className="link">{s.reference} — {s.titre}</Link><span className="text-xs text-slate-500">→ {s.agent_nom}</span><StatusBadge value={s.statut} /></li>)}</ul>
                    </>}
                    <h3 className="text-xs font-medium uppercase text-slate-500">Dépend de</h3>
                    {t.dependances.length ? (
                      <ul className="mt-1 space-y-1 text-sm">{t.dependances.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <Link to={`/taches/${d.id}`} className="link">{d.reference} — {d.titre}</Link><StatusBadge value={d.statut} />
                          {t.actions.dependances && <IconButton label={`Retirer la dépendance ${d.reference}`} icon={X} size={14} className="p-1 text-red-600 hover:bg-red-50" onClick={() => retirerDependance(d.id)} />}
                        </li>
                      ))}</ul>
                    ) : <p className="mt-1 text-sm text-slate-500">Aucune dépendance.</p>}
                    {t.actions.dependances && <Button icon={Link2} className="mt-3" onClick={() => setModal('dependance')}>Ajouter une dépendance</Button>}
                  </Card>
                )}
                <Card title="Historique"><Timeline items={t.historique} /></Card>
              </>}
              aside={<>
                <Card title="Informations">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={t.statut} />], ['Priorité', <PrioriteBadge key="p" value={t.priorite} />],
                    ['Agent', t.agent_nom], ['Attribuée par', t.chef_nom],
                    ['Début', fmtDate(t.date_debut)], ['Échéance', <span key="e" className={isOverdue(t.echeance, t.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(t.echeance)}</span>],
                    t.echeance_initiale && ['Échéance initiale', fmtDate(t.echeance_initiale)],
                    t.parent && ['Tâche parente', <Link key="pa" className="link" to={`/taches/${t.parent.id}`}>{t.parent.reference} — {t.parent.titre}</Link>],
                    ['Avancement', <Progress key="a" value={t.avancement} />], t.date_cloture && ['Clôturée le', fmtDateTime(t.date_cloture)],
                    t.instruction_id && ['Instruction liée', <Link key="i" className="link" to={`/instructions/${t.instruction_id}`}>{t.instruction_reference}</Link>],
                  ]} />
                </Card>
                <Card title="Pièces jointes et preuves d’exécution"><Attachments type="TASK" id={id} preuve={estAgent} canUpload={(estAgent || estChef) && !['CLOTUREE', 'ANNULEE'].includes(t.statut)} /></Card>
                <CarteProlongations items={t.prolongations} echeanceInitiale={t.echeance_initiale} />
              </>} />
            {modal === 'avancement' && <AvancementModal current={t.avancement} onClose={() => setModal(null)} onSave={(b) => post('avancement', b, 'Avancement mis à jour.')} />}
            {modal === 'cr' && <TextModal title="Rendre compte au Chef de Bureau" label="Rapport d’exécution" confirmLabel="Transmettre" onClose={() => setModal(null)} onSave={(x) => post('rendre-compte', { rapport_execution: x }, 'Compte rendu transmis.')} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Observations" danger confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(x) => post('retourner', { observations: x }, 'Tâche retournée.')} />}
            {modal === 'dependance' && <DependanceModal tache={t} onClose={() => setModal(null)} onSave={(dep) => post('dependances', { depend_de_task_id: dep }, 'Dépendance ajoutée.')} />}
            <ModalesTraitement modal={modal} setModal={setModal} post={post} item={t} />
          </>
        );
      }}
    </Loadable>
  );
}
