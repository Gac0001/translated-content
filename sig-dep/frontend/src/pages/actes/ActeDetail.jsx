import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, CopyPlus, Pencil, Send, Trash2, Undo2, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, StatusBadge, InfoAlert, Modal, Field, runAction, useConfirm } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { EFFETS_ACTE } from '../../lib/labels';
import { fmtDate, fmtDateTime } from '../../lib/format';

function Decision({ acte, onClose, onDone }) {
  const [commentaire, setCommentaire] = useState('');
  const decider = async (decision) => {
    await runAction(() => api.post(`/actes/${acte.id}/decision`, { decision, commentaire: commentaire || undefined }), decision === 'VALIDE' ? 'Acte validé : ses effets s’appliquent aux dates prévues.' : 'Acte refusé.');
    onDone();
  };
  return (
    <Modal open title={`Décision — ${acte.numero}`} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
      <button type="button" className="btn-danger" disabled={commentaire.trim().length < 5} onClick={() => decider('REFUSE')}><XCircle size={16} /> Refuser</button>
      <button type="button" className="btn-primary" onClick={() => decider('VALIDE')}><CheckCircle2 size={16} /> Valider</button>
    </>}>
      <div className="space-y-3">
        <InfoAlert>Vérifiez la copie de l’acte signé avant de valider. Un acte validé ne se modifie plus : toute correction passe par un rectificatif.</InfoAlert>
        <Field label="Observation" hint="Obligatoire en cas de refus (5 caractères au moins)"><textarea className="input" rows={3} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Revocation({ acte, onClose, onDone }) {
  const [motif, setMotif] = useState('');
  const revoquer = async () => { await runAction(() => api.post(`/actes/${acte.id}/revoquer`, { motif }), 'Acte révoqué : ses effets ont cessé.'); onDone(); };
  return (
    <Modal open title={`Révoquer l’acte ${acte.numero}`} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className="btn-danger" disabled={motif.trim().length < 5} onClick={revoquer}><Undo2 size={16} /> Révoquer</button>
    </>}>
      <InfoAlert tone="warning">Les droits accordés par cet acte (intérim, désignation) cessent immédiatement. L’acte reste dans le registre.</InfoAlert>
      <div className="mt-3"><Field label="Motif de la révocation" required><textarea className="input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field></div>
    </Modal>
  );
}

export default function ActeDetail() {
  const { id } = useParams();
  const state = useApi(`/actes/${id}`, [id]);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const done = () => { setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(a) => {
        const d = a.droits;
        const soumettre = async () => { await runAction(() => api.post(`/actes/${a.id}/soumettre`), 'Acte soumis à validation.'); state.reload(); };
        const supprimer = async () => {
          if (!(await confirm({ title: 'Supprimer le brouillon', message: `Supprimer le brouillon ${a.numero} ?`, danger: true, confirmLabel: 'Supprimer' }))) return;
          await runAction(() => api.delete(`/actes/${a.id}`), 'Brouillon supprimé.');
          navigate('/actes');
        };
        const rectifier = async () => {
          const r = await runAction(() => api.post(`/actes/${a.id}/rectifier`), a.statut === 'VALIDE' ? 'Rectificatif créé : complétez-le, joignez l’acte rectificatif signé et soumettez-le.' : 'Nouvel acte créé à partir de l’acte refusé.');
          navigate(`/actes/${r.data.id}`);
        };
        return (
          <>
            <PageHeader title={a.objet} breadcrumb={[{ label: 'Actes administratifs', to: '/actes' }, { label: a.numero }]}
              subtitle={<span className="flex flex-wrap items-center gap-2"><Badge>{a.typeLibelle}</Badge><StatusBadge value={a.statut} />{a.effet && <Badge className={EFFETS_ACTE[a.effet][1]}>{EFFETS_ACTE[a.effet][0]}</Badge>}</span>}
              actions={(
                <div className="flex flex-wrap gap-2">
                  {d.modifier && <Link to={`/actes/${a.id}/modifier`} className="btn-secondary"><Pencil size={16} /> Modifier</Link>}
                  {d.modifier && <button type="button" className="btn-secondary text-red-700" onClick={supprimer}><Trash2 size={16} /> Supprimer</button>}
                  {d.modifier && <button type="button" className="btn-primary" onClick={soumettre}><Send size={16} /> Soumettre à validation</button>}
                  {d.decider && <button type="button" className="btn-primary" onClick={() => setModal('decision')}><CheckCircle2 size={16} /> Décider</button>}
                  {d.rectifier && <button type="button" className="btn-secondary" onClick={rectifier}><CopyPlus size={16} /> {a.statut === 'VALIDE' ? 'Établir un rectificatif' : 'Reprendre'}</button>}
                  {d.revoquer && <button type="button" className="btn-danger" onClick={() => setModal('revocation')}><Undo2 size={16} /> Révoquer</button>}
                </div>
              )} />
            {modal === 'decision' && <Decision acte={a} onClose={() => setModal(null)} onDone={done} />}
            {modal === 'revocation' && <Revocation acte={a} onClose={() => setModal(null)} onDone={done} />}
            {a.statut === 'BROUILLON' && <InfoAlert>Acte en préparation : joignez la copie scannée de l’acte signé, puis soumettez-le à {a.validation_par === 'SECRETAIRE_GENERAL' ? 'la validation du Secrétaire Général' : 'la validation du Directeur'}.</InfoAlert>}
            {a.statut === 'SOUMIS' && <InfoAlert>En attente de la décision {a.validation_par === 'SECRETAIRE_GENERAL' ? 'du Secrétaire Général' : 'du Directeur'}.</InfoAlert>}
            {a.rectifie_numero && <InfoAlert>Rectificatif de l’acte <Link className="underline" to={`/actes/${a.rectifie_acte_id}`}>{a.rectifie_numero}</Link> : à sa validation, il le remplace.</InfoAlert>}
            {a.rectificatifs?.length > 0 && <InfoAlert tone="warning">Rectificatif(s) : {a.rectificatifs.map((r) => <Link key={r.id} className="mr-2 underline" to={`/actes/${r.id}`}>{r.numero} ({r.statut.toLowerCase()})</Link>)}</InfoAlert>}
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card title="Acte">
                  <KeyValues items={[
                    ['N° d’enregistrement', <span key="n" className="font-mono">{a.numero}</span>], ['Référence officielle', a.reference],
                    ['Date de l’acte', fmtDate(a.date_acte)], ['Autorité signataire', a.autorite],
                    ['Personne concernée', a.personne || '—'], a.poste_libelle && ['Poste', a.poste_libelle],
                    a.titulaire && ['Titulaire remplacé', a.titulaire],
                    a.date_debut && ['Période', `du ${fmtDate(a.date_debut)} au ${fmtDate(a.date_fin)}`],
                    ['Validation', a.validation_par === 'SECRETAIRE_GENERAL' ? 'Secrétaire Général' : 'Directeur'],
                    ['Préparé par', a.prepare_par_username || '—'],
                    a.decide_at && ['Décision', `${a.statut === 'REFUSE' ? 'Refusé' : 'Validé'} le ${fmtDateTime(a.decide_at)} par ${a.decide_par_username}`],
                    a.revoque_at && ['Révocation', `${fmtDateTime(a.revoque_at)} — ${a.motif_revocation}`],
                  ]} />
                  {a.motif && <p className="mt-3 whitespace-pre-line text-sm text-slate-700"><b>Motif :</b> {a.motif}</p>}
                  {a.commentaire_decision && <p className="mt-2 whitespace-pre-line text-sm text-slate-700"><b>Observation :</b> {a.commentaire_decision}</p>}
                </Card>
                {a.type === 'DESIGNATION' && (
                  <Card title="Opérations désignées">
                    <ul className="space-y-1 text-sm">
                      {(a.designations.length ? a.designations : a.permissionsLibelles).map((p) => (
                        <li key={p.id || p.code} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{p.libelle}</span>
                          {p.revoked_at ? <Badge>Retirée — {p.motif_revocation}</Badge> : p.id ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Accordée</Badge> : null}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                <Card title="Copie de l’acte signé"><Attachments type="ACTE" id={a.id} canUpload={d.modifier} /></Card>
              </div>
              <Card title="Historique"><Timeline items={a.historique} /></Card>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
