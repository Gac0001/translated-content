import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Loader2, Search, ShieldAlert, ShieldX } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { DEP_NOM, SG_NOM } from '../lib/labels';
import { fmtDate } from '../lib/format';

const TONS = {
  VALIDE: ['border-emerald-300 bg-emerald-50 text-emerald-900', BadgeCheck],
  EXPIREE: ['border-amber-300 bg-amber-50 text-amber-900', ShieldAlert],
  SUSPENDUE: ['border-amber-300 bg-amber-50 text-amber-900', ShieldAlert],
  REMPLACEE: ['border-amber-300 bg-amber-50 text-amber-900', ShieldAlert],
  NON_EN_FONCTION: ['border-red-300 bg-red-50 text-red-900', ShieldX],
  ANNULEE: ['border-red-300 bg-red-50 text-red-900', ShieldX],
  PERDUE: ['border-red-300 bg-red-50 text-red-900', ShieldX],
  INCONNUE: ['border-slate-300 bg-slate-50 text-slate-800', ShieldX],
};

function Resultat({ r }) {
  const [ton, Icone] = TONS[r.verdict] || TONS.INCONNUE;
  return (
    <div className="mt-4 space-y-4">
      <div className={`flex items-center gap-3 rounded-lg border-2 p-4 ${ton}`} role="status">
        <Icone size={30} className="shrink-0" />
        <div><div className="text-lg font-bold">{r.libelle}</div>{r.carte && <div className="text-sm">Carte n° {r.carte.numero} — délivrée le {fmtDate(r.carte.dateDelivrance)}, valable jusqu’au {fmtDate(r.carte.dateExpiration)}</div>}</div>
      </div>
      {r.titulaire && (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row">
          {r.titulaire.photo
            ? <img src={r.titulaire.photo} alt={`Photo de ${r.titulaire.nomComplet}`} className="h-44 w-36 shrink-0 rounded border border-slate-300 object-cover" />
            : <div className="flex h-44 w-36 items-center justify-center rounded border bg-slate-100 text-xs text-slate-500">Photo indisponible</div>}
          <dl className="grid flex-1 gap-2 text-sm">
            <div><dt className="text-xs uppercase text-slate-500">Nom complet</dt><dd className="text-lg font-semibold">{r.titulaire.nomComplet}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Grade</dt><dd className="font-medium">{r.titulaire.grade || '—'}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Fonction</dt><dd className="font-medium">{r.titulaire.fonction || '—'}</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Affectation</dt><dd className="font-medium">{r.titulaire.affectation || '—'}</dd></div>
            {r.carte && (
              <div><dt className="text-xs uppercase text-slate-500">Date d’expiration</dt>
                <dd className={`font-semibold ${r.verdict === 'EXPIREE' ? 'text-red-700' : 'text-emerald-800'}`}>{fmtDate(r.carte.dateExpiration)}{r.verdict === 'EXPIREE' && ' — carte expirée'}</dd></div>
            )}
            <div><dt className="text-xs uppercase text-slate-500">Service émetteur</dt><dd>{r.emetteur}</dd></div>
          </dl>
        </div>
      )}
      <p className="text-xs text-slate-500">Comparez la photo et le nom avec la carte présentée et avec son porteur. Une carte suspendue, annulée, perdue, remplacée ou expirée ne doit pas être acceptée.</p>
    </div>
  );
}

/**
 * Saisie libre : code de vérification (20 chiffres, lu par un lecteur de code à barres ou recopié),
 * lien du QR code collé, ou matricule du titulaire.
 */
function interpreter(saisie) {
  const t = saisie.trim();
  const lien = t.match(/\/verification\/c\/([A-Za-z0-9_-]{16,40})/);
  if (lien) return { jeton: lien[1] };
  if (/^\d{20}$/.test(t.replace(/\s/g, ''))) return { jeton: t.replace(/\s/g, '') };
  return { matricule: t };
}

/** Vérification publique d’une carte de service : QR code, code à barres ou matricule. */
export default function VerificationCarte() {
  const { jeton } = useParams();
  const navigate = useNavigate();
  const [matricule, setMatricule] = useState('');
  const [resultat, setResultat] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [busy, setBusy] = useState(false);
  const verifier = async (params) => {
    setBusy(true); setErreur(null); setResultat(null);
    try { setResultat((await api.get('/public/cartes/verifier', { params })).data); } catch (e) { setErreur(errorMessage(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (jeton) verifier({ jeton }); }, [jeton]);
  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <div className="h-1.5 tricolore" />
      <header className="bg-dep-800 px-4 py-4 text-center text-white">
        <div className="text-xs uppercase tracking-[0.2em] text-dep-200">République Démocratique du Congo</div>
        <div className="text-sm text-dep-100">{SG_NOM}</div>
        <div className="mt-1 text-lg font-semibold">{DEP_NOM}</div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <div className="card p-5">
          <h1 className="text-xl font-semibold">Vérification d’une carte de service</h1>
          <p className="mt-1 text-sm text-slate-600">Scannez le QR code au verso de la carte ou son code à barres au recto, ou saisissez le matricule de son titulaire.</p>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (jeton) navigate('/verification'); verifier(interpreter(matricule)); }}>
            <label htmlFor="matricule" className="sr-only">Matricule ou code de la carte</label>
            <input id="matricule" className="input flex-1" placeholder="Matricule du titulaire ou code à barres de la carte" autoComplete="off" value={matricule} onChange={(e) => setMatricule(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={busy || matricule.trim().length < 3}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Vérifier</button>
          </form>
          {busy && jeton && <p className="mt-4 text-sm text-slate-600"><Loader2 size={14} className="inline animate-spin" /> Vérification de la carte…</p>}
          {erreur && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erreur}</div>}
          {resultat && <Resultat r={resultat} />}
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">Service officiel de vérification — chaque consultation est enregistrée. <Link to="/connexion" className="underline">Accès agents</Link></p>
      </main>
    </div>
  );
}
