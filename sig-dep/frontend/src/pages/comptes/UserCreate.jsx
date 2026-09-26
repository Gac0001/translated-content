import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, Card, Field, InfoAlert, runAction, Tabs } from '../../components/ui';
import TempPassword from './TempPassword';

const username = z.string().trim().toLowerCase().min(3, 'Au moins 3 caractères').regex(/^[a-z0-9._-]+$/, 'Minuscules, chiffres, point ou tiret uniquement');

const depSchema = z.object({ agent_id: z.string().min(1, 'Choisissez l’Agent'), username, role: z.enum(['CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT']) });
const initSchema = z.object({
  type: z.enum(['SECRETAIRE_GENERAL', 'DIRECTEUR']), username, matricule: z.string().trim().min(2, 'Matricule requis'),
  nom: z.string().trim().min(2, 'Nom requis'), postnom: z.string().optional(), prenom: z.string().optional(), sexe: z.enum(['M', 'F']),
  email: z.union([z.email('Adresse invalide'), z.literal('')]).optional(), telephone: z.string().optional(), date_prise_fonction: z.string().optional(),
});

function DepAccount({ onCreated }) {
  const can = useAuth((s) => s.can);
  const [params] = useSearchParams();
  const agents = useApi('/agents');
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(depSchema), defaultValues: { agent_id: params.get('agent') || '', role: 'AGENT' } });
  const eligibles = (agents.data?.data || []).filter((a) => !a.user_id && a.niveau && a.niveau !== 'DIRECTION');
  const agentId = watch('agent_id');
  const sel = eligibles.find((a) => String(a.id) === agentId);
  const suggest = (a) => `${(a.prenom || '').split(' ')[0]}.${a.nom}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]/g, '');
  const submit = async (v) => {
    const r = await runAction(() => api.post('/users', { agent_id: Number(v.agent_id), username: v.username, roles: [v.role] }));
    onCreated(r.data);
  };
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      {!can('comptes.creer') && <InfoAlert tone="warning">Vous préparez ce compte sur délégation du Directeur : il restera désactivé jusqu’à son autorisation par le Directeur.</InfoAlert>}
      <Card title="Compte d’un Agent de la DEP">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agent (affecté, sans compte)" error={errors.agent_id?.message} required className="sm:col-span-2">
            <select className="input" {...register('agent_id', { onChange: (e) => { const a = eligibles.find((x) => String(x.id) === e.target.value); if (a) { setValue('username', suggest(a)); setValue('role', a.role_associe === 'CHEF_BUREAU' ? 'CHEF_BUREAU' : a.role_associe === 'CHEF_DIVISION' ? 'CHEF_DIVISION' : 'AGENT'); } } })}>
              <option value="">— Choisir —</option>
              {eligibles.map((a) => <option key={a.id} value={a.id}>{[a.nom, a.postnom, a.prenom].filter(Boolean).join(' ')} — {a.matricule} — {a.bureau_nom || a.division_nom}</option>)}
            </select>
          </Field>
          {sel && <div className="text-sm text-slate-600 sm:col-span-2">Poste organique : <b>{sel.poste || '—'}</b> · {sel.bureau_nom || sel.division_nom}</div>}
          <Field label="Nom d’utilisateur" error={errors.username?.message} required><input className="input" {...register('username')} /></Field>
          <Field label="Rôle" required hint="Le rôle doit correspondre au poste organique de l’affectation.">
            <select className="input" {...register('role')}><option value="AGENT">Agent</option><option value="CHEF_BUREAU">Chef de Bureau</option><option value="CHEF_DIVISION">Chef de Division</option></select>
          </Field>
        </div>
      </Card>
      <button className="btn-primary" disabled={isSubmitting}><UserPlus size={16} /> {can('comptes.creer') ? 'Créer le compte' : 'Préparer le compte'}</button>
    </form>
  );
}

function InitialAccount({ onCreated }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(initSchema), defaultValues: { type: 'DIRECTEUR', sexe: 'M' } });
  const submit = async (v) => { const r = await runAction(() => api.post('/users/initial', v)); onCreated(r.data); };
  const t = (n, l, req) => <Field label={l} error={errors[n]?.message} required={req}><input className="input" {...register(n)} /></Field>;
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <InfoAlert>L’Admin crée uniquement les comptes institutionnels initiaux du Secrétaire Général et du Directeur. Les autres comptes de la DEP sont créés sous l’autorité du Directeur.</InfoAlert>
      <Card title="Compte institutionnel initial">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Autorité" required><select className="input" {...register('type')}><option value="DIRECTEUR">Directeur de la DEP</option><option value="SECRETAIRE_GENERAL">Secrétaire Général</option></select></Field>
          {t('username', 'Nom d’utilisateur', true)}{t('matricule', 'Matricule', true)}{t('nom', 'Nom', true)}{t('postnom', 'Postnom')}{t('prenom', 'Prénom')}
          <Field label="Sexe" required><select className="input" {...register('sexe')}><option value="M">Masculin</option><option value="F">Féminin</option></select></Field>
          {t('email', 'Adresse électronique')}{t('telephone', 'Téléphone')}
          <Field label="Date de prise de fonction"><input type="date" className="input" {...register('date_prise_fonction')} /></Field>
        </div>
      </Card>
      <button className="btn-primary" disabled={isSubmitting}><UserPlus size={16} /> Créer le compte</button>
    </form>
  );
}

export default function UserCreate() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const [created, setCreated] = useState(null);
  const modes = [can('comptes.creer', 'comptes.preparer') && { value: 'dep', label: 'Compte d’Agent de la DEP' }, can('comptes.creer_initial') && { value: 'initial', label: 'Compte institutionnel initial' }].filter(Boolean);
  const [mode, setMode] = useState(modes[0]?.value);
  return (
    <>
      <PageHeader title="Nouveau compte" breadcrumb={[{ label: 'Comptes', to: '/comptes' }, { label: 'Nouveau' }]} />
      {modes.length > 1 && <Tabs tabs={modes} value={mode} onChange={setMode} />}
      {mode === 'dep' && <DepAccount onCreated={setCreated} />}
      {mode === 'initial' && <InitialAccount onCreated={setCreated} />}
      <TempPassword data={created} onClose={() => { const id = created.id; setCreated(null); navigate(`/comptes/${id}`); }} />
    </>
  );
}
