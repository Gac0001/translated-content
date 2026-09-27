import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { Modal, Field, InfoAlert, runAction } from '../../components/ui';

const schema = z.object({
  code: z.string().trim().min(2, 'Code requis (2 caractères minimum)').max(20, '20 caractères au maximum'),
  nom: z.string().trim().min(3, 'Intitulé requis'),
  missions: z.string().max(5000).optional(),
  rattachement: z.enum(['DIVISION', 'DIRECTION']).optional(),
  division_id: z.string().optional(),
});

/**
 * Création / modification d’une Division ou d’un Bureau.
 * type : 'division' | 'bureau' ; structure : ligne existante (modification) ; divisions : liste pour le rattachement.
 */
export default function StructureModal({ type, structure, divisions = [], defaultDivisionId, onClose, onSaved }) {
  const secretariat = !!structure?.estSecretariatDirection;
  const initialRatt = structure ? structure.rattachement?.parentType || 'DIVISION' : (defaultDivisionId ? 'DIVISION' : 'DIRECTION');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      code: structure?.code || '', nom: structure?.nom || '', missions: structure?.missions || '',
      rattachement: initialRatt, division_id: String(structure?.rattachement?.divisionId || defaultDivisionId || ''),
    },
  });
  const ratt = watch('rattachement');
  const submit = async (v) => {
    if (type === 'bureau' && v.rattachement === 'DIVISION' && !v.division_id) return;
    const body = type === 'division'
      ? { code: v.code, nom: v.nom, missions: v.missions || null }
      : { code: v.code, nom: v.nom, missions: v.missions || null, rattachement: v.rattachement, division_id: v.rattachement === 'DIVISION' ? Number(v.division_id) : null };
    const base = type === 'division' ? '/organisation/divisions' : '/organisation/bureaux';
    await runAction(() => (structure ? api.put(`${base}/${structure.id}`, body) : api.post(base, body)), structure ? 'Structure modifiée.' : 'Structure créée avec ses postes organiques.');
    onSaved();
  };
  const titre = `${structure ? 'Modifier' : 'Nouveau'}${type === 'division' ? (structure ? ' la Division' : 'lle Division') : (structure ? ' le Bureau' : ' Bureau')}`;
  return (
    <Modal open title={titre} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button form="structure-form" className="btn-primary" disabled={isSubmitting}>Enregistrer</button></>}>
      <form id="structure-form" onSubmit={handleSubmit(submit)} className="space-y-3" noValidate>
        {type === 'bureau' && (
          <InfoAlert>Quel que soit son rattachement, la structure garde le <b>rang de Bureau</b> et son responsable le titre de Chef de Bureau. Le rattachement ne détermine que son supérieur direct.</InfoAlert>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Code" error={errors.code?.message} required><input className="input uppercase" {...register('code')} /></Field>
          <Field label="Intitulé" error={errors.nom?.message} required className="sm:col-span-2"><input className="input" {...register('nom')} /></Field>
        </div>
        {type === 'bureau' && (
          <div className="space-y-3">
            <Field label="Rattachement hiérarchique" required hint={secretariat ? 'Le Bureau Secrétariat de Direction reste rattaché au Directeur.' : undefined}>
              <select className="input" disabled={secretariat} {...register('rattachement')}>
                <option value="DIVISION">Rattaché à une Division (supérieur : Chef de Division)</option>
                <option value="DIRECTION">Rattaché directement au Directeur</option>
              </select>
            </Field>
            {ratt === 'DIVISION' && (
              <Field label="Division de rattachement" required error={watch('division_id') ? null : 'Choisissez la Division'}>
                <select className="input" {...register('division_id')}><option value="">— Choisir —</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}</select>
              </Field>
            )}
          </div>
        )}
        <Field label="Missions"><textarea className="input" rows={4} {...register('missions')} /></Field>
        {!structure && <p className="text-xs text-slate-500">Les postes organiques ({type === 'division' ? 'Chef de Division' : 'Chef de Bureau et Agent'}) sont créés automatiquement.</p>}
      </form>
    </Modal>
  );
}
