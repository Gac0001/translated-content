import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, KeyRound, LogIn, Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { DEP_NOM, SG_NOM } from '../lib/labels';
import { ErrorAlert, InfoAlert } from '../components/ui';
import PasswordRules from '../components/PasswordRules';

const schema = z.object({
  username: z.string().trim().min(1, 'Saisissez votre nom d’utilisateur.'),
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});

/** Second facteur : code de l’application, ou code de secours. */
function SecondFacteur({ defi, onSession, onAnnuler }) {
  const [secours, setSecours] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const valider = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { onSession((await api.post('/auth/login/deux-facteurs', { defi, code })).data); } catch (x) {
      setError(errorMessage(x, 'Code incorrect.'));
      if (['DEFI_EXPIRE', 'COMPTE_VERROUILLE'].includes(x.response?.data?.error?.code)) setTimeout(onAnnuler, 2500);
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={valider} className="card space-y-4 p-6" noValidate>
      <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} className="text-dep-700" /> Double authentification</h2>
      <ErrorAlert message={error} />
      <p className="text-sm text-slate-600">{secours ? 'Saisissez l’un de vos codes de secours (format XXXX-XXXX). Il ne pourra plus être réutilisé.' : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.'}</p>
      <div>
        <label className="label" htmlFor="code">{secours ? 'Code de secours' : 'Code de vérification'}</label>
        {secours
          ? <input id="code" className="input font-mono text-lg uppercase tracking-widest" autoFocus maxLength={9} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          : <input id="code" className="input font-mono text-lg tracking-widest" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
      </div>
      <button type="submit" className="btn-primary w-full py-2.5" disabled={busy || (secours ? code.replace(/-/g, '').length !== 8 : code.length !== 6)}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} Valider
      </button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="text-dep-700 hover:underline" onClick={onAnnuler}><ArrowLeft size={14} className="inline" /> Retour</button>
        <button type="button" className="text-dep-700 hover:underline" onClick={() => { setSecours((v) => !v); setCode(''); }}>{secours ? 'Utiliser l’application' : 'Téléphone indisponible ? Code de secours'}</button>
      </div>
    </form>
  );
}

/** Mot de passe oublié : code envoyé à l’adresse de récupération vérifiée, puis second facteur. */
function Recuperation({ onFin }) {
  const [etape, setEtape] = useState(1);
  const [f, setF] = useState({ username: '', code: '', codeDeuxFacteurs: '', nouveauMotDePasse: '', confirmation: '' });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const demander = async (e) => {
    e.preventDefault(); setError(null);
    try { setMsg((await api.post('/auth/recuperation/demander', { username: f.username })).data.message); setEtape(2); } catch (x) { setError(errorMessage(x)); }
  };
  const confirmer = async (e) => {
    e.preventDefault(); setError(null);
    if (f.nouveauMotDePasse !== f.confirmation) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    try {
      const r = await api.post('/auth/recuperation/confirmer', { username: f.username, code: f.code, codeDeuxFacteurs: f.codeDeuxFacteurs || undefined, nouveauMotDePasse: f.nouveauMotDePasse });
      onFin(r.data.message);
    } catch (x) { setError(errorMessage(x)); }
  };
  return (
    <form onSubmit={etape === 1 ? demander : confirmer} className="card space-y-4 p-6" noValidate>
      <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound size={20} className="text-dep-700" /> Mot de passe oublié</h2>
      <ErrorAlert message={error} />
      {etape === 1 ? (
        <>
          <p className="text-sm text-slate-600">Un code de récupération est envoyé à l’adresse de récupération vérifiée du compte. Les agents sans adresse de récupération s’adressent à l’Admin Système.</p>
          <div><label className="label" htmlFor="r-user">Nom d’utilisateur</label><input id="r-user" className="input" autoFocus value={f.username} onChange={up('username')} /></div>
          <button className="btn-primary w-full" disabled={!f.username.trim()}>Recevoir un code</button>
        </>
      ) : (
        <>
          <InfoAlert>{msg}</InfoAlert>
          <div><label className="label" htmlFor="r-code">Code reçu par e-mail</label><input id="r-code" className="input font-mono tracking-widest" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.replace(/\D/g, '') }))} /></div>
          <div><label className="label" htmlFor="r-2fa">Code de l’application d’authentification (ou code de secours)</label><input id="r-2fa" className="input font-mono" autoComplete="one-time-code" value={f.codeDeuxFacteurs} onChange={up('codeDeuxFacteurs')} /><p className="mt-1 text-xs text-slate-500">Obligatoire si la double authentification est active sur le compte.</p></div>
          <div><label className="label" htmlFor="r-n">Nouveau mot de passe</label><input id="r-n" type="password" className="input" autoComplete="new-password" value={f.nouveauMotDePasse} onChange={up('nouveauMotDePasse')} /></div>
          <div><label className="label" htmlFor="r-c">Confirmation</label><input id="r-c" type="password" className="input" autoComplete="new-password" value={f.confirmation} onChange={up('confirmation')} /></div>
          <PasswordRules />
          <button className="btn-primary w-full" disabled={f.code.length !== 6 || !f.nouveauMotDePasse}>Réinitialiser le mot de passe</button>
        </>
      )}
      <button type="button" className="text-sm text-dep-700 hover:underline" onClick={() => onFin(null)}><ArrowLeft size={14} className="inline" /> Retour à la connexion</button>
    </form>
  );
}

export default function Login() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [defi, setDefi] = useState(null);
  const [recup, setRecup] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();

  const ouvrir = (data) => {
    setSession(data.accessToken, data.user);
    if (data.user.exigences?.length) navigate('/premiere-connexion', { replace: true });
    else navigate(location.state?.from || '/', { replace: true });
  };
  const onSubmit = async (values) => {
    setError(null); setInfo(null);
    try {
      const r = await api.post('/auth/login', values);
      if (r.data.deuxFacteurs) setDefi(r.data.defi); else ouvrir(r.data);
    } catch (e) {
      setError(errorMessage(e, 'Connexion impossible.'));
    }
  };

  let contenu;
  if (defi) contenu = <SecondFacteur defi={defi} onSession={ouvrir} onAnnuler={() => setDefi(null)} />;
  else if (recup) contenu = <Recuperation onFin={(m) => { setRecup(false); setInfo(m); }} />;
  else {
    contenu = (
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6" noValidate>
        <h2 className="text-lg font-semibold">Connexion</h2>
        {location.state?.message && !error && <InfoAlert tone="warning">{location.state.message}</InfoAlert>}
        {info && <InfoAlert>{info}</InfoAlert>}
        <ErrorAlert message={error} />
        <div>
          <label className="label" htmlFor="username">Nom d’utilisateur</label>
          <input id="username" className="input" autoComplete="username" autoFocus aria-invalid={errors.username ? true : undefined} aria-describedby={errors.username ? 'username-erreur' : undefined} {...register('username')} />
          {errors.username && <p id="username-erreur" className="mt-1 text-xs text-red-700">{errors.username.message}</p>}
        </div>
        <div>
          <label className="label" htmlFor="password">Mot de passe</label>
          <div className="relative">
            <input id="password" type={show ? 'text' : 'password'} className="input pr-10" autoComplete="current-password" aria-invalid={errors.password ? true : undefined} aria-describedby={errors.password ? 'password-erreur' : undefined} {...register('password')} />
            <button type="button" className="absolute right-2 top-2 text-slate-500" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {errors.password && <p id="password-erreur" className="mt-1 text-xs text-red-700">{errors.password.message}</p>}
        </div>
        <button type="submit" className="btn-primary w-full py-2.5" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} Se connecter
        </button>
        <div className="text-center"><button type="button" className="text-sm text-dep-700 hover:underline" onClick={() => { setRecup(true); setError(null); }}>Mot de passe oublié ?</button></div>
        <p className="text-center text-xs text-slate-500">Accès réservé au personnel autorisé. Toutes les opérations sont journalisées.</p>
      </form>
    );
  }

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
          {contenu}
        </div>
      </div>
    </div>
  );
}
