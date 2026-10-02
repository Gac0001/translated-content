import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { ErrorAlert, InfoAlert, PageHeader, toast } from '../components/ui';
import PasswordRules from '../components/PasswordRules';

const schema = z.object({
  currentPassword: z.string().min(1, 'Obligatoire'),
  newPassword: z.string().min(8, 'Au moins 8 caractères'),
  confirm: z.string(),
}).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Les deux mots de passe ne correspondent pas.' });

export default function ChangePassword({ embarque = false, onDone }) {
  const { user, setSession } = useAuth();
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  const onSubmit = async (v) => {
    setError(null);
    try {
      const r = await api.post('/auth/change-password', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      setSession(r.data.accessToken, r.data.user);
      toast.success('Mot de passe modifié avec succès.');
      if (onDone) onDone(r.data.user); else navigate('/', { replace: true });
    } catch (e) { setError(errorMessage(e)); }
  };
  const content = (
    <form onSubmit={handleSubmit(onSubmit)} className={embarque ? "max-w-lg space-y-4" : "card max-w-lg space-y-4 p-6"} noValidate>
      {user?.mustChangePassword && <InfoAlert tone="warning">{user.mdpExpire ? 'Votre mot de passe a expiré.' : 'Vous utilisez un mot de passe temporaire.'} Vous devez le remplacer avant d’accéder à l’application.</InfoAlert>}
      <ErrorAlert message={error} />
      {[['currentPassword', 'Mot de passe actuel', 'current-password'], ['newPassword', 'Nouveau mot de passe', 'new-password'], ['confirm', 'Confirmation du nouveau mot de passe', 'new-password']].map(([k, l, ac]) => (
        <div key={k}>
          <label className="label" htmlFor={k}>{l}</label>
          <input id={k} type="password" className="input" autoComplete={ac} {...register(k)} />
          {errors[k] && <p className="mt-1 text-xs text-red-700">{errors[k].message}</p>}
        </div>
      ))}
      <PasswordRules />
      <button className="btn-primary" disabled={isSubmitting}><KeyRound size={16} /> Enregistrer le nouveau mot de passe</button>
    </form>
  );
  if (embarque) return content;
  if (user?.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-lg"><h1 className="mb-4 text-xl font-semibold">Changement obligatoire du mot de passe</h1>{content}</div>
      </div>
    );
  }
  return <><PageHeader title="Changer le mot de passe" breadcrumb={[{ label: 'Mot de passe' }]} />{content}</>;
}
