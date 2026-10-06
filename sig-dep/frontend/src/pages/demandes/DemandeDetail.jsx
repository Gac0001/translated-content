import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BellRing, CheckCircle2, MessageSquareReply } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, PrioriteBadge, runAction } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { TextModal } from '../instructions/WorkflowActions';
import { ETATS_DEMANDE } from './DemandesList';

export default function DemandeDetail() {
  const { id } = useParams();
  const state = useApi(`/demandes-information/${id}`, [id]);
  const [repondre, setRepondre] = useState(false);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/demandes-information/${id}/${path}`, body), msg); setRepondre(false); state.reload(); };
  return (
    <Loadable state={state}>
      {(d) => (
        <>
          <PageHeader title={d.objet} subtitle={`${d.reference} · adressée le ${fmtDateTime(d.created_at)}`}
            breadcrumb={[{ label: 'Demandes d’information', to: '/demandes-information' }, { label: d.reference }]}
            actions={<>
              {d.actions.repondre && <button type="button" className="btn-primary" onClick={() => setRepondre(true)}><MessageSquareReply size={16} /> {d.statut === 'REPONDUE' ? 'Compléter la réponse' : 'Répondre'}</button>}
              {d.actions.relancer && <button type="button" className="btn-secondary" onClick={() => post('relancer', {}, 'Relance envoyée au Directeur.')}><BellRing size={16} /> Relancer</button>}
              {d.actions.cloturer && <button type="button" className="btn-success" onClick={() => post('cloturer', {}, 'Demande close.')}><CheckCircle2 size={16} /> Accepter la réponse et clore</button>}
            </>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Question du Secrétaire Général" className="lg:col-span-2">
              <KeyValues items={[
                ['De', d.emetteur_nom], ['Statut', <Badge key="s" className={ETATS_DEMANDE[d.statut][1]}>{ETATS_DEMANDE[d.statut][0]}</Badge>],
                ['Priorité', <PrioriteBadge key="p" value={d.priorite} />], ['Réponse attendue pour le', fmtDate(d.echeance)],
              ]} />
              <p className="mt-4 whitespace-pre-line text-sm">{d.question}</p>
            </Card>
            <Card title="Réponse du Directeur">
              {d.reponse ? <><p className="whitespace-pre-line text-sm">{d.reponse}</p><p className="mt-2 text-xs text-slate-500">{d.repondu_par_nom}, le {fmtDateTime(d.repondu_at)}</p></> : <p className="text-sm text-slate-500">En attente de réponse.</p>}
            </Card>
            <Card title="Pièces jointes"><Attachments type="DEMANDE_INFO" id={id} canUpload={d.statut !== 'CLOSE'} /></Card>
            <Card title="Historique" className="lg:col-span-2"><Timeline items={d.historique} /></Card>
          </div>
          {repondre && <TextModal title="Répondre au Secrétaire Général" label="Réponse" confirmLabel="Transmettre la réponse" onClose={() => setRepondre(false)} onSave={(t) => post('repondre', { reponse: t }, 'Réponse transmise au Secrétaire Général.')} />}
        </>
      )}
    </Loadable>
  );
}
