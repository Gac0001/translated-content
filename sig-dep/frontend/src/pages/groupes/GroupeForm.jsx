import { useState } from 'react';
import { FormModal, Field } from '../../components/ui';
import { aujourdhui } from '../../lib/format';

/** Création ou modification d’un groupe de travail. */
export default function GroupeForm({ initial, onClose, onSubmit }) {
  const [f, setF] = useState(initial || { nom: '', objet: '', acte_reference: '', date_debut: aujourdhui(), date_fin: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.nom.trim().length >= 3 && f.objet.trim().length >= 10 && f.acte_reference.trim().length >= 3 && f.date_debut;
  return (
    <FormModal open title={initial ? 'Modifier le groupe de travail' : 'Nouveau groupe de travail'} onClose={onClose} dirty disabled={!ok}
      onSubmit={() => onSubmit({ ...f, date_fin: f.date_fin || null })}>
      <Field label="Nom" required hint="Ex. Cellule Genre, Commission de la stratégie sectorielle"><input className="input" value={f.nom} onChange={up('nom')} /></Field>
      <Field label="Objet" required><textarea className="input" rows={3} value={f.objet} onChange={up('objet')} /></Field>
      <Field label="Acte ou décision de création" required hint="Référence officielle (note de service, décision du Directeur…)"><input className="input" value={f.acte_reference} onChange={up('acte_reference')} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date de début" required><input type="date" className="input" value={f.date_debut} onChange={up('date_debut')} /></Field>
        <Field label="Date de fin" hint="Facultative"><input type="date" className="input" value={f.date_fin || ''} onChange={up('date_fin')} /></Field>
      </div>
    </FormModal>
  );
}
