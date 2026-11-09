import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BarChart3, ChevronDown, ClipboardCheck, KeyRound, LogIn, Loader2, Eye, EyeOff, Lock, Mail, ShieldCheck, Presentation } from 'lucide-react';
import armoiries from '@armoiries';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { DEP_NOM, SG_NOM } from '../lib/labels';
import { ErrorAlert, InfoAlert, useTitreDocument } from '../components/ui';
import PasswordRules from '../components/PasswordRules';

const schema = z.object({
  username: z.string().trim().min(1, 'Saisissez votre nom d’utilisateur.'),
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
});

/** Armoiries du Gouvernement (image versionnée à la racine du dépôt), sur une pastille blanche. */
function Armoiries() {
  return (
    <span className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-white p-1 shadow-md">
      <img src={armoiries} width={88} height={88} decoding="async" alt="Armoiries de la République Démocratique du Congo — Le Gouvernement" className="h-full w-full object-contain" />
    </span>
  );
}

/** Démonstration : informations publiques (comptes fictifs, code de double authentification courant). */
function useDemo(actif) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!actif) return undefined;
    const lire = () => api.get('/demo').then((r) => setD(r.data)).catch(() => setD(null));
    lire();
    const t = setInterval(lire, 5000);
    return () => clearInterval(t);
  }, [actif]);
  return d;
}

/** Démonstration : comptes fictifs par fonction ; un clic remplit le formulaire. */
function ComptesDemo({ demo, onChoisir }) {
  const [ouvert, setOuvert] = useState(false);
  const [tous, setTous] = useState(false);
  // Comptes du scénario de démonstration (circuits complets), dans l’ordre de la présentation
  const principaux = ['sg', 'directeur', 'cb.secretariat', 'cd.ps', 'cb.prg', 'ag.prg1', 'cb.sev', 'ag.sev1', 'cd.edi', 'cb.eap', 'ag.doi1', 'admin'];
  const comptes = tous ? demo.comptes : principaux.map((u) => demo.comptes.find((c) => c.username === u)).filter(Boolean);
  return (
    <div className="mt-5 rounded-lg border border-dashed border-slate-300 text-sm">
      <button type="button" className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" aria-expanded={ouvert} onClick={() => setOuvert((v) => !v)}>
        <span className="flex items-center gap-2 font-semibold"><Presentation size={16} className="text-dep-700" /> Comptes de démonstration ({demo.comptes.length})</span>
        <span className="flex items-center gap-1 font-semibold text-dep-700">{ouvert ? 'Masquer' : 'Afficher'} <ChevronDown size={16} className={ouvert ? 'rotate-180' : ''} /></span>
      </button>
      {ouvert && (
        <div className="border-t border-slate-200 px-4 pb-3 pt-2">
          <p className="mb-2 text-xs text-slate-600">Mot de passe : <b className="font-mono">{demo.motDePasse}</b>. Code de double authentification (Directeur, Secrétaire Général, Admin) : <b className="font-mono text-base tracking-widest text-dep-800">{demo.code}</b> <span className="text-slate-500">({demo.secondes} s)</span></p>
          <ul className="max-h-64 divide-y overflow-y-auto">{comptes.map((c) => (
            <li key={c.username}><button type="button" className="flex w-full items-baseline justify-between gap-2 py-1 text-left hover:bg-slate-50" onClick={() => onChoisir(c.username)}>
              <span><span className="font-medium">{c.fonction}</span> <span className="text-xs text-slate-500">{c.structure}</span></span><span className="font-mono text-xs text-dep-700">{c.username}</span>
            </button></li>
          ))}</ul>
          <button type="button" className="mt-2 text-xs link" onClick={() => setTous((v) => !v)}>{tous ? 'Afficher les principaux comptes' : `Afficher les ${demo.comptes.length} comptes`}</button>
        </div>
      )}
    </div>
  );
}

/** Second facteur : code de l’application, ou code de secours. */
function SecondFacteur({ defi, onSession, onAnnuler, demo }) {
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
    <form onSubmit={valider} className="space-y-4" noValidate>
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><ShieldCheck size={20} className="text-dep-700" /> Double authentification</h2>
      <ErrorAlert message={error} />
      {demo && !secours && <InfoAlert>Démonstration : code courant <button type="button" className="font-mono font-semibold tracking-widest underline" onClick={() => setCode(demo.code)}>{demo.code}</button> (cliquez pour le saisir).</InfoAlert>}
      <p className="text-sm text-slate-600">{secours ? 'Saisissez l’un de vos codes de secours (format XXXX-XXXX). Il ne pourra plus être réutilisé.' : 'Saisissez le code à 6 chiffres affiché par votre application d’authentification.'}</p>
      <div>
        <label className="label" htmlFor="code">{secours ? 'Code de secours' : 'Code de vérification'}</label>
        {secours
          ? <input id="code" className="input font-mono text-lg uppercase tracking-widest" autoFocus maxLength={9} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          : <input id="code" className="input font-mono text-lg tracking-widest" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
      </div>
      <button type="submit" className="btn-primary w-full py-3 text-base" disabled={busy || (secours ? code.replace(/-/g, '').length !== 8 : code.length !== 6)}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} Valider
      </button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="link" onClick={onAnnuler}><ArrowLeft size={14} className="inline" /> Retour</button>
        <button type="button" className="link" onClick={() => { setSecours((v) => !v); setCode(''); }}>{secours ? 'Utiliser l’application' : 'Téléphone indisponible ? Code de secours'}</button>
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
    <form onSubmit={etape === 1 ? demander : confirmer} className="space-y-4" noValidate>
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><KeyRound size={20} className="text-dep-700" /> Mot de passe oublié</h2>
      <ErrorAlert message={error} />
      {etape === 1 ? (
        <>
          <p className="text-sm text-slate-600">Un code de récupération est envoyé à l’adresse de récupération vérifiée du compte. Les agents sans adresse de récupération s’adressent à l’Admin Système.</p>
          <div><label className="label" htmlFor="r-user">Nom d’utilisateur</label><input id="r-user" className="input" autoFocus value={f.username} onChange={up('username')} /></div>
          <button className="btn-primary w-full py-3 text-base" disabled={!f.username.trim()}>Recevoir un code</button>
        </>
      ) : (
        <>
          <InfoAlert>{msg}</InfoAlert>
          <div><label className="label" htmlFor="r-code">Code reçu par e-mail</label><input id="r-code" className="input font-mono tracking-widest" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.replace(/\D/g, '') }))} /></div>
          <div><label className="label" htmlFor="r-2fa">Code de l’application d’authentification (ou code de secours)</label><input id="r-2fa" className="input font-mono" autoComplete="one-time-code" value={f.codeDeuxFacteurs} onChange={up('codeDeuxFacteurs')} /><p className="mt-1 text-xs text-slate-500">Obligatoire si la double authentification est active sur le compte.</p></div>
          <div><label className="label" htmlFor="r-n">Nouveau mot de passe</label><input id="r-n" type="password" className="input" autoComplete="new-password" value={f.nouveauMotDePasse} onChange={up('nouveauMotDePasse')} /></div>
          <div><label className="label" htmlFor="r-c">Confirmation</label><input id="r-c" type="password" className="input" autoComplete="new-password" value={f.confirmation} onChange={up('confirmation')} /></div>
          <PasswordRules />
          <button className="btn-primary w-full py-3 text-base" disabled={f.code.length !== 6 || !f.nouveauMotDePasse}>Réinitialiser le mot de passe</button>
        </>
      )}
      <button type="button" className="text-sm link" onClick={() => onFin(null)}><ArrowLeft size={14} className="inline" /> Retour à la connexion</button>
    </form>
  );
}

export default function Login() {
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [show, setShow] = useState(false);
  const [defi, setDefi] = useState(null);
  const [recup, setRecup] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const [maintenance, setMaintenance] = useState(null);
  const [modeDemo, setModeDemo] = useState(false);
  useEffect(() => { api.get('/statut-public').then((r) => { setMaintenance(r.data.maintenance.active ? r.data.maintenance : null); setModeDemo(!!r.data.demo); }).catch(() => {}); }, []);
  const demo = useDemo(modeDemo);
  const navigate = useNavigate();
  useTitreDocument('Connexion');
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
  if (defi) contenu = <SecondFacteur defi={defi} demo={demo} onSession={ouvrir} onAnnuler={() => setDefi(null)} />;
  else if (recup) contenu = <Recuperation onFin={(m) => { setRecup(false); setInfo(m); }} />;
  else {
    contenu = (
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div className="text-center">
          <h2 className="font-display text-3xl font-bold text-accueil-titre">Connexion</h2>
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-accueil-bleu" aria-hidden />
          <p className="mt-3 text-sm text-slate-600">Accédez à votre espace de travail.</p>
        </div>
        {location.state?.message && !error && <InfoAlert tone="warning">{location.state.message}</InfoAlert>}
        {info && <InfoAlert>{info}</InfoAlert>}
        {maintenance && <InfoAlert tone="warning"><b>Maintenance en cours</b> : {maintenance.message}{maintenance.fin ? ` (fin prévue : ${maintenance.fin})` : ''}. Seuls les Admins Système peuvent se connecter.</InfoAlert>}
        <ErrorAlert message={error} />
        <div>
          <label className="label" htmlFor="username">Nom d’utilisateur</label>
          <input id="username" className="input-ligne" placeholder="Saisissez votre nom d’utilisateur…" autoComplete="username" autoFocus aria-invalid={errors.username ? true : undefined} aria-describedby={errors.username ? 'username-erreur' : undefined} {...register('username')} />
          {errors.username && <p id="username-erreur" className="mt-1 text-xs text-red-700">{errors.username.message}</p>}
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label className="label" htmlFor="password">Mot de passe</label>
            <button type="button" className="text-sm font-semibold link" onClick={() => { setRecup(true); setError(null); }}>Mot de passe oublié ?</button>
          </div>
          <div className="relative">
            <input id="password" type={show ? 'text' : 'password'} className="input-ligne pr-10" placeholder="Saisissez votre mot de passe…" autoComplete="current-password" aria-invalid={errors.password ? true : undefined} aria-describedby={errors.password ? 'password-erreur' : undefined} {...register('password')} />
            <button type="button" className="absolute right-1 top-3 rounded text-slate-600 hover:text-dep-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {errors.password && <p id="password-erreur" className="mt-1 text-xs text-red-700">{errors.password.message}</p>}
        </div>
        <div className="flex justify-center pt-1">
          <button type="submit" className="btn-pilule w-full max-w-xs bg-accueil-bleu font-bold hover:bg-dep-700" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} Se connecter
          </button>
        </div>
        <p className="flex items-start gap-2 rounded-md bg-fond-page p-3 text-xs text-slate-600"><Lock size={14} className="mt-0.5 shrink-0" /> Accès réservé au personnel autorisé, protégé par double authentification pour les fonctions sensibles. Toutes les opérations sont journalisées.</p>
      </form>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-accueil-fond">
      {/* Fond : halos flous discrets, à la place d’une photographie */}
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-white/70 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 right-[-10rem] h-[36rem] w-[36rem] rounded-full bg-dep-100/70 blur-3xl" />
      <div className="relative h-1.5 tricolore-horizontal" />
      <div className="relative flex flex-1 items-center justify-center px-3 py-6 sm:px-6 lg:py-10">
        <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] bg-[#fcfcfc] shadow-[0_24px_60px_rgba(15,75,134,0.18)] lg:grid-cols-2">
          {/* Panneau d’accueil, armoiries du Gouvernement en filigrane */}
          <section className="relative overflow-hidden bg-accueil-bleu px-6 py-7 text-white sm:px-10 lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-14">
            <img src={armoiries} alt="" aria-hidden="true" decoding="async" className="pointer-events-none absolute -left-24 top-1/2 hidden w-[30rem] max-w-none -translate-y-1/2 select-none opacity-[0.08] mix-blend-luminosity lg:block" />
            <img src={armoiries} alt="" aria-hidden="true" decoding="async" className="pointer-events-none absolute -right-10 -top-6 w-40 select-none opacity-[0.1] mix-blend-luminosity lg:hidden" />
            <div className="relative flex items-center gap-3">
              <Armoiries />
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white sm:text-xs">République Démocratique du Congo</p>
                <p className="text-sm text-white">{SG_NOM}</p>
              </div>
            </div>
            <div className="relative lg:my-10">
              <h1 className="mt-5 max-w-md font-display text-2xl font-bold leading-tight text-white sm:text-3xl lg:mt-0">Bienvenue sur le SIG-DEP</h1>
              <div className="mt-3 h-1 w-16 rounded-full bg-white" aria-hidden />
              <p className="mt-5 hidden max-w-sm leading-relaxed text-white lg:block">Système intégré de gestion de la {DEP_NOM} : programmer, suivre et rendre compte, au même endroit.</p>
              <ul className="mt-6 hidden gap-3 text-sm lg:grid">
                {[[BarChart3, 'Planification, PAP et PTBA'], [ClipboardCheck, 'Suivi-évaluation des politiques'], [Mail, 'Courrier, réunions et décisions']].map(([Icone, t]) => (
                  <li key={t} className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-white/15"><Icone size={16} aria-hidden /></span>{t}</li>
                ))}
              </ul>
            </div>
            <div className="relative hidden lg:block">
              <Link to="/verification" className="inline-flex items-center gap-2 rounded-full border-2 border-white px-5 py-2 text-sm font-semibold text-white transition hover:bg-white hover:text-accueil-bleu focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-accueil-bleu">Vérifier une carte de service <ArrowRight size={14} aria-hidden /></Link>
            </div>
          </section>
          {/* Anneau décoratif à la jonction des deux panneaux */}
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-[68%] hidden h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-[24px] border-[#fcfcfc] bg-accueil-bleu lg:block" />
          {/* Losange arrondi décoratif, en partie hors de la carte */}
          <div aria-hidden className="pointer-events-none absolute -right-16 top-24 hidden h-40 w-40 rotate-45 rounded-[2.5rem] border-[22px] border-accueil-fond lg:block" />
          <main className="relative flex justify-center px-5 py-8 sm:px-10 lg:items-center lg:px-16 lg:py-14">
            <div className="w-full max-w-sm">
              {modeDemo && <p className="mb-5 text-center"><span className="inline-block rounded-full bg-amber-200 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-950">Démonstration — données fictives</span></p>}
              {contenu}
              {demo && !defi && !recup && <ComptesDemo demo={demo} onChoisir={(u) => { setValue('username', u); setValue('password', demo.motDePasse); }} />}
              <p className="mt-8 text-center text-sm text-slate-600 lg:hidden"><Link to="/verification" className="font-semibold text-dep-700 underline">Vérifier une carte de service</Link></p>
            </div>
          </main>
        </div>
      </div>
      <p className="relative pb-4 text-center text-xs text-slate-600">© {new Date().getFullYear()} {DEP_NOM} — {SG_NOM} · accès réservé au personnel autorisé</p>
    </div>
  );
}
