import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, InfoAlert, UnsavedChangesGuard } from '../../components/ui';
import { aujourdhui } from '../../lib/format';
import { useAuth } from '../../store/auth';

const TERMINES = ['VALIDEE', 'CLOTUREE', 'ANNULEE'];

const schema = z.object({
  agent_user_id: z.string().min(1, 'Choisissez l’Agent'),
  titre: z.string().trim().min(3, 'Titre requis'),
  description: z.string().optional(),
  priorite: z.enum(['BASSE', 'NORMALE', 'HAUTE', 'URGENTE']),
  date_debut: z.string().optional(),
  echeance: z.string().optional(),
}).refine((v) => !v.date_debut || !v.echeance || v.echeance >= v.date_debut, { path: ['echeance'], message: 'L’échéance précède la date de début.' });

export default function TacheForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const instructionId = params.get('instruction');
  const parentId = params.get('parent');
  const user = useAuth((s) => s.user);
  const agents = useApi('/taches/agents');
  const ins = useApi(instructionId ? `/instructions/${instructionId}` : null);
  const parent = useApi(parentId ? `/taches/${parentId}` : null);
  const mesTaches = useApi('/taches');
  const [dependDe, setDependDe] = useState([]);
  const candidates = (mesTaches.data?.data || []).filter((t) => t.assigne_par_user_id === user.id && !TERMINES.includes(t.statut) && String(t.id) !== parentId);
  const { register, handleSubmit, formState: { errors, isSubmitting, dirtyFields, isSubmitSuccessful } } = useForm({ resolver: zodResolver(schema), defaultValues: { priorite: 'NORMALE', date_debut: aujourdhui() } });
  const submit = async (v) => {
    const r = await runAction(() => api.post('/taches', { ...v, agent_user_id: Number(v.agent_user_id), date_debut: v.date_debut || null, echeance: v.echeance || null, instruction_id: instructionId ? Number(instructionId) : (parent.data?.instruction_id || null), parent_task_id: parentId ? Number(parentId) : null, depend_de: dependDe }), parentId ? 'Sous-tâche attribuée.' : 'Tâche attribuée.');
    navigate(`/taches/${r.data.id}`);
  };
  return (
    <>
      <UnsavedChangesGuard when={(Object.keys(dirtyFields).length > 0 || dependDe.length > 0) && !isSubmitting && !isSubmitSuccessful} />
      <PageHeader title={parentId ? 'Attribuer une sous-tâche' : 'Attribuer une tâche'} breadcrumb={[{ label: 'Tâches', to: '/taches' }, { label: 'Nouvelle' }]} />
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {ins.data && <InfoAlert>Tâche liée à l’instruction <b>{ins.data.reference}</b> — {ins.data.objet}</InfoAlert>}
        {parent.data && <InfoAlert>Sous-tâche de <b>{parent.data.reference}</b> — {parent.data.titre}{parent.data.echeance ? ` (échéance de la tâche parente : ${parent.data.echeance.split('-').reverse().join('/')})` : ''}. La tâche parente ne pourra être rendue qu’une fois ses sous-tâches exécutées.</InfoAlert>}
        <Card title="Tâche">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agent du Bureau" error={errors.agent_user_id?.message} required className="sm:col-span-2" hint="Seuls les Agents de votre Bureau sont proposés.">
              <select className="input" {...register('agent_user_id')}><option value="">— Choisir —</option>{(agents.data?.data || []).map((a) => <option key={a.userId} value={a.userId}>{a.nomComplet}</option>)}</select>
            </Field>
            <Field label="Titre" error={errors.titre?.message} required className="sm:col-span-2"><input className="input" {...register('titre')} /></Field>
            <Field label="Description" className="sm:col-span-2"><textarea className="input" rows={6} {...register('description')} /></Field>
            <Field label="Priorité"><select className="input" {...register('priorite')}><option value="BASSE">Basse</option><option value="NORMALE">Normale</option><option value="HAUTE">Haute</option><option value="URGENTE">Urgente</option></select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Début"><input type="date" className="input" {...register('date_debut')} /></Field>
              <Field label="Échéance" error={errors.echeance?.message}><input type="date" className="input" {...register('echeance')} /></Field>
            </div>
          </div>
        </Card>
        {candidates.length > 0 && (
          <Card title="Dépendances (facultatif)">
            <p className="mb-2 text-sm text-slate-600">La tâche ne pourra avancer qu’après l’exécution des tâches cochées.</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {candidates.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={dependDe.includes(t.id)} onChange={(e) => setDependDe(e.target.checked ? [...dependDe, t.id] : dependDe.filter((x) => x !== t.id))} />
                  <span>{t.reference} — {t.titre} <span className="text-xs text-slate-500">({t.agent_nom})</span></span>
                </label>
              ))}
            </div>
          </Card>
        )}
        <button className="btn-primary" disabled={isSubmitting}><Send size={16} /> Attribuer</button>
      </form>
    </>
  );
}
