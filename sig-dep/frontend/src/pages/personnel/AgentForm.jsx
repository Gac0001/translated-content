import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, Spinner } from '../../components/ui';

const schema = z.object({
  matricule: z.string().trim().min(2, 'Matricule requis'),
  nom: z.string().trim().min(2, 'Nom requis'),
  postnom: z.string().trim().optional(),
  prenom: z.string().trim().optional(),
  sexe: z.enum(['M', 'F'], { message: 'Sexe requis' }),
  date_naissance: z.string().optional(),
  grade_id: z.string().optional(),
  fonction_id: z.string().optional(),
  telephone: z.string().trim().optional(),
  email: z.union([z.email('Adresse électronique invalide'), z.literal('')]).optional(),
  adresse: z.string().trim().optional(),
  statut: z.enum(['ACTIF', 'CONGE', 'DETACHE', 'SUSPENDU', 'RETRAITE']).optional(),
});

export default function AgentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const cadre = useApi('/organisation/cadre');
  const existing = useApi(id ? `/agents/${id}` : null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { sexe: 'M', statut: 'ACTIF' } });
  useEffect(() => {
    const a = existing.data;
    if (a) reset({ matricule: a.matricule, nom: a.nom, postnom: a.postnom || '', prenom: a.prenom || '', sexe: a.sexe, date_naissance: a.date_naissance || '', grade_id: a.grade_id ? String(a.grade_id) : '', fonction_id: a.fonction_id ? String(a.fonction_id) : '', telephone: a.telephone || '', email: a.email || '', adresse: a.adresse || '', statut: a.statut === 'ARCHIVE' ? 'ACTIF' : a.statut });
  }, [existing.data, reset]);
  const submit = async (v) => {
    const body = { ...v, grade_id: v.grade_id ? Number(v.grade_id) : null, fonction_id: v.fonction_id ? Number(v.fonction_id) : null, date_naissance: v.date_naissance || null };
    const r = await runAction(() => (id ? api.put(`/agents/${id}`, body) : api.post('/agents', body)), id ? 'Fiche mise à jour.' : 'Agent créé. Procédez à son affectation.');
    navigate(`/personnel/${r.data.id}`);
  };
  if (id && existing.loading) return <Spinner />;
  const text = (name, label, props = {}) => <Field label={label} error={errors[name]?.message} required={props.required}><input className="input" {...register(name)} {...props} /></Field>;
  return (
    <>
      <PageHeader title={id ? 'Modifier la fiche Agent' : 'Nouvel Agent'} breadcrumb={[{ label: 'Personnel', to: '/personnel' }, { label: id ? 'Modification' : 'Nouvel Agent' }]} />
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <Card title="Identité">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {text('matricule', 'Matricule', { required: true })}
            {text('nom', 'Nom', { required: true })}
            {text('postnom', 'Postnom')}
            {text('prenom', 'Prénom')}
            <Field label="Sexe" required><select className="input" {...register('sexe')}><option value="M">Masculin</option><option value="F">Féminin</option></select></Field>
            <Field label="Date de naissance"><input type="date" className="input" {...register('date_naissance')} /></Field>
          </div>
        </Card>
        <Card title="Carrière et contacts">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Grade"><select className="input" {...register('grade_id')}><option value="">—</option>{(cadre.data?.grades || []).map((g) => <option key={g.id} value={g.id}>{g.libelle}</option>)}</select></Field>
            <Field label="Fonction"><select className="input" {...register('fonction_id')}><option value="">—</option>{(cadre.data?.fonctions || []).map((f) => <option key={f.id} value={f.id}>{f.libelle}{f.grade_libelle ? ` (${f.grade_libelle})` : ''}</option>)}</select></Field>
            <Field label="Statut"><select className="input" {...register('statut')}><option value="ACTIF">Actif</option><option value="CONGE">En congé</option><option value="DETACHE">Détaché</option><option value="SUSPENDU">Suspendu</option><option value="RETRAITE">Retraité</option></select></Field>
            {text('telephone', 'Téléphone')}
            {text('email', 'Adresse électronique', { type: 'email' })}
            {text('adresse', 'Adresse')}
          </div>
        </Card>
        <div className="flex gap-2"><button className="btn-primary" disabled={isSubmitting}><Save size={16} /> Enregistrer</button><button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Annuler</button></div>
      </form>
    </>
  );
}
