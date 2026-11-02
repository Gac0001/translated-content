import { useState } from 'react';
import { Modal, Field } from '../../components/ui';

/** Fenêtre de mise à jour d’avancement (instructions et tâches). */
export function AvancementModal({ current = 0, onClose, onSave }) {
  const [v, setV] = useState(Math.min(current, 99));
  const [obs, setObs] = useState('');
  return (
    <Modal open title="Mettre à jour l’avancement" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={() => onSave({ avancement: Number(v), observations: obs || undefined })}>Enregistrer</button></>}>
      <Field label={`Avancement : ${v} %`} hint="100 % correspond au compte rendu d’exécution."><input type="range" min="0" max="99" value={v} onChange={(e) => setV(e.target.value)} className="w-full" /></Field>
      <Field label="Observations" className="mt-3"><textarea className="input" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
    </Modal>
  );
}

/** Fenêtre de saisie d’un texte obligatoire (compte rendu, motif de retour…). */
export function TextModal({ title, label, onClose, onSave, confirmLabel = 'Valider', danger }) {
  const [t, setT] = useState('');
  return (
    <Modal open title={title} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className={danger ? 'btn-danger' : 'btn-primary'} disabled={t.trim().length < 3} onClick={() => onSave(t)}>{confirmLabel}</button></>}>
      <Field label={label} required><textarea className="input" rows={6} value={t} onChange={(e) => setT(e.target.value)} /></Field>
    </Modal>
  );
}
