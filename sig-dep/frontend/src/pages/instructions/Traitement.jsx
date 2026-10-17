import { useState } from 'react';
import { Ban, CalendarClock, CalendarPlus, FileClock, OctagonPause, PlayCircle } from 'lucide-react';
import { Modal, Field, Card, InfoAlert, Badge, Button } from '../../components/ui';
import { COLORS } from '../../lib/labels';
import { aujourdhui, fmtDate, fmtDateTime } from '../../lib/format';
import { TextModal } from './WorkflowActions';

/**
 * Étapes communes aux instructions et aux tâches : blocage, rapport intermédiaire, annulation,
 * prolongation (demande de l’exécutant, décision ou prolongation directe de l’émetteur).
 */
/** Lendemain d’une date AAAA-MM-JJ (calcul à midi : insensible au fuseau horaire). */
const lendemain = (jour) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** Demain à Kinshasa. */
const demain = () => lendemain(aujourdhui());

/** Boutons des étapes de traitement, pour le panneau du circuit (valeurs fausses ignorées par WorkflowPanel). */
export function boutonsTraitement(a, setModal) {
  return [
    a.rapportIntermediaire && <Button key="rapport" icon={FileClock} onClick={() => setModal('rapport')}>Rapport intermédiaire</Button>,
    a.bloquer && <Button key="bloquer" icon={OctagonPause} className="text-red-700" onClick={() => setModal('bloquer')}>Signaler un blocage</Button>,
    a.debloquer && <Button key="debloquer" icon={PlayCircle} onClick={() => setModal('debloquer')}>Lever le blocage</Button>,
    a.demanderProlongation && <Button key="prolongation" icon={CalendarClock} onClick={() => setModal('prolongation')}>Demander une prolongation</Button>,
    a.deciderProlongation && <Button key="decision" variant="primary" icon={CalendarClock} onClick={() => setModal('decision')}>Décider de la prolongation</Button>,
    a.prolonger && <Button key="prolonger" icon={CalendarPlus} onClick={() => setModal('prolonger')}>Prolonger le délai</Button>,
    a.annuler && <Button key="annuler" icon={Ban} className="text-red-700" onClick={() => setModal('annuler')}>Annuler</Button>,
  ];
}

export function BoutonsTraitement({ a, setModal }) {
  return <>{boutonsTraitement(a, setModal)}</>;
}

function DateMotifModal({ title, label, echeance, onClose, onSave, confirmLabel }) {
  const [date, setDate] = useState('');
  const [motif, setMotif] = useState('');
  const min = echeance && echeance >= demain() ? lendemain(echeance) : demain();
  return (
    <Modal open title={title} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!date || motif.trim().length < 3} onClick={() => onSave({ echeance: date, motif })}>{confirmLabel}</button></>}>
      {echeance && <p className="mb-3 text-sm text-slate-600">Échéance actuelle : <b>{fmtDate(echeance)}</b></p>}
      <Field label="Nouvelle échéance" required><input type="date" className="input" min={min} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={label} required className="mt-3"><textarea className="input" rows={4} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
    </Modal>
  );
}

function RapportModal({ current, onClose, onSave }) {
  const [texte, setTexte] = useState('');
  const [av, setAv] = useState(Math.min(current, 99));
  return (
    <Modal open title="Rapport intermédiaire" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={texte.trim().length < 3} onClick={() => onSave({ texte, avancement: Number(av) })}>Transmettre</button></>}>
      <p className="mb-3 text-sm text-slate-600">Compte rendu d’étape adressé à l’émetteur : le traitement continue. Joignez les pièces utiles depuis la fiche.</p>
      <Field label="Rapport" required><textarea className="input" rows={6} value={texte} onChange={(e) => setTexte(e.target.value)} /></Field>
      <Field label={`Avancement : ${av} %`} className="mt-3"><input type="range" min={current} max="99" value={av} onChange={(e) => setAv(e.target.value)} className="w-full" /></Field>
    </Modal>
  );
}

function DecisionModal({ demande, onClose, onSave }) {
  const [date, setDate] = useState(demande.echeance_demandee);
  const [commentaire, setCommentaire] = useState('');
  return (
    <Modal open title="Décider de la prolongation" onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
      <button type="button" className="btn-danger" disabled={commentaire.trim().length < 3} onClick={() => onSave({ accorder: false, commentaire })}>Refuser</button>
      <button type="button" className="btn-success" disabled={!date} onClick={() => onSave({ accorder: true, echeance: date, commentaire: commentaire || undefined })}>Accorder</button>
    </>}>
      <div className="space-y-1 text-sm">
        <p><b>{demande.demandeur_nom}</b> demande le {fmtDateTime(demande.created_at)} de reporter l’échéance du <b>{fmtDate(demande.echeance_actuelle)}</b> au <b>{fmtDate(demande.echeance_demandee)}</b>.</p>
        <p className="whitespace-pre-line rounded bg-slate-50 p-2 text-slate-700">{demande.motif}</p>
      </div>
      <Field label="Échéance accordée" className="mt-3" hint="Vous pouvez accorder une date différente de celle demandée."><input type="date" className="input" min={demain()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Commentaire" className="mt-3" hint="Obligatoire en cas de refus."><textarea className="input" rows={3} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></Field>
    </Modal>
  );
}

export function ModalesTraitement({ modal, setModal, post, item }) {
  const fermer = () => setModal(null);
  const demande = (item.prolongations || []).find((p) => p.statut === 'DEMANDEE');
  switch (modal) {
    case 'bloquer': return <TextModal title="Signaler un blocage" label="Nature du blocage et appui attendu" confirmLabel="Signaler" danger onClose={fermer} onSave={(t) => post('bloquer', { motif: t }, 'Blocage signalé à l’émetteur.')} />;
    case 'debloquer': return <TextModal title="Lever le blocage" label="Comment le blocage a-t-il été levé ?" confirmLabel="Reprendre le traitement" onClose={fermer} onSave={(t) => post('debloquer', { commentaire: t }, 'Traitement repris.')} />;
    case 'rapport': return <RapportModal current={item.avancement} onClose={fermer} onSave={(b) => post('rapport-intermediaire', b, 'Rapport intermédiaire transmis.')} />;
    case 'annuler': return <TextModal title="Annuler" label="Motif de l’annulation" confirmLabel="Annuler définitivement" danger onClose={fermer} onSave={(t) => post('annuler', { motif: t }, 'Annulation enregistrée.')} />;
    case 'prolongation': return <DateMotifModal title="Demander une prolongation" label="Motif de la demande" echeance={item.echeance} confirmLabel="Demander" onClose={fermer} onSave={(b) => post('prolongation', b, 'Demande de prolongation transmise.')} />;
    case 'prolonger': return <DateMotifModal title="Prolonger le délai" label="Motif" echeance={item.echeance} confirmLabel="Prolonger" onClose={fermer} onSave={(b) => post('prolonger', b, 'Délai prolongé.')} />;
    case 'decision': return demande ? <DecisionModal demande={demande} onClose={fermer} onSave={(b) => post('prolongation/decision', b, b.accorder ? 'Prolongation accordée.' : 'Prolongation refusée.')} /> : null;
    default: return null;
  }
}

/** Bandeaux d’état : blocage, annulation, demande de prolongation en attente. */
export function AlertesTraitement({ item, className = 'mb-3' }) {
  const demande = (item.prolongations || []).find((p) => p.statut === 'DEMANDEE');
  return (
    <div className={`space-y-2 empty:hidden ${className}`}>
      {item.statut === 'BLOQUEE' && <InfoAlert tone="warning"><b>Blocage signalé</b> le {fmtDateTime(item.bloquee_at)} : {item.motif_blocage}</InfoAlert>}
      {item.statut === 'ANNULEE' && <InfoAlert tone="warning"><b>Annulée</b> le {fmtDateTime(item.annulee_at)} : {item.motif_annulation}</InfoAlert>}
      {demande && <InfoAlert>Prolongation demandée jusqu’au <b>{fmtDate(demande.echeance_demandee)}</b> par {demande.demandeur_nom} : {demande.motif}</InfoAlert>}
    </div>
  );
}

const PROLONGATION = { DEMANDEE: ['En attente', COLORS.jaune], ACCORDEE: ['Accordée', COLORS.vert], REFUSEE: ['Refusée', COLORS.rouge] };

export function CarteProlongations({ items = [], echeanceInitiale }) {
  if (!items.length) return null;
  return (
    <Card title="Prolongations">
      {echeanceInitiale && <p className="mb-2 text-sm text-slate-600">Échéance initiale : <b>{fmtDate(echeanceInitiale)}</b></p>}
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((p) => (
          <li key={p.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span>{fmtDate(p.echeance_actuelle)} → <b>{fmtDate(p.echeance_demandee)}</b></span>
              <Badge className={PROLONGATION[p.statut][1]}>{PROLONGATION[p.statut][0]}</Badge>
            </div>
            <p className="text-xs text-slate-500">{p.demandeur_nom}, le {fmtDateTime(p.created_at)}{p.decideur_nom && p.decide_par !== p.demandeur_user_id ? ` · décision de ${p.decideur_nom}` : ''}</p>
            <p className="mt-1 whitespace-pre-line text-slate-700">{p.motif}</p>
            {p.commentaire && <p className="mt-1 text-slate-600"><i>{p.commentaire}</i></p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
