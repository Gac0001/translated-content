import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction } from '../../components/ui';

const schema = z.object({
  sens: z.enum(['ENTRANT', 'SORTANT']),
  reference_externe: z.string().trim().max(120).optional(),
  expediteur: z.string().trim().min(2, 'Expéditeur requis'),
  destinataire: z.string().trim().min(2, 'Destinataire requis'),
  objet: z.string().trim().min(3, 'Objet requis (3 caractères minimum)'),
  date_courrier: z.string().min(10, 'Date requise'),
  urgence: z.enum(['NORMAL', 'URGENT', 'TRES_URGENT']),
  confidentialite: z.enum(['ORDINAIRE', 'CONFIDENTIEL', 'SECRET']),
  resume: z.string().max(10000).optional(),
  classement: z.string().max(120).optional(),
});

export default function CourrierForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useApi(id ? `/courriers/${id}` : null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { sens: 'ENTRANT', urgence: 'NORMAL', confidentialite: 'ORDINAIRE', date_courrier: new Date().toISOString().slice(0, 10), destinataire: 'Directeur de la Direction d’Études et Planification' } });
  useEffect(() => { const c = existing.data; if (c) reset({ ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])) }); }, [existing.data, reset]);
  const submit = async (v) => {
    const body = { ...v };
    if (id) delete body.sens;
    const r = await runAction(() => (id ? api.put(`/courriers/${id}`, body) : api.post('/courriers', body)), id ? 'Courrier mis à jour.' : 'Courrier enregistré.');
    navigate(`/courriers/${r.data.id}`);
  };
  const t = (n, l, req, ph) => <Field label={l} error={errors[n]?.message} required={req}><input className="input" placeholder={ph} {...register(n)} /></Field>;
  return (
    <>
      <PageHeader title={id ? 'Modifier le courrier' : 'Enregistrer un courrier'} subtitle="Le numéro d’enregistrement est attribué automatiquement." breadcrumb={[{ label: 'Courriers', to: '/courriers' }, { label: id ? 'Modification' : 'Nouveau' }]} />
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <Card title="Identification">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Sens" required><select className="input" disabled={!!id} {...register('sens')}><option value="ENTRANT">Courrier entrant</option><option value="SORTANT">Courrier sortant</option></select></Field>
            <Field label="Date du courrier" error={errors.date_courrier?.message} required><input type="date" className="input" {...register('date_courrier')} /></Field>
            {t('reference_externe', 'Référence du courrier', false, 'N° / réf. de l’expéditeur')}
            {t('expediteur', 'Expéditeur', true)}
            {t('destinataire', 'Destinataire', true)}
            <Field label="Degré d’urgence" required><select className="input" {...register('urgence')}><option value="NORMAL">Normal</option><option value="URGENT">Urgent</option><option value="TRES_URGENT">Très urgent</option></select></Field>
            <Field label="Objet" error={errors.objet?.message} required className="sm:col-span-2 lg:col-span-3"><input className="input" {...register('objet')} /></Field>
            <Field label="Niveau de confidentialité" required hint="Un courrier confidentiel n’est visible que des personnes de sa chaîne de transmission, du Directeur et du Secrétaire Général."><select className="input" {...register('confidentialite')}><option value="ORDINAIRE">Ordinaire</option><option value="CONFIDENTIEL">Confidentiel</option><option value="SECRET">Secret</option></select></Field>
            {t('classement', 'Code de classement', false, 'Ex. : ADM/2026')}
            <Field label="Résumé" className="sm:col-span-2 lg:col-span-3"><textarea className="input" rows={4} {...register('resume')} /></Field>
          </div>
        </Card>
        <p className="text-sm text-slate-500">Les pièces jointes (courrier numérisé) s’ajoutent depuis la fiche du courrier après l’enregistrement.</p>
        <div className="flex gap-2"><button className="btn-primary" disabled={isSubmitting}><Save size={16} /> Enregistrer</button><button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Annuler</button></div>
      </form>
    </>
  );
}
