import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn, Loader2, Eye, EyeOff } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { DEP_NOM, SG_NOM } from '../lib/labels';
import { ErrorAlert, InfoAlert } from '../components/ui';

const schema = z.object({
  username: z.string().trim().min(1, 'Saisissez votre nom d’utilisateur.'),
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});

export default function Login() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();

  const onSubmit = async (values) => {
    setError(null);
    try {
      const r = await api.post('/auth/login', values);
      setSession(r.data.accessToken, r.data.user);
      if (r.data.user.mustChangePassword) navigate('/changer-mot-de-passe', { replace: true });
      else navigate(location.state?.from || '/', { replace: true });
    } catch (e) {
      setError(errorMessage(e, 'Connexion impossible.'));
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-dep-800 via-dep-700 to-dep-900">
      <div className="h-1.5 tricolore" />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center text-white">
            <div className="text-xs uppercase tracking-[0.2em] text-dep-200">République Démocratique du Congo</div>
            <div className="mt-1 text-sm text-dep-100">{SG_NOM}</div>
            <h1 className="mt-3 text-2xl font-semibold text-white">{DEP_NOM}</h1>
            <div className="mt-1 text-sm text-dep-200">SIG-DEP — Système Intégré de Gestion</div>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6" noValidate>
            <h2 className="text-lg font-semibold">Connexion</h2>
            {location.state?.message && !error && <InfoAlert tone="warning">{location.state.message}</InfoAlert>}
            <ErrorAlert message={error} />
            <div>
              <label className="label" htmlFor="username">Nom d’utilisateur</label>
              <input id="username" className="input" autoComplete="username" autoFocus {...register('username')} />
              {errors.username && <p className="mt-1 text-xs text-red-700">{errors.username.message}</p>}
            </div>
            <div>
              <label className="label" htmlFor="password">Mot de passe</label>
              <div className="relative">
                <input id="password" type={show ? 'text' : 'password'} className="input pr-10" autoComplete="current-password" {...register('password')} />
                <button type="button" className="absolute right-2 top-2 text-slate-500" onClick={() => setShow((v) => !v)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-700">{errors.password.message}</p>}
            </div>
            <button type="submit" className="btn-primary w-full py-2.5" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} Se connecter
            </button>
            <p className="text-center text-xs text-slate-500">Accès réservé au personnel autorisé. Toutes les opérations sont journalisées.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
