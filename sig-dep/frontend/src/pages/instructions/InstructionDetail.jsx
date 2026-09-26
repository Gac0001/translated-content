import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, CheckCircle2, CornerDownRight, FileDown, Gauge, ListPlus, Lock, MessageSquareReply, Send, Undo2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, PrioriteBadge, Progress, runAction, toast, InfoAlert } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { ROLES } from '../../lib/labels';
import { AvancementModal, TextModal } from './WorkflowActions';

const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD'];

export default function InstructionDetail() {
  const { id } = useParams();
  const state = useApi(`/instructions/${id}`);
  const can = useAuth((s) => s.can);
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/instructions/${id}/${path}`, body), msg); setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(i) => {
        const { estEmetteur, estDestinataire } = i.actions;
        return (
          <>
            <PageHeader title={i.objet} subtitle={`${i.reference} · émise le ${fmtDateTime(i.date_emission)}`} breadcrumb={[{ label: 'Instructions', to: '/instructions' }, { label: i.reference }]}
              actions={<>
                {can('exports.generer') && i.statut !== 'BROUILLON' && <button type="button" className="btn-secondary" onClick={() => download(`/instructions/${id}/pdf`).catch((e) => toast.error(errorMessage(e)))}><FileDown size={16} /> PDF</button>}
                {estEmetteur && i.statut === 'BROUILLON' && <button type="button" className="btn-primary" onClick={() => post('transmettre', {}, 'Instruction transmise.')}><Send size={16} /> Transmettre</button>}
                {estDestinataire && i.statut === 'TRANSMISE' && <button type="button" className="btn-success" onClick={() => post('accuser-reception', {}, 'Réception confirmée.')}><CheckCheck size={16} /> Accuser réception</button>}
                {estDestinataire && ACTIVE.includes(i.statut) && <>
                  <button type="button" className="btn-secondary" onClick={() => setModal('avancement')}><Gauge size={16} /> Avancement</button>
                  <button type="button" className="btn-primary" onClick={() => setModal('compte-rendu')}><MessageSquareReply size={16} /> Rendre compte</button>
                  {can('instructions.emettre') && <Link to={`/instructions/nouvelle?parent=${id}`} className="btn-secondary"><CornerDownRight size={16} /> Décliner</Link>}
                  {can('taches.attribuer') && <Link to={`/taches/nouvelle?instruction=${id}`} className="btn-secondary"><ListPlus size={16} /> Créer une tâche</Link>}
                </>}
                {estEmetteur && i.statut === 'EXECUTEE' && <>
                  <button type="button" className="btn-success" onClick={() => post('valider', {}, 'Exécution validée.')}><CheckCircle2 size={16} /> Valider</button>
                  <button type="button" className="btn-secondary" onClick={() => setModal('retour')}><Undo2 size={16} /> Retourner</button>
                </>}
                {estEmetteur && i.statut === 'VALIDEE' && <button type="button" className="btn-primary" onClick={() => post('cloturer', {}, 'Instruction clôturée.')}><Lock size={16} /> Clôturer</button>}
              </>} />
            {estDestinataire && i.statut === 'A_CORRIGER' && <div className="mb-3"><InfoAlert tone="warning">L’émetteur a retourné cette instruction : {i.observations}</InfoAlert></div>}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Instruction" className="lg:col-span-2">
                <KeyValues items={[
                  ['Émetteur', `${i.emetteur_nom} — ${ROLES[i.emetteur_role]}`], ['Destinataire', `${i.destinataire_nom} — ${ROLES[i.destinataire_role]}`],
                  ['Priorité', <PrioriteBadge key="p" value={i.priorite} />], ['Statut', <StatusBadge key="s" value={i.statut} />],
                  ['Date d’émission', fmtDateTime(i.date_emission)], ['Échéance', fmtDate(i.echeance)],
                  ['Avancement', <Progress key="a" value={i.avancement} />], ['Date de clôture', fmtDateTime(i.date_cloture)],
                  i.parent && ['Instruction d’origine', <Link key="o" className="text-dep-700 hover:underline" to={`/instructions/${i.parent.id}`}>{i.parent.reference}</Link>],
                ]} />
                <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Contenu</div><p className="mt-1 whitespace-pre-line text-sm">{i.contenu}</p></div>
                {i.observations && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Observations</div><p className="mt-1 whitespace-pre-line text-sm">{i.observations}</p></div>}
              </Card>
              <Card title="Réponse / compte rendu">
                {i.reponse ? <><p className="whitespace-pre-line text-sm">{i.reponse}</p><p className="mt-2 text-xs text-slate-500">Reçu le {fmtDateTime(i.date_reponse)}</p></> : <p className="text-sm text-slate-500">Aucun compte rendu pour l’instant.</p>}
              </Card>
              <Card title="Pièces jointes"><Attachments type="INSTRUCTION" id={id} canUpload={(estEmetteur || estDestinataire) && i.statut !== 'CLOTUREE'} /></Card>
              {(i.sousInstructions.length > 0 || i.taches.length > 0) && (
                <Card title="Déclinaisons" className="lg:col-span-2">
                  <ul className="space-y-2 text-sm">
                    {i.sousInstructions.map((s) => <li key={`i${s.id}`} className="flex flex-wrap items-center gap-2"><Link to={`/instructions/${s.id}`} className="text-dep-700 hover:underline">{s.reference} — {s.objet}</Link><span className="text-xs text-slate-500">→ {s.destinataire_nom}</span><StatusBadge value={s.statut} /></li>)}
                    {i.taches.map((t) => <li key={`t${t.id}`} className="flex flex-wrap items-center gap-2"><Link to={`/taches/${t.id}`} className="text-dep-700 hover:underline">Tâche {t.reference} — {t.titre}</Link><span className="text-xs text-slate-500">→ {t.agent_nom}</span><StatusBadge value={t.statut} /></li>)}
                  </ul>
                </Card>
              )}
              <Card title="Historique" className="lg:col-span-3"><Timeline items={i.historique} /></Card>
            </div>
            {modal === 'avancement' && <AvancementModal current={i.avancement} onClose={() => setModal(null)} onSave={(b) => post('avancement', b, 'Avancement mis à jour.')} />}
            {modal === 'compte-rendu' && <TextModal title="Rendre compte de l’exécution" label="Compte rendu adressé à l’émetteur" confirmLabel="Transmettre le compte rendu" onClose={() => setModal(null)} onSave={(t) => post('rendre-compte', { reponse: t }, 'Compte rendu transmis.')} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Observations" confirmLabel="Retourner" danger onClose={() => setModal(null)} onSave={(t) => post('retourner', { observations: t }, 'Instruction retournée.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
