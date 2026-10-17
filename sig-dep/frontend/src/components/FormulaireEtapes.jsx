import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import { Alert } from './ui';

/** Rubrique renseignée (texte non vide, liste ou tableau non vide). */
export function renseigne(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

/**
 * Formulaire guidé par étapes, commun à tous les documents (fiche PIP, documents de service,
 * correspondance, programmation, PTBA) : navigation à gauche avec compteur de rubriques
 * obligatoires, résumé en continu sous la navigation, étape courante, Précédent / Suivant /
 * Enregistrer, et éventuel aperçu à droite.
 *
 * `etapes` : [{ key, numero, label, ok, total }] ; `resume` : contrôle en continu (totaux, écarts) ;
 * `apercu` : panneau de droite (aperçu de la lettre…).
 */
export function FormulaireEtapes({
  etapes, etape, onEtape, resume, apercu, children, onEnregistrer, enregistrement = false, peutEnregistrer = true,
  libelleEnregistrer = 'Enregistrer', aide, navigation = 'Étapes du formulaire', onAnnuler,
}) {
  const courante = etapes[etape];
  return (
    <div className={`grid gap-4 lg:grid-cols-[260px_1fr] ${apercu ? 'xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,420px)]' : ''}`}>
      <nav className="card h-max p-2 lg:sticky lg:top-20" aria-label={navigation}>
        <ol className="space-y-0.5">
          {etapes.map((x, i) => (
            <li key={x.key}>
              <button type="button" onClick={() => onEtape(i)} aria-current={i === etape ? 'step' : undefined}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === etape ? 'bg-dep-50 font-medium text-dep-800' : 'hover:bg-slate-50'}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${x.total && x.ok === x.total ? 'bg-emerald-600 text-white' : x.alerte ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}`}>{x.numero}</span>
                <span className="flex-1 truncate" title={x.label}>{x.label}</span>
                {x.total > 0 && <span className="text-xs text-slate-600">{x.ok}/{x.total}<span className="sr-only"> rubriques obligatoires renseignées</span></span>}
              </button>
            </li>
          ))}
        </ol>
        {resume && <div className="mt-2 border-t px-2 pt-2 text-xs text-slate-600">{resume}</div>}
      </nav>
      <div className="min-w-0 space-y-4">
        {children}
        {aide && <Alert tone="info" statique>{aide}</Alert>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={etape === 0} onClick={() => onEtape(etape - 1)}><ChevronLeft size={16} aria-hidden /> Précédent</button>
          <button type="button" className="btn-secondary" disabled={etape >= etapes.length - 1} onClick={() => onEtape(etape + 1)}>Suivant <ChevronRight size={16} aria-hidden /></button>
          {onAnnuler && <button type="button" className="btn-ghost ml-auto" onClick={onAnnuler}>Annuler</button>}
          {onEnregistrer && <button type="button" className={`btn-primary ${onAnnuler ? '' : 'ml-auto'}`} disabled={enregistrement || !peutEnregistrer} onClick={onEnregistrer}><Save size={16} aria-hidden /> {enregistrement ? 'Enregistrement…' : libelleEnregistrer}</button>}
        </div>
        {courante && <p className="sr-only" aria-live="polite">Étape {courante.numero} sur {etapes.length} : {courante.label}</p>}
      </div>
      {apercu && <aside className="min-w-0 lg:col-span-2 xl:col-span-1" aria-label="Aperçu">{apercu}</aside>}
    </div>
  );
}

/**
 * Dernière étape : page de contrôle. `manquantes` : [{ etape (index), label }] ; `incoherences` :
 * [{ bloquant, message }] ; `onAller(i)` ouvre l’étape concernée.
 */
export function PageControle({ manquantes = [], incoherences = [], etapes = [], onAller, children, strict = true }) {
  const bloquantes = incoherences.filter((x) => x.bloquant);
  return (
    <div className="space-y-3">
      {!manquantes.length && !bloquantes.length
        ? <Alert tone="succes" statique>Toutes les rubriques obligatoires sont renseignées{incoherences.length ? ' ; quelques points restent à vérifier' : ' et aucune incohérence n’a été relevée'}. Enregistrez, puis transmettez depuis la fiche.</Alert>
        : <Alert tone="attention" statique>{strict
          ? 'Le document peut être enregistré en brouillon, mais il ne pourra être transmis qu’une fois les points ci-dessous corrigés.'
          : 'Le document peut être enregistré et transmis ; il est recommandé de compléter d’abord les points ci-dessous.'}</Alert>}
      {manquantes.length > 0 && (
        <section aria-label="Rubriques obligatoires manquantes">
          <h3 className="mb-1 text-sm font-semibold text-slate-800">{strict ? 'Rubriques obligatoires manquantes' : 'Rubriques à compléter'} ({manquantes.length})</h3>
          <ul className="space-y-1 text-sm">
            {manquantes.map((m) => (
              <li key={`${m.etape}-${m.label}`} className="flex flex-wrap items-baseline gap-2">
                <span className="text-slate-800">{m.label}</span>
                {onAller && <button type="button" className="link text-xs" onClick={() => onAller(m.etape)}>Étape {etapes[m.etape]?.numero} : {etapes[m.etape]?.label}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {incoherences.length > 0 && (
        <section aria-label="Incohérences">
          <h3 className="mb-1 text-sm font-semibold text-slate-800">Cohérence</h3>
          <ul className="space-y-1 text-sm">{incoherences.map((x) => <li key={x.message} className={x.bloquant ? 'text-red-800' : 'text-amber-900'}>{x.bloquant ? 'À corriger' : 'À vérifier'} : {x.message}</li>)}</ul>
        </section>
      )}
      {children}
    </div>
  );
}
