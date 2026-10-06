import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCheck, CheckCircle2, CornerDownRight, FileDown, Gauge, ListPlus, Lock, MessageSquareReply, Send, Undo2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, PrioriteBadge, Progress, runAction, toast, InfoAlert, Button, WorkflowPanel, DetailLayout } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime, isOverdue } from '../../lib/format';
import { ROLES } from '../../lib/labels';
import { circuitInstruction } from '../../lib/workflows';
import { AvancementModal, TextModal } from './WorkflowActions';

const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD'];

/** Qui doit agir lorsque l’utilisateur n’a pas d’action à mener. */
function attente(i) {
  if (i.statut === 'CLOTUREE') return 'Circuit terminé : l’instruction est clôturée.';
  if (i.statut === 'BROUILLON') return `Brouillon de ${i.emetteur_nom}, non encore transmis.`;
  if (ACTIVE.includes(i.statut)) return `Exécution en attente de ${i.destinataire_nom} (${ROLES[i.destinataire_role]}).`;
  return `Validation en attente de ${i.emetteur_nom} (${ROLES[i.emetteur_role]}).`;
}

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
        const actif = ACTIVE.includes(i.statut);
        return (
          <>
            <PageHeader title={i.objet} subtitle={`${i.reference} · émise le ${fmtDateTime(i.date_emission)}`} breadcrumb={[{ label: 'Instructions', to: '/instructions' }, { label: i.reference }]}
              actions={<>
                {can('exports.generer') && i.statut !== 'BROUILLON' && <Button icon={FileDown} onClick={() => download(`/instructions/${id}/pdf`).catch((e) => toast.error(errorMessage(e)))}>PDF</Button>}
                {estDestinataire && actif && can('instructions.emettre') && <Link to={`/instructions/nouvelle?parent=${id}`} className="btn-secondary"><CornerDownRight size={16} aria-hidden /> Décliner</Link>}
                {estDestinataire && actif && can('taches.attribuer') && <Link to={`/taches/nouvelle?instruction=${id}`} className="btn-secondary"><ListPlus size={16} aria-hidden /> Créer une tâche</Link>}
              </>} />
            <WorkflowPanel circuit={circuitInstruction(i)} attente={attente(i)}
              message={estDestinataire && i.statut === 'A_CORRIGER' && <InfoAlert tone="warning">L’émetteur a retourné cette instruction : {i.observations}</InfoAlert>}
              actions={[
                estEmetteur && i.statut === 'BROUILLON' && <Button key="tr" variant="primary" icon={Send} onClick={() => post('transmettre', {}, 'Instruction transmise.')}>Transmettre</Button>,
                estDestinataire && i.statut === 'TRANSMISE' && <Button key="ar" variant="success" icon={CheckCheck} onClick={() => post('accuser-reception', {}, 'Réception confirmée.')}>Accuser réception</Button>,
                estDestinataire && actif && <Button key="av" icon={Gauge} onClick={() => setModal('avancement')}>Avancement</Button>,
                estDestinataire && actif && <Button key="cr" variant="primary" icon={MessageSquareReply} onClick={() => setModal('compte-rendu')}>Rendre compte</Button>,
                estEmetteur && i.statut === 'EXECUTEE' && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => post('valider', {}, 'Exécution validée.')}>Valider</Button>,
                estEmetteur && i.statut === 'EXECUTEE' && <Button key="re" icon={Undo2} onClick={() => setModal('retour')}>Retourner</Button>,
                estEmetteur && i.statut === 'VALIDEE' && <Button key="cl" variant="primary" icon={Lock} onClick={() => post('cloturer', {}, 'Instruction clôturée.')}>Clôturer</Button>,
              ]} />
            <DetailLayout
              main={<>
                <Card title="Instruction">
                  <p className="whitespace-pre-line text-sm">{i.contenu}</p>
                  {i.observations && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Observations</div><p className="mt-1 whitespace-pre-line text-sm">{i.observations}</p></div>}
                </Card>
                <Card title="Réponse / compte rendu">
                  {i.reponse ? <><p className="whitespace-pre-line text-sm">{i.reponse}</p><p className="mt-2 text-xs text-slate-500">Reçu le {fmtDateTime(i.date_reponse)}</p></> : <p className="text-sm text-slate-500">Aucun compte rendu pour l’instant.</p>}
                </Card>
                {(i.sousInstructions.length > 0 || i.taches.length > 0) && (
                  <Card title="Déclinaisons">
                    <ul className="space-y-2 text-sm">
                      {i.sousInstructions.map((s) => <li key={`i${s.id}`} className="flex flex-wrap items-center gap-2"><Link to={`/instructions/${s.id}`} className="link">{s.reference} — {s.objet}</Link><span className="text-xs text-slate-500">→ {s.destinataire_nom}</span><StatusBadge value={s.statut} /></li>)}
                      {i.taches.map((t) => <li key={`t${t.id}`} className="flex flex-wrap items-center gap-2"><Link to={`/taches/${t.id}`} className="link">Tâche {t.reference} — {t.titre}</Link><span className="text-xs text-slate-500">→ {t.agent_nom}</span><StatusBadge value={t.statut} /></li>)}
                    </ul>
                  </Card>
                )}
                <Card title="Historique"><Timeline items={i.historique} /></Card>
              </>}
              aside={<>
                <Card title="Informations">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={i.statut} />], ['Priorité', <PrioriteBadge key="p" value={i.priorite} />],
                    ['Émetteur', `${i.emetteur_nom} — ${ROLES[i.emetteur_role]}`], ['Destinataire', `${i.destinataire_nom} — ${ROLES[i.destinataire_role]}`],
                    ['Date d’émission', fmtDateTime(i.date_emission)],
                    ['Échéance', <span key="e" className={isOverdue(i.echeance, i.statut) ? 'font-semibold text-red-700' : ''}>{fmtDate(i.echeance)}</span>],
                    ['Avancement', <Progress key="a" value={i.avancement} />], i.date_cloture && ['Date de clôture', fmtDateTime(i.date_cloture)],
                    i.parent && ['Instruction d’origine', <Link key="o" className="link" to={`/instructions/${i.parent.id}`}>{i.parent.reference}</Link>],
                  ]} />
                </Card>
                <Card title="Pièces jointes"><Attachments type="INSTRUCTION" id={id} canUpload={(estEmetteur || estDestinataire) && i.statut !== 'CLOTUREE'} /></Card>
              </>} />
            {modal === 'avancement' && <AvancementModal current={i.avancement} onClose={() => setModal(null)} onSave={(b) => post('avancement', b, 'Avancement mis à jour.')} />}
            {modal === 'compte-rendu' && <TextModal title="Rendre compte de l’exécution" label="Compte rendu adressé à l’émetteur" confirmLabel="Transmettre le compte rendu" onClose={() => setModal(null)} onSave={(t) => post('rendre-compte', { reponse: t }, 'Compte rendu transmis.')} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Observations" confirmLabel="Retourner" danger onClose={() => setModal(null)} onSave={(t) => post('retourner', { observations: t }, 'Instruction retournée.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
