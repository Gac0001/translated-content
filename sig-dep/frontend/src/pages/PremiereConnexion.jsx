import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, Download, KeyRound, LogOut, Mail, ScrollText, ShieldCheck, Smartphone } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { DEP_NOM } from '../lib/labels';
import { ErrorAlert, InfoAlert, Spinner, toast } from '../components/ui';
import ChangePassword from './ChangePassword';

const ETAPES = {
  MOT_DE_PASSE: { titre: 'Mot de passe', icon: KeyRound },
  DEUX_FACTEURS: { titre: 'Double authentification', icon: Smartphone },
  EMAIL_RECUPERATION: { titre: 'Récupération', icon: Mail },
  REGLES: { titre: 'Règles de sécurité', icon: ScrollText },
};
const ORDRE = Object.keys(ETAPES);

/** Codes de secours : affichés une seule fois, à conserver hors ligne. */
export function CodesSecours({ codes, onContinuer, libelleContinuer = 'Continuer' }) {
  const [ok, setOk] = useState(false);
  const texte = `SIG-DEP — ${DEP_NOM}\nCodes de secours (usage unique) — générés le ${new Date().toLocaleString('fr-FR')}\n\n${codes.join('\n')}\n`;
  const telecharger = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
    a.download = 'codes-secours-SIG-DEP.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  return (
    <div className="space-y-4">
      <InfoAlert tone="warning">Ces 10 codes permettent de vous connecter si vous perdez votre téléphone. <b>Chacun ne sert qu’une fois.</b> Ils ne seront plus affichés : imprimez-les ou conservez-les dans un lieu sûr, hors de l’ordinateur.</InfoAlert>
      <ol className="grid grid-cols-2 gap-2 rounded-md border bg-slate-50 p-4 font-mono text-base sm:grid-cols-5">
        {codes.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => navigator.clipboard?.writeText(texte).then(() => toast.success('Codes copiés.'))}><Copy size={16} /> Copier</button>
        <button type="button" className="btn-secondary" onClick={telecharger}><Download size={16} /> Télécharger (.txt)</button>
        <button type="button" className="btn-secondary" onClick={() => window.print()}>Imprimer</button>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} /> J’ai conservé ces codes en lieu sûr.</label>
      <button type="button" className="btn-primary" disabled={!ok} onClick={onContinuer}><Check size={16} /> {libelleContinuer}</button>
    </div>
  );
}

function DeuxFacteurs({ onDone }) {
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [user, setUserLocal] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.post('/auth/2fa/preparer').then((r) => setQr(r.data)).catch((e) => setError(errorMessage(e))); }, []);
  const activer = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api.post('/auth/2fa/activer', { code }); setCodes(r.data.codesSecours); setUserLocal(r.data.user); } catch (x) { setError(errorMessage(x)); } finally { setBusy(false); }
  };
  if (codes) return <CodesSecours codes={codes} onContinuer={() => onDone(user)} />;
  return (
    <form onSubmit={activer} className="space-y-4">
      <ErrorAlert message={error} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Installez sur votre téléphone une application d’authentification (Google Authenticator, Microsoft Authenticator, FreeOTP…).</li>
        <li>Dans l’application, ajoutez un compte en scannant le QR code ci-dessous.</li>
        <li>Saisissez le code à 6 chiffres affiché par l’application.</li>
      </ol>
      {!qr ? <Spinner /> : (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <img src={qr.qr} alt="QR code de configuration de l’application d’authentification" className="h-48 w-48 rounded border bg-white p-1" />
          <div className="text-sm">
            <p className="text-slate-600">Impossible de scanner ? Saisissez cette clé dans l’application :</p>
            <code className="mt-1 block break-all rounded bg-slate-100 p-2 font-mono text-sm">{qr.secret}</code>
          </div>
        </div>
      )}
      <div className="max-w-xs">
        <label className="label" htmlFor="code2fa">Code à 6 chiffres</label>
        <input id="code2fa" className="input font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </div>
      <button className="btn-primary" disabled={busy || code.length !== 6}><ShieldCheck size={16} /> Activer la double authentification</button>
    </form>
  );
}

function EmailRecuperation({ onDone }) {
  const [email, setEmail] = useState('');
  const [etat, setEtat] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const enregistrer = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const r = await api.post('/auth/email-recuperation', { email });
      if (r.data.verificationEnvoyee) setEtat(r.data); else { toast.info(r.data.message); onDone(r.data.user); }
    } catch (x) { setError(errorMessage(x)); }
  };
  const verifier = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await api.post('/auth/email-recuperation/verifier', { code }); toast.success(r.data.message); onDone(r.data.user); } catch (x) { setError(errorMessage(x)); }
  };
  if (etat) {
    return (
      <form onSubmit={verifier} className="space-y-4">
        <ErrorAlert message={error} />
        <InfoAlert>Un code à 6 chiffres a été envoyé à <b>{email}</b> (valable 30 minutes).</InfoAlert>
        <div className="max-w-xs"><label className="label" htmlFor="codeMail">Code reçu</label><input id="codeMail" className="input font-mono text-lg tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={code.length !== 6}><Check size={16} /> Vérifier</button>
          <button type="button" className="btn-ghost" onClick={() => onDone(etat.user)}>Vérifier plus tard (depuis mon profil)</button>
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={enregistrer} className="space-y-4">
      <ErrorAlert message={error} />
      <p className="text-sm text-slate-700">Cette adresse, personnelle et sûre, sert à récupérer l’accès au compte (code de récupération) et à recevoir les alertes de sécurité. Elle n’est jamais affichée en clair aux autres utilisateurs.</p>
      <div className="max-w-md"><label className="label" htmlFor="email">Adresse électronique de récupération</label><input id="email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <button className="btn-primary" disabled={!email}><Mail size={16} /> Enregistrer</button>
    </form>
  );
}

function Regles({ onDone }) {
  const [data, setData] = useState(null);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/auth/regles').then((r) => setData(r.data)).catch((e) => setError(errorMessage(e))); }, []);
  const accepter = async () => {
    try { const r = await api.post('/auth/regles/accepter', { version: data.version }); onDone(r.data.user); } catch (x) { setError(errorMessage(x)); }
  };
  if (!data) return error ? <ErrorAlert message={error} /> : <Spinner />;
  return (
    <div className="space-y-4">
      <ErrorAlert message={error} />
      <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-800">{data.regles.map((r) => <li key={r}>{r}</li>)}</ol>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} /> J’ai lu et j’accepte les règles de sécurité du SIG-DEP (version {data.version}).</label>
      <button type="button" className="btn-primary" disabled={!ok} onClick={accepter}><Check size={16} /> Accepter et accéder au SIG-DEP</button>
    </div>
  );
}

/** Première connexion : étapes de sécurité imposées avant l’accès à l’application. */
export default function PremiereConnexion() {
  const { user, setUser, clear } = useAuth();
  const navigate = useNavigate();
  const exigences = user?.exigences || [];
  const [initiales] = useState(() => ORDRE.filter((e) => exigences.includes(e)));
  useEffect(() => { if (user && !exigences.length) navigate('/', { replace: true }); }, [user, exigences.length, navigate]);
  if (!user || !exigences.length) return null;
  const courante = exigences[0];
  const suite = (u) => setUser(u);
  const quitter = async () => { try { await api.post('/auth/logout'); } catch { /* ignore */ } clear(); navigate('/connexion', { replace: true }); };
  const Icon = ETAPES[courante].icon;
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="h-1.5 tricolore" />
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Sécurisation de votre compte</h1>
            <p className="text-sm text-slate-600">{user.username} — ces étapes sont obligatoires avant d’accéder au SIG-DEP.</p>
          </div>
          <button type="button" className="btn-ghost" onClick={quitter}><LogOut size={16} /> Se déconnecter</button>
        </div>
        <ol className="mb-5 flex flex-wrap gap-2" aria-label="Étapes">
          {initiales.map((e, i) => {
            const fait = !exigences.includes(e); const actif = e === courante;
            return (
              <li key={e} aria-current={actif ? 'step' : undefined} className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm ${fait ? 'bg-emerald-100 text-emerald-800' : actif ? 'bg-dep-700 text-white' : 'bg-white text-slate-500'}`}>
                {fait ? <Check size={14} /> : <span className="text-xs font-semibold">{i + 1}</span>} {ETAPES[e].titre}
              </li>
            );
          })}
        </ol>
        <section className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Icon size={20} className="text-dep-700" /> {ETAPES[courante].titre}</h2>
          {courante === 'MOT_DE_PASSE' && <ChangePassword embarque onDone={suite} />}
          {courante === 'DEUX_FACTEURS' && <DeuxFacteurs onDone={suite} />}
          {courante === 'EMAIL_RECUPERATION' && <EmailRecuperation onDone={suite} />}
          {courante === 'REGLES' && <Regles onDone={suite} />}
        </section>
      </div>
    </div>
  );
}
