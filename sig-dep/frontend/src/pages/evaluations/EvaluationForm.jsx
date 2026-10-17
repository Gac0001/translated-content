import { useState } from 'react';
import { FormModal, Field, NumberInput } from '../../components/ui';
import { aujourdhui } from '../../lib/format';

/**
 * Ouverture du dossier d’évaluation d’un exercice à réception de la convocation du Ministère du
 * Budget, ou modification de la convocation et de la période de projection (annexe II).
 */
export default function EvaluationForm({ initial, onClose, onSubmit }) {
  const creation = !initial;
  const annee = Number(aujourdhui().slice(0, 4));
  const [f, setF] = useState(initial || { annee, convocation_reference: '', convocation_date: aujourdhui(), date_limite: '', annee_projection: annee + 1 });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const projectionValide = f.annee_projection >= f.annee && f.annee_projection <= f.annee + 3;
  const valide = f.annee && f.convocation_reference.trim().length >= 3 && f.convocation_date && projectionValide && (!f.date_limite || f.date_limite >= f.convocation_date);
  const enregistrer = () => onSubmit({ ...f, date_limite: f.date_limite || null });
  return (
    <FormModal open title={creation ? 'Ouvrir le dossier d’évaluation' : 'Convocation et période de projection'} onClose={onClose} onSubmit={enregistrer}
      dirty submitLabel={creation ? 'Ouvrir le dossier' : 'Enregistrer'} disabled={!valide}>
      {creation && (
        <Field label="Exercice évalué" required hint="Les annexes I à V sont reprises des PTBA validés, des crédits et des effectifs de cet exercice.">
          <NumberInput value={f.annee} min={2000} max={2100} onChange={(v) => setF({ ...f, annee: v, annee_projection: v ? v + 1 : f.annee_projection })} />
        </Field>
      )}
      <Field label="Référence de la convocation du Ministère du Budget" required><input className="input" value={f.convocation_reference} onChange={up('convocation_reference')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date de la convocation" required><input type="date" className="input" value={f.convocation_date} onChange={up('convocation_date')} /></Field>
        <Field label="Échéance de transmission" error={f.date_limite && f.date_limite < f.convocation_date ? 'L’échéance précède la convocation.' : undefined}>
          <input type="date" className="input" value={f.date_limite || ''} onChange={up('date_limite')} />
        </Field>
      </div>
      <Field label="Première année de la projection (annexe II)" required hint={projectionValide ? `Projection sur ${f.annee_projection}, ${f.annee_projection + 1} et ${f.annee_projection + 2}.` : undefined}
        error={!projectionValide ? 'Entre l’exercice évalué et les trois exercices suivants.' : undefined}>
        <NumberInput value={f.annee_projection} min={2000} max={2103} onChange={(v) => setF({ ...f, annee_projection: v })} />
      </Field>
      {creation && <p className="text-xs text-slate-600">Joignez ensuite la convocation et les états de la Direction des Ressources Humaines au dossier.</p>}
    </FormModal>
  );
}
