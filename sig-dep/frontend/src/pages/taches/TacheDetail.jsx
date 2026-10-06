import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, CheckCircle2, FilePlus2, Gauge, Lock, MessageSquareReply, Undo2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, PrioriteBadge, Progress, runAction, InfoAlert, Button, WorkflowPanel, DetailLayout } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime, isOverdue } from '../../lib/format';
import { circuitTache } from '../../lib/workflows';
import { AvancementModal, TextModal } from '../instructions/WorkflowActions';

const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD'];

function attente(t) {
  if (t.statut === 'CLOTUREE') return 'Circuit terminé : la tâche est clôturée.';
  if (ACTIVE.includes(t.statut)) return `Exécution en attente de ${t.agent_nom}.`;
  return `Validation en attente de ${t.chef_nom} (Chef de Bureau).`;
}

export default function TacheDetail() {
  const { id } = useParams();
  const state = useApi(`/taches/${id}`);
  const can = useAuth((s) => s.can);
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/taches/${id}/${path}`, body), msg); setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(t) => {
        const { estAgent, estChef } = t.actions;
        const actif = ACTIVE.includes(t.statut);
        return (
          <>
            <PageHeader title={t.titre} subtitle={`${t.reference} · ${t.bureau_nom}`} breadcrumb={[{ label: 'Tâches', to: '/taches' }, { label: t.reference }]}
              actions={estAgent && actif && can('documents.rediger') && <Link className="btn-secondary" to={`/documents/nouveau?tache=${id}`}><FilePlus2 size={16} aria-hidden /> Rédiger un document</Link>} />
            <WorkflowPanel circuit={circuitTache(t)} attente={attente(t)}
              message={estAgent && t.statut === 'A_CORRIGER' && <InfoAlert tone="warning">Retour du Chef de Bureau : {t.observations}</InfoAlert>}
              actions={[
                estAgent && t.statut === 'TRANSMISE' && <Button key="ar" variant="success" icon={CheckCheck} onClick={() => post('accuser-reception', {}, 'Réception confirmée.')}>Accuser réception</Button>,
                estAgent && actif && <Button key="av" icon={Gauge} onClick={() => setModal('avancement')}>Avancement</Button>,
                estAgent && actif && <Button key="cr" variant="primary" icon={MessageSquareReply} onClick={() => setModal('cr')}>Rendre compte</Button>,
                estChef && t.statut === 'EXECUTEE' && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => post('valider', {}, 'Tâche validée.')}>Valider</Button>,
                estChef && t.statut === 'EXECUTEE' && <Button key="re" icon={Undo2} onClick={() => setModal('retour')}>Retourner</Button>,
                estChef && t.statut === 'VALIDEE' && <Button key="cl" variant="primary" icon={Lock} onClick={() => post('cloturer', {}, 'Tâche clôturée.')}>Clôturer</Button>,
              ]} />
            <DetailLayout
              main={<>
                <Card title="Tâche">
                  {t.description ? <p className="whitespace-pre-line text-sm">{t.description}</p> : <p className="text-sm text-slate-500">Aucune description.</p>}
                  {t.observations && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Observations</div><p className="mt-1 whitespace-pre-line text-sm">{t.observations}</p></div>}
                </Card>
                <Card title="Rapport d’exécution">{t.rapport_execution ? <p className="whitespace-pre-line text-sm">{t.rapport_execution}</p> : <p className="text-sm text-slate-500">Aucun rapport pour l’instant.</p>}</Card>
                <Card title="Historique"><Timeline items={t.historique} /></Card>
              </>}
              aside={<>
                <Card title="Informations">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={t.statut} />], ['Priorité', <PrioriteBadge key="p" value={t.priorite} />],
                    ['Agent', t.agent_nom], ['Attribuée par', t.chef_nom],
                    ['Début', fmtDate(t.date_debut)], ['Échéance', <span key="e" className={isOverdue(t.echeance, t.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(t.echeance)}</span>],
                    ['Avancement', <Progress key="a" value={t.avancement} />], t.date_cloture && ['Clôturée le', fmtDateTime(t.date_cloture)],
                    t.instruction_id && ['Instruction liée', <Link key="i" className="link" to={`/instructions/${t.instruction_id}`}>{t.instruction_reference}</Link>],
                  ]} />
                </Card>
                <Card title="Pièces jointes"><Attachments type="TASK" id={id} canUpload={(estAgent || estChef) && t.statut !== 'CLOTUREE'} /></Card>
              </>} />
            {modal === 'avancement' && <AvancementModal current={t.avancement} onClose={() => setModal(null)} onSave={(b) => post('avancement', b, 'Avancement mis à jour.')} />}
            {modal === 'cr' && <TextModal title="Rendre compte au Chef de Bureau" label="Rapport d’exécution" confirmLabel="Transmettre" onClose={() => setModal(null)} onSave={(x) => post('rendre-compte', { rapport_execution: x }, 'Compte rendu transmis.')} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Observations" danger confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(x) => post('retourner', { observations: x }, 'Tâche retournée.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
