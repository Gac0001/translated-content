import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import api from '../../lib/api';
import { PageHeader, Card, Field, InfoAlert, runAction, UnsavedChangesGuard } from '../../components/ui';
import TempPassword from './TempPassword';

const username = z.string().trim().toLowerCase().min(3, 'Au moins 3 caractères').regex(/^[a-z0-9._-]+$/, 'Minuscules, chiffres, point ou tiret uniquement');

const initSchema = z.object({
  type: z.enum(['SECRETAIRE_GENERAL', 'DIRECTEUR']), username, matricule: z.string().trim().min(2, 'Matricule requis'),
  nom: z.string().trim().min(2, 'Nom requis'), postnom: z.string().optional(), prenom: z.string().optional(), sexe: z.enum(['', 'M', 'F']).optional(),
  email: z.union([z.email('Adresse invalide'), z.literal('')]).optional(), telephone: z.string().optional(), date_prise_fonction: z.string().optional(),
});

function InitialAccount({ onCreated }) {
  const { register, handleSubmit, formState: { errors, isSubmitting, dirtyFields, isSubmitSuccessful } } = useForm({ resolver: zodResolver(initSchema), defaultValues: { type: 'DIRECTEUR', sexe: '' } });
  const submit = async (v) => { const r = await runAction(() => api.post('/users/initial', v)); onCreated(r.data); };
  const t = (n, l, req) => <Field label={l} error={errors[n]?.message} required={req}><input className="input" {...register(n)} /></Field>;
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <UnsavedChangesGuard when={Object.keys(dirtyFields).length > 0 && !isSubmitting && !isSubmitSuccessful} />
      <InfoAlert>Commencez par le compte du Directeur : il valide ensuite la liste déclarative des agents de la Direction. Les comptes des agents sont créés par enrôlement, à partir de cette liste validée (l’Admin enrôle d’abord le Bureau Secrétariat de Direction, qui enrôle ensuite les agents des Divisions).</InfoAlert>
      <Card title="Compte institutionnel initial">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Autorité" required><select className="input" {...register('type')}><option value="DIRECTEUR">Directeur de la DEP</option><option value="SECRETAIRE_GENERAL">Secrétaire Général</option></select></Field>
          {t('username', 'Nom d’utilisateur', true)}{t('matricule', 'Matricule', true)}{t('nom', 'Nom', true)}{t('postnom', 'Postnom')}{t('prenom', 'Prénom')}
          <Field label="Sexe"><select className="input" {...register('sexe')}><option value="">Non renseigné</option><option value="M">Masculin</option><option value="F">Féminin</option></select></Field>
          {t('email', 'Adresse électronique')}{t('telephone', 'Téléphone')}
          <Field label="Date de prise de fonction"><input type="date" className="input" {...register('date_prise_fonction')} /></Field>
        </div>
      </Card>
      <button className="btn-primary" disabled={isSubmitting}><UserPlus size={16} /> Créer le compte</button>
    </form>
  );
}

export default function UserCreate() {
  const navigate = useNavigate();
  const [created, setCreated] = useState(null);
  return (
    <>
      <PageHeader title="Compte institutionnel" subtitle="Directeur de la DEP ou Secrétaire Général" breadcrumb={[{ label: 'Personnel et habilitations' }, { label: 'Comptes', to: '/comptes' }, { label: 'Compte institutionnel' }]}
        actions={<Link to="/comptes/enrolement" className="btn-secondary"><UserPlus size={16} /> Enrôler un agent de la DEP</Link>} />
      <InitialAccount onCreated={setCreated} />
      <TempPassword data={created} onClose={() => { const id = created.id; setCreated(null); navigate(`/comptes/${id}`); }} />
    </>
  );
}
