import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save, Send } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, Card, Field, runAction, InfoAlert, UnsavedChangesGuard } from '../../components/ui';
import { aujourdhui } from '../../lib/format';

const schema = z.object({
  destinataire_user_id: z.string().min(1, 'Choisissez le destinataire'),
  objet: z.string().trim().min(3, 'Objet requis (3 caractères minimum)'),
  contenu: z.string().trim().min(3, 'Contenu requis'),
  priorite: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']),
  echeance: z.string().optional(),
});

export default function InstructionForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const parentId = params.get('parent');
  const courrierId = params.get('courrier');
  const user = useAuth((s) => s.user);
  const dest = useApi('/instructions/destinataires');
  const parent = useApi(parentId ? `/instructions/${parentId}` : null);
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting, dirtyFields, isSubmitSuccessful } } = useForm({ resolver: zodResolver(schema), defaultValues: { priorite: 'NORMALE' } });
  const [exceptionnelle, setExceptionnelle] = useState(false);
  const [justification, setJustification] = useState('');
  useEffect(() => { if (parent.data) setValue('objet', parent.data.objet); }, [parent.data, setValue]);
  const send = (brouillon) => handleSubmit(async (v) => {
    const body = { ...v, destinataire_user_id: Number(v.destinataire_user_id), echeance: v.echeance || null, brouillon, parent_id: parentId ? Number(parentId) : null, courrier_id: courrierId ? Number(courrierId) : null };
    if (exceptionnelle) Object.assign(body, { exceptionnelle: true, justification_exception: justification.trim() });
    const r = await runAction(() => api.post('/instructions', body), brouillon ? 'Brouillon enregistré.' : 'Instruction transmise.');
    navigate(`/instructions/${r.data.id}`);
  });
  const list = dest.data?.data || [];
  const exceptionnels = dest.data?.exceptionnels || [];
  const choisi = exceptionnelle ? exceptionnels.find((n) => String(n.userId) === watch('destinataire_user_id')) : null;
  return (
    <>
      <UnsavedChangesGuard when={Object.keys(dirtyFields).length > 0 && !isSubmitting && !isSubmitSuccessful} />
      <PageHeader title={parentId ? 'Décliner l’instruction' : 'Nouvelle instruction'} breadcrumb={[{ label: 'Instructions', to: '/instructions' }, { label: 'Nouvelle' }]} />
      <div className="space-y-4">
        {user.primaryRole === 'SECRETAIRE_GENERAL' && <InfoAlert>Toute instruction du Secrétaire Général est obligatoirement adressée au Directeur de la DEP.</InfoAlert>}
        {parent.data && <InfoAlert>Déclinaison de l’instruction <b>{parent.data.reference}</b> — {parent.data.objet}</InfoAlert>}
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
          <Card title="Instruction">
            <div className="grid gap-4 sm:grid-cols-2">
              {exceptionnels.length > 0 && !parentId && (
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="mt-0.5" checked={exceptionnelle} onChange={(e) => { setExceptionnelle(e.target.checked); setValue('destinataire_user_id', ''); }} />
                  <span><b>Instruction exceptionnelle</b> : adresser directement l’instruction à un agent qui n’est pas votre subordonné direct. Une justification est obligatoire ; son supérieur immédiat reçoit automatiquement une copie.</span>
                </label>
              )}
              <Field label={exceptionnelle ? 'Destinataire (tout agent de la Direction)' : 'Destinataire (subordonné direct)'} error={errors.destinataire_user_id?.message} required className="sm:col-span-2"
                hint={exceptionnelle ? (choisi ? `Copie automatique à : ${choisi.superieur || 'aucun supérieur en fonction'}` : 'Le supérieur immédiat du destinataire recevra une copie.') : 'Seuls vos subordonnés directs dans la chaîne hiérarchique sont proposés.'}>
                <select className="input" {...register('destinataire_user_id')}>
                  <option value="">— Choisir —</option>
                  {(exceptionnelle ? exceptionnels : list).map((d) => <option key={d.userId} value={d.userId}>{d.nomComplet} — {d.roleLibelle} · {d.structure}</option>)}
                </select>
              </Field>
              {exceptionnelle && (
                <Field label="Justification de l’exception" required className="sm:col-span-2" hint="10 caractères au moins ; elle figure sur l’instruction, dans la copie et dans le journal d’audit.">
                  <textarea className="input" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
                </Field>
              )}
              <Field label="Objet" error={errors.objet?.message} required className="sm:col-span-2"><input className="input" {...register('objet')} /></Field>
              <Field label="Contenu" error={errors.contenu?.message} required className="sm:col-span-2"><textarea className="input" rows={8} {...register('contenu')} /></Field>
              <Field label="Priorité" required><select className="input" {...register('priorite')}><option value="BASSE">Basse</option><option value="NORMALE">Normale</option><option value="HAUTE">Haute</option><option value="URGENTE">Urgente</option></select></Field>
              <Field label="Échéance"><input type="date" className="input" min={aujourdhui()} {...register('echeance')} /></Field>
            </div>
          </Card>
          <p className="text-sm text-slate-600">Les pièces jointes peuvent être ajoutées depuis la fiche de l’instruction.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={isSubmitting || (exceptionnelle && justification.trim().length < 10)} onClick={send(false)}><Send size={16} /> Transmettre</button>
            <button type="button" className="btn-secondary" disabled={isSubmitting} onClick={send(true)}><Save size={16} /> Enregistrer comme brouillon</button>
          </div>
        </form>
      </div>
    </>
  );
}
