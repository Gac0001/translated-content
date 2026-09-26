import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, InfoAlert } from '../../components/ui';

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
  const agents = useApi('/taches/agents');
  const ins = useApi(instructionId ? `/instructions/${instructionId}` : null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { priorite: 'NORMALE', date_debut: new Date().toISOString().slice(0, 10) } });
  const submit = async (v) => {
    const r = await runAction(() => api.post('/taches', { ...v, agent_user_id: Number(v.agent_user_id), date_debut: v.date_debut || null, echeance: v.echeance || null, instruction_id: instructionId ? Number(instructionId) : null }), 'Tâche attribuée.');
    navigate(`/taches/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title="Attribuer une tâche" breadcrumb={[{ label: 'Tâches', to: '/taches' }, { label: 'Nouvelle' }]} />
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {ins.data && <InfoAlert>Tâche liée à l’instruction <b>{ins.data.reference}</b> — {ins.data.objet}</InfoAlert>}
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
        <button className="btn-primary" disabled={isSubmitting}><Send size={16} /> Attribuer</button>
      </form>
    </>
  );
}
