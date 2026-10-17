import { useState } from 'react';
import { useApi, FormModal, Field, NumberInput } from '../../components/ui';
import { aujourdhui } from '../../lib/format';

/** Préparation d’une campagne de collecte : objet, exercice, services ciblés, échéance, instructions. */
export default function CollecteForm({ initial, objets, onClose, onSubmit }) {
  const ref = useApi('/planification/referentiel');
  const creation = !initial?.id;
  const annee = Number(aujourdhui().slice(0, 4));
  const [f, setF] = useState(initial || { objet: objets[0]?.code || 'PTBA', annee: annee + 1, titre: '', echeance: '', instructions: '', services: [] });
  const services = (ref.data?.services || []).filter((s) => s.actif);
  const basculer = (id) => setF({ ...f, services: f.services.includes(id) ? f.services.filter((x) => x !== id) : [...f.services, id] });
  const valide = f.objet && f.annee && f.titre.trim().length >= 5 && f.echeance && f.echeance >= aujourdhui() && f.services.length > 0;
  return (
    <FormModal open size="lg" title={creation ? 'Nouvelle campagne de collecte' : 'Modifier la campagne'} onClose={onClose} onSubmit={() => onSubmit(f)} dirty disabled={!valide}
      submitLabel={creation ? 'Préparer la campagne' : 'Enregistrer'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Objet de la collecte" required>
          <select className="input" value={f.objet} disabled={!creation} onChange={(e) => setF({ ...f, objet: e.target.value })}>
            {objets.map((o) => <option key={o.code} value={o.code}>{o.libelle}</option>)}
          </select>
        </Field>
        <Field label="Exercice concerné" required><NumberInput value={f.annee} min={2000} max={2100} onChange={(v) => setF({ ...f, annee: v })} /></Field>
      </div>
      <Field label="Intitulé de la campagne" required><input className="input" value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} /></Field>
      <Field label="Échéance de retour" required error={f.echeance && f.echeance < aujourdhui() ? 'L’échéance est passée.' : undefined}>
        <input type="date" className="input" value={f.echeance} onChange={(e) => setF({ ...f, echeance: e.target.value })} />
      </Field>
      <Field label="Instructions aux services" hint="Reprises en tête du modèle Excel.">
        <textarea className="input" rows={3} value={f.instructions || ''} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-800">Services ciblés <span className="text-red-700">*</span> ({f.services.length})</legend>
        <div className="mb-2 flex gap-3 text-xs">
          <button type="button" className="link" onClick={() => setF({ ...f, services: services.map((s) => s.id) })}>Tous</button>
          <button type="button" className="link" onClick={() => setF({ ...f, services: [] })}>Aucun</button>
        </div>
        <div className="grid max-h-56 gap-1 overflow-y-auto rounded border border-slate-200 p-2 sm:grid-cols-2">
          {services.map((s) => (
            <label key={s.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={f.services.includes(s.id)} onChange={() => basculer(s.id)} />
              <span><b>{s.sigle}</b> — {s.libelle}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </FormModal>
  );
}
