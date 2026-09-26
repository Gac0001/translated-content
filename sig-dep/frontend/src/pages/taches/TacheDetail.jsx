import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, CheckCircle2, FilePlus2, Gauge, Lock, MessageSquareReply, Undo2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, PrioriteBadge, Progress, runAction, InfoAlert } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { AvancementModal, TextModal } from '../instructions/WorkflowActions';

const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD'];

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
        return (
          <>
            <PageHeader title={t.titre} subtitle={`${t.reference} · ${t.bureau_nom}`} breadcrumb={[{ label: 'Tâches', to: '/taches' }, { label: t.reference }]}
              actions={<>
                {estAgent && t.statut === 'TRANSMISE' && <button type="button" className="btn-success" onClick={() => post('accuser-reception', {}, 'Réception confirmée.')}><CheckCheck size={16} /> Accuser réception</button>}
                {estAgent && ACTIVE.includes(t.statut) && <>
                  <button type="button" className="btn-secondary" onClick={() => setModal('avancement')}><Gauge size={16} /> Avancement</button>
                  <button type="button" className="btn-primary" onClick={() => setModal('cr')}><MessageSquareReply size={16} /> Rendre compte</button>
                  {can('documents.rediger') && <Link className="btn-secondary" to={`/documents/nouveau?tache=${id}`}><FilePlus2 size={16} /> Rédiger un document</Link>}
                </>}
                {estChef && t.statut === 'EXECUTEE' && <>
                  <button type="button" className="btn-success" onClick={() => post('valider', {}, 'Tâche validée.')}><CheckCircle2 size={16} /> Valider</button>
                  <button type="button" className="btn-secondary" onClick={() => setModal('retour')}><Undo2 size={16} /> Retourner</button>
                </>}
                {estChef && t.statut === 'VALIDEE' && <button type="button" className="btn-primary" onClick={() => post('cloturer', {}, 'Tâche clôturée.')}><Lock size={16} /> Clôturer</button>}
              </>} />
            {estAgent && t.statut === 'A_CORRIGER' && <div className="mb-3"><InfoAlert tone="warning">Retour du Chef de Bureau : {t.observations}</InfoAlert></div>}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Tâche" className="lg:col-span-2">
                <KeyValues items={[
                  ['Agent', t.agent_nom], ['Attribuée par', t.chef_nom], ['Priorité', <PrioriteBadge key="p" value={t.priorite} />], ['Statut', <StatusBadge key="s" value={t.statut} />],
                  ['Début', fmtDate(t.date_debut)], ['Échéance', fmtDate(t.echeance)], ['Avancement', <Progress key="a" value={t.avancement} />], ['Clôturée le', fmtDateTime(t.date_cloture)],
                  t.instruction_id && ['Instruction liée', <Link key="i" className="text-dep-700 hover:underline" to={`/instructions/${t.instruction_id}`}>{t.instruction_reference}</Link>],
                ]} />
                {t.description && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Description</div><p className="mt-1 whitespace-pre-line text-sm">{t.description}</p></div>}
                {t.observations && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Observations</div><p className="mt-1 whitespace-pre-line text-sm">{t.observations}</p></div>}
              </Card>
              <Card title="Rapport d’exécution">{t.rapport_execution ? <p className="whitespace-pre-line text-sm">{t.rapport_execution}</p> : <p className="text-sm text-slate-500">Aucun rapport pour l’instant.</p>}</Card>
              <Card title="Pièces jointes" className="lg:col-span-1"><Attachments type="TASK" id={id} canUpload={(estAgent || estChef) && t.statut !== 'CLOTUREE'} /></Card>
              <Card title="Historique" className="lg:col-span-2"><Timeline items={t.historique} /></Card>
            </div>
            {modal === 'avancement' && <AvancementModal current={t.avancement} onClose={() => setModal(null)} onSave={(b) => post('avancement', b, 'Avancement mis à jour.')} />}
            {modal === 'cr' && <TextModal title="Rendre compte au Chef de Bureau" label="Rapport d’exécution" confirmLabel="Transmettre" onClose={() => setModal(null)} onSave={(x) => post('rendre-compte', { rapport_execution: x }, 'Compte rendu transmis.')} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Observations" danger confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(x) => post('retourner', { observations: x }, 'Tâche retournée.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
