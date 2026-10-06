import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, CheckCheck, FolderInput, MessageSquarePlus, Pencil, Send, CheckCircle2, FileDown } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, UrgenceBadge, ConfidBadge, Modal, Field, runAction, useConfirm, Badge, toast, InfoAlert, Button, WorkflowPanel, DetailLayout } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { circuitCourrier } from '../../lib/workflows';

function TransmitModal({ id, onClose, onDone }) {
  const contacts = useApi('/courriers/contacts');
  const [to, setTo] = useState('');
  const [obs, setObs] = useState('');
  const send = async () => { await runAction(() => api.post(`/courriers/${id}/transmettre`, { to_user_id: Number(to), observations: obs || null }), 'Courrier transmis.'); onDone(); };
  const list = contacts.data?.data || [];
  return (
    <Modal open title="Transmettre le courrier" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!to} onClick={send}><Send size={16} /> Transmettre</button></>}>
      <p className="mb-3 text-sm text-slate-600">Seuls votre supérieur direct et vos subordonnés directs sont proposés, conformément à la chaîne hiérarchique.</p>
      <Field label="Destinataire" required>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">— Choisir —</option>
          {list.map((c) => <option key={c.userId} value={c.userId}>{c.nomComplet} — {c.roleLibelle} ({c.structure})</option>)}
        </select>
      </Field>
      <Field label="Observations / instructions d’annotation" className="mt-3"><textarea className="input" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
    </Modal>
  );
}

export default function CourrierDetail() {
  const { id } = useParams();
  const state = useApi(`/courriers/${id}`);
  const confirm = useConfirm();
  const can = useAuth((s) => s.can);
  const [transmit, setTransmit] = useState(false);
  const [note, setNote] = useState('');
  const annoter = async () => { await runAction(() => api.post(`/courriers/${id}/annoter`, { texte: note }), 'Annotation ajoutée.'); setNote(''); state.reload(); };
  const recevoir = async (tid) => {
    const obs = await confirm({ title: 'Accuser réception', message: 'Confirmez la réception de ce courrier.', input: { label: 'Observation (facultatif)' } });
    if (obs === false) return;
    await runAction(() => api.post(`/courriers/transmissions/${tid}/accuser-reception`, { observation_reception: obs || null }), 'Réception confirmée.');
    state.reload();
  };
  const simple = async (path, msg, body = {}) => { await runAction(() => api.post(`/courriers/${id}/${path}`, body), msg); state.reload(); };
  const classer = async () => {
    const c = await confirm({ title: 'Classer le courrier', message: 'Indiquez le code de classement.', input: { label: 'Classement', required: true } });
    if (c) simple('classer', 'Courrier classé.', { classement: c });
  };
  return (
    <Loadable state={state}>
      {(c) => (
        <>
          <PageHeader title={c.objet} subtitle={`${c.numero_enregistrement} · Courrier ${c.sens === 'ENTRANT' ? 'entrant' : 'sortant'}`} breadcrumb={[{ label: 'Courriers', to: '/courriers' }, { label: c.numero_enregistrement }]}
            actions={<>
              {can('exports.generer') && <Button icon={FileDown} onClick={() => download(`/courriers/${id}/fiche`).catch((e) => toast.error(errorMessage(e)))}>Fiche PDF</Button>}
              {c.actions.modifier && <Link to={`/courriers/${id}/modifier`} className="btn-secondary"><Pencil size={16} aria-hidden /> Modifier</Link>}
            </>} />
          <WorkflowPanel circuit={circuitCourrier(c)}
            attente={c.statut === 'ARCHIVE' ? 'Circuit terminé : le courrier est archivé.' : c.detenteur_nom && `Courrier actuellement détenu par ${c.detenteur_nom}.`}
            message={c.actions.accuserReception.length > 0 && <InfoAlert tone="warning">Ce courrier vous a été transmis : veuillez en accuser réception.</InfoAlert>}
            actions={[
              ...c.actions.accuserReception.map((tid) => <Button key={`ar${tid}`} variant="success" icon={CheckCheck} onClick={() => recevoir(tid)}>Accuser réception</Button>),
              c.actions.transmettre && <Button key="tr" variant="primary" icon={Send} onClick={() => setTransmit(true)}>Transmettre</Button>,
              c.actions.traiter && <Button key="tt" icon={CheckCircle2} onClick={() => simple('traiter', 'Courrier marqué comme traité.')}>Marquer comme traité</Button>,
              c.actions.classer && <Button key="cl" icon={FolderInput} onClick={classer}>Classer</Button>,
              c.actions.archiver && <Button key="aa" icon={Archive} onClick={() => simple('archiver', 'Courrier archivé.')}>Archiver</Button>,
            ]} />
          <DetailLayout
            main={<>
              <Card title="Identification">
                <KeyValues items={[
                  ['N° d’enregistrement', c.numero_enregistrement], ['Référence externe', c.reference_externe], ['Date du courrier', fmtDate(c.date_courrier)], ['Enregistré le', fmtDate(c.date_enregistrement)],
                  ['Expéditeur', c.expediteur], ['Destinataire', c.destinataire],
                ]} />
                {c.resume && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Résumé</div><p className="mt-1 whitespace-pre-line text-sm">{c.resume}</p></div>}
              </Card>
              <Card title="Circulation (transmissions)" bodyClass="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full" aria-label="Transmissions du courrier">
                    <thead><tr>{['Date et heure', 'Émetteur', 'Destinataire', 'Réception', 'Observations'].map((h) => <th key={h} scope="col" className="th">{h}</th>)}</tr></thead>
                    <tbody>{c.transmissions.map((t) => (
                      <tr key={t.id}>
                        <td className="td whitespace-nowrap">{fmtDateTime(t.created_at)}</td><td className="td">{t.emetteur_nom}</td>
                        <td className="td">{t.destinataire_nom}<div className="text-xs text-slate-500">{t.sens_hierarchique === 'ASCENDANT' ? '↑ vers le supérieur' : '↓ vers le subordonné'}</div></td>
                        <td className="td">{t.etat_reception === 'RECU' ? <Badge tone="succes">Reçu le {fmtDateTime(t.recu_at)}</Badge> : <Badge tone="attention">En attente</Badge>}{t.observation_reception && <div className="text-xs text-slate-500">{t.observation_reception}</div>}</td>
                        <td className="td text-sm">{t.observations}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!c.transmissions.length && <p className="p-4 text-sm text-slate-500">Aucune transmission.</p>}
                </div>
              </Card>
              {c.instructions.length > 0 && <Card title="Instructions liées"><ul className="space-y-1 text-sm">{c.instructions.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2"><Link to={`/instructions/${i.id}`} className="link">{i.reference} — {i.objet}</Link><StatusBadge value={i.statut} /></li>)}</ul></Card>}
              <Card title="Historique de circulation"><Timeline items={c.historique} /></Card>
            </>}
            aside={<>
              <Card title="Informations">
                <KeyValues cols={1} items={[
                  ['Statut', <StatusBadge key="s" value={c.statut} />], ['Degré d’urgence', <UrgenceBadge key="u" value={c.urgence} />], ['Confidentialité', <ConfidBadge key="c" value={c.confidentialite} />],
                  ['Détenteur actuel', c.detenteur_nom], ['Classement', c.classement],
                ]} />
              </Card>
              <Card title="Annotations">
                <ul className="space-y-3">{c.annotations.map((a) => <li key={a.id} className="text-sm"><p className="whitespace-pre-line">{a.texte}</p><div className="text-xs text-slate-500">{a.auteur} · {fmtDateTime(a.created_at)}</div></li>)}</ul>
                {!c.annotations.length && <p className="text-sm text-slate-500">Aucune annotation.</p>}
                {c.actions.annoter && (
                  <div className="mt-3 space-y-2 border-t pt-3 no-print">
                    <textarea className="input" rows={2} placeholder="Nouvelle annotation…" aria-label="Nouvelle annotation" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Button icon={MessageSquarePlus} disabled={note.trim().length < 2} onClick={annoter}>Annoter</Button>
                  </div>
                )}
              </Card>
              <Card title="Pièces jointes"><Attachments type="COURRIER" id={id} canUpload={c.actions.transmettre || c.actions.modifier} /></Card>
            </>} />
          {transmit && <TransmitModal id={id} onClose={() => setTransmit(false)} onDone={() => { setTransmit(false); state.reload(); }} />}
        </>
      )}
    </Loadable>
  );
}
