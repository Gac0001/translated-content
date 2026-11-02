import { Link } from 'react-router-dom';
import { DEP_NOM, SG_NOM } from '../lib/labels';

/** Emblème « DEP » de la charte (carré bleu institutionnel souligné du jaune du drapeau). */
export function EmblemeDep({ grand = false, inverse = false }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-xl border-b-4 border-rdc-jaune font-display font-bold ${grand ? 'h-12 w-12 text-base' : 'h-11 w-11 text-sm'} ${inverse ? 'bg-white text-dep-700' : 'bg-dep-700 text-white'}`}>DEP</span>
  );
}

/**
 * Habillage des pages publiques hors connexion (vérification des cartes, maintenance) : bandeau
 * tricolore, en-tête à l’identité de la Direction, contenu centré, pied de page institutionnel.
 * lien : { to, label } affiché à droite de l’en-tête.
 */
export default function PagePublique({ lien, children, large = false }) {
  return (
    <div className="flex min-h-screen flex-col bg-dep-50">
      <div className="h-1.5 tricolore" />
      <header className="border-b border-[#dde3ea] bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/connexion" className="flex min-w-0 items-center gap-3">
            <EmblemeDep />
            <span className="min-w-0">
              <span className="block truncate text-[11px] uppercase tracking-[0.16em] text-slate-600">République Démocratique du Congo<span className="hidden sm:inline"> · {SG_NOM}</span></span>
              <span className="block font-display text-base font-bold text-dep-700 sm:text-lg">{DEP_NOM}</span>
            </span>
          </Link>
          {lien && <Link to={lien.to} className="ml-auto hidden shrink-0 text-sm font-semibold text-dep-700 hover:underline sm:block">{lien.label}</Link>}
        </div>
      </header>
      <main className={`mx-auto flex w-full flex-1 flex-col px-4 py-6 sm:justify-center sm:py-8 ${large ? 'max-w-2xl' : 'max-w-lg'}`}>{children}</main>
      <footer className="bg-dep-800 text-sm text-dep-100">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-4">
          <span>© {new Date().getFullYear()} {DEP_NOM} — {SG_NOM}</span>
          <span>SIG-DEP · accès réservé au personnel autorisé</span>
        </div>
      </footer>
    </div>
  );
}
