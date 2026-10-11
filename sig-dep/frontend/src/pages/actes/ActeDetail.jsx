import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, CopyPlus, Pencil, Send, Trash2, Undo2, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, StatusBadge, InfoAlert, Modal, Field, Button, WorkflowPanel, runAction, useConfirm } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { EFFETS_ACTE } from '../../lib/labels';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { circuitActe } from '../../lib/workflows';

function Decision({ acte, onClose, onDone }) {
  const [commentaire, setCommentaire] = useState('');
  const [enCours, setEnCours] = useState(false);
  const decider = async (decision) => {
    setEnCours(true);
    try {
      await runAction(() => api.post(`/actes/${acte.id}/decision`, { decision, commentaire: commentaire || undefined }), decision === 'VALIDE' ? 'Acte validé : ses effets s’appliquent aux dates prévues.' : 'Acte refusé.');
      onDone();
    } catch { setEnCours(false); /* erreur déjà signalée */ }
  };
  return (
    <Modal open title={`Décision — ${acte.numero}`} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose} disabled={enCours}>Fermer</button>
      <button type="button" className="btn-danger" disabled={enCours || commentaire.trim().length < 5} title={commentaire.trim().length < 5 ? 'Une observation est obligatoire pour refuser' : undefined} onClick={() => decider('REFUSE')}><XCircle size={16} aria-hidden /> Refuser</button>
      <button type="button" className="btn-primary" disabled={enCours} onClick={() => decider('VALIDE')}><CheckCircle2 size={16} aria-hidden /> Valider</button>
    </>}>
      <div className="space-y-3">
        <InfoAlert>Vérifiez la copie de l’acte signé avant de valider. Un acte validé ne se modifie plus : toute correction passe par un rectificatif.</InfoAlert>
        <Field label="Observation" hint="Obligatoire en cas de refus (5 caractères au moins)"><textarea className="input" rows={3} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></Field>
      </div>
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
        const soumettre = async () => { await runAction(() => api.post(`/actes/${a.id}/soumettre`), 'Acte soumis à validation.').catch(() => null); state.reload(); };
        const revoquer = async () => {
          const motif = await confirm({ title: `Révoquer l’acte ${a.numero}`, message: 'Les droits accordés par cet acte (intérim, désignation) cessent immédiatement. L’acte reste dans le registre.', input: { label: 'Motif de la révocation', required: true, min: 5 }, confirmLabel: 'Révoquer', danger: true });
          if (!motif) return;
          await runAction(() => api.post(`/actes/${a.id}/revoquer`, { motif }), 'Acte révoqué : ses effets ont cessé.').catch(() => null);
          state.reload();
        };
        const supprimer = async () => {
          if (!(await confirm({ title: 'Supprimer le brouillon', message: `Supprimer le brouillon ${a.numero} ?`, danger: true, confirmLabel: 'Supprimer' }))) return;
          try { await runAction(() => api.delete(`/actes/${a.id}`), 'Brouillon supprimé.'); } catch { return; }
          navigate('/actes');
        };
        const rectifier = async () => {
          const r = await runAction(() => api.post(`/actes/${a.id}/rectifier`), a.statut === 'VALIDE' ? 'Rectificatif créé : complétez-le, joignez l’acte rectificatif signé et soumettez-le.' : 'Nouvel acte créé à partir de l’acte refusé.').catch(() => null);
          if (r) navigate(`/actes/${r.data.id}`);
        };
        return (
          <>
            <PageHeader title={a.objet} breadcrumb={[{ label: 'Actes administratifs', to: '/actes' }, { label: a.numero }]}
              subtitle={<span className="flex flex-wrap items-center gap-2"><Badge>{a.typeLibelle}</Badge><StatusBadge value={a.statut} />{a.effet && <Badge className={EFFETS_ACTE[a.effet][1]}>{EFFETS_ACTE[a.effet][0]}</Badge>}</span>}
              actions={d.modifier && <Link to={`/actes/${a.id}/modifier`} className="btn-secondary"><Pencil size={16} aria-hidden /> Modifier</Link>}
              menu={[
                d.rectifier && { label: a.statut === 'VALIDE' ? 'Établir un rectificatif' : 'Reprendre', icon: CopyPlus, onClick: rectifier },
                d.revoquer && { label: 'Révoquer l’acte', icon: Undo2, danger: true, onClick: revoquer },
                d.modifier && { label: 'Supprimer le brouillon', icon: Trash2, danger: true, onClick: supprimer },
              ]} />
            {modal === 'decision' && <Decision acte={a} onClose={() => setModal(null)} onDone={done} />}
            <WorkflowPanel circuit={circuitActe(a)}
              attente={{
                BROUILLON: `Acte en préparation : joignez la copie scannée de l’acte signé, puis soumettez-le à la validation ${a.validation_par === 'SECRETAIRE_GENERAL' ? 'du Secrétaire Général' : 'du Directeur'}.`,
                SOUMIS: `En attente de la décision ${a.validation_par === 'SECRETAIRE_GENERAL' ? 'du Secrétaire Général' : 'du Directeur'}.`,
                VALIDE: 'Acte validé : il ne se modifie plus ; il se corrige par un rectificatif ou se révoque.',
                REFUSE: 'Acte refusé : il peut être repris en un nouvel acte.', REVOQUE: 'Acte révoqué : ses effets ont cessé.',
                EXPIRE: 'Période échue : les droits temporaires ont expiré.', REMPLACE: 'Acte remplacé par un rectificatif validé.',
              }[a.statut]}
              actions={[
                d.modifier && <Button key="so" variant="primary" icon={Send} onClick={soumettre}>Soumettre à validation</Button>,
                d.decider && <Button key="de" variant="primary" icon={CheckCircle2} onClick={() => setModal('decision')}>Décider</Button>,
              ]} />
            {(a.rectifie_numero || a.rectificatifs?.length > 0) && (
              <div className="mb-4 space-y-2">
            {a.rectifie_numero && <InfoAlert>Rectificatif de l’acte <Link className="underline" to={`/actes/${a.rectifie_acte_id}`}>{a.rectifie_numero}</Link> : à sa validation, il le remplace.</InfoAlert>}
            {a.rectificatifs?.length > 0 && <InfoAlert tone="warning">Rectificatif(s) : {a.rectificatifs.map((r) => <Link key={r.id} className="mr-2 underline" to={`/actes/${r.id}`}>{r.numero} ({r.statut.toLowerCase()})</Link>)}</InfoAlert>}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-3">
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
