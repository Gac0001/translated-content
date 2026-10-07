// Composants de saisie : nombres et montants, grille de saisie, sections et fenêtres de formulaire,
// barre d’actions d’enregistrement. Ils suivent la convention de `runAction` (erreur déjà signalée).
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { fmtNombre, lireNombre } from '../../lib/format';
import { Modal, UnsavedChangesGuard, ZoneDefilante, toast, useConfirm } from './index';

/**
 * Affiche l’erreur d’une action, sauf si `runAction` l’a déjà signalée. Une erreur de contrôle levée
 * par la page (`throw new Error('…')`, hors appel à l’API) est affichée telle quelle.
 */
export function signalerErreur(e) {
  if (e?.dejaSignale) return;
  toast.error(e instanceof Error && !e.isAxiosError && e.message ? e.message : errorMessage(e));
}

// ─── Nombres et montants ────────────────────────────────────────────────────
/**
 * Champ numérique à la française : « 1 250 000,5 » affiché avec séparateurs de milliers hors saisie,
 * clavier numérique sur téléphone, espaces et virgule acceptés.
 * value : nombre ou null ; onChange(nombre | null) n’est appelé qu’avec une valeur valide (ou vide).
 * Une saisie invalide ou hors bornes est signalée (aria-invalid) sans être transmise.
 */
export const NumberInput = forwardRef(function NumberInput({
  value, onChange, decimales = 0, min, max, suffixe, className = '', placeholder, disabled, readOnly,
  labelId, // fourni par Field pour les composants marqués `champ` ; inutile ici (le libellé est relié par id)
  'aria-invalid': ariaInvalid, onBlur, onFocus, ...rest
}, ref) {
  const format = (v) => fmtNombre(v, decimales, { vide: '' });
  const [texte, setTexte] = useState(() => format(value));
  const [saisie, setSaisie] = useState(false);
  const [invalide, setInvalide] = useState(false);
  // Valeur modifiée de l’extérieur (rechargement, import) : réaffichée hors saisie.
  useEffect(() => { if (!saisie) { setTexte(format(value)); setInvalide(false); } }, [value, decimales]); // eslint-disable-line react-hooks/exhaustive-deps
  void labelId;
  const verifier = (s) => {
    const n = lireNombre(s);
    if (n === null) return { ok: true, n: null };
    const ok = Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)
      && (decimales > 0 || Number.isInteger(n));
    return { ok, n };
  };
  const input = (
    <input ref={ref} type="text" inputMode={decimales > 0 ? 'decimal' : 'numeric'} autoComplete="off"
      className={`input text-right tabular-nums ${suffixe ? 'pr-12' : ''} ${className}`}
      value={texte} placeholder={placeholder} disabled={disabled} readOnly={readOnly}
      aria-invalid={invalide || ariaInvalid || undefined}
      onFocus={(e) => { setSaisie(true); onFocus?.(e); }}
      onChange={(e) => {
        setTexte(e.target.value);
        const { ok, n } = verifier(e.target.value);
        setInvalide(!ok);
        if (ok && n !== value) onChange?.(n);
      }}
      onBlur={(e) => {
        setSaisie(false);
        const { ok } = verifier(texte);
        if (ok) setTexte(format(value));
        onBlur?.(e);
      }}
      {...rest} />
  );
  if (!suffixe) return input;
  return (
    <div className="relative">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-500" aria-hidden>{suffixe}</span>
    </div>
  );
});
NumberInput.champ = true;

/** Montant en francs congolais (entier, positif par défaut, suffixe « CDF »). */
export const MoneyInput = forwardRef(function MoneyInput({ min = 0, suffixe = 'CDF', ...rest }, ref) {
  return <NumberInput ref={ref} min={min} suffixe={suffixe} {...rest} />;
});
MoneyInput.champ = true;

// ─── Grille de saisie ───────────────────────────────────────────────────────
/**
 * Grille de saisie chiffrée (lignes × colonnes) : crédits par année, plafonds par nature, cibles…
 * lignes : [{ key, label, aide?, lectureSeule?, niveau? }] — niveau 1 met la ligne en retrait ;
 * colonnes : [{ key, label }] ; valeurs : { [ligne]: { [colonne]: nombre } } ;
 * onChange(ligne, colonne, nombre | null) ; totaux : 'lignes' | 'colonnes' | 'tous' | null ;
 * alerte(ligne, colonne, valeur) → texte d’alerte ou null (cellule encadrée de rouge, texte lu) ;
 * modifiee(ligne, colonne) → vrai pour une cellule modifiée et non enregistrée (fond ambré).
 * Clavier : Entrée / flèches haut-bas passent à la ligne suivante / précédente de la même colonne.
 */
export function EditableGrid({
  lignes, colonnes, valeurs = {}, onChange, totaux = 'colonnes', decimales = 0, lectureSeule = false,
  label, entete = '', alerte, modifiee, format = (v) => fmtNombre(v, decimales), unite,
}) {
  const id = useId().replace(/:/g, '');
  const table = useRef(null);
  const val = (l, c) => valeurs[l]?.[c] ?? null;
  const somme = (xs) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
  const totLigne = (l) => somme(colonnes.map((c) => val(l.key, c.key)));
  const totCol = (c) => somme(lignes.map((l) => val(l.key, c.key)));
  const avecTotLignes = totaux === 'lignes' || totaux === 'tous';
  const avecTotCols = totaux === 'colonnes' || totaux === 'tous';

  const deplacer = (e, i, j) => {
    const pas = { ArrowDown: 1, Enter: e.shiftKey ? -1 : 1, ArrowUp: -1 }[e.key];
    if (!pas) return;
    e.preventDefault();
    for (let k = i + pas; k >= 0 && k < lignes.length; k += pas) {
      const cible = table.current?.querySelector(`[data-cellule="${k}-${j}"]`);
      if (cible) { cible.focus(); cible.select?.(); return; }
    }
  };

  return (
    <ZoneDefilante label={label}>
      <table ref={table} className="min-w-full" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="th sticky left-0 z-10 min-w-[12rem]">{entete || <span className="sr-only">Rubrique</span>}</th>
            {colonnes.map((c) => <th key={c.key} scope="col" className="th min-w-[9rem] text-right">{c.label}</th>)}
            {avecTotLignes && <th scope="col" className="th text-right">Total</th>}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={l.key}>
              <th scope="row" className={`td sticky left-0 z-10 bg-white text-left font-medium text-slate-800 ${l.niveau ? 'pl-7 font-normal' : ''}`}>
                {l.label}{l.aide && <div className="text-xs font-normal text-slate-500">{l.aide}</div>}
              </th>
              {colonnes.map((c, j) => {
                const v = val(l.key, c.key);
                const msg = alerte?.(l.key, c.key, v);
                const aideId = msg ? `${id}-${i}-${j}` : undefined;
                return (
                  <td key={c.key} className={`td py-1.5 ${msg ? 'bg-red-50' : ''}`}>
                    {lectureSeule || l.lectureSeule
                      ? <div className="px-3 text-right tabular-nums">{format(v)}</div>
                      : <NumberInput value={v} decimales={decimales} onChange={(n) => onChange(l.key, c.key, n)}
                        className={`py-1.5 ${msg ? 'border-red-500' : modifiee?.(l.key, c.key) ? 'border-amber-400 bg-amber-50' : ''}`} aria-label={`${l.label} — ${c.label}${unite ? ` (${unite})` : ''}`}
                        aria-describedby={aideId} data-cellule={`${i}-${j}`} onKeyDown={(e) => deplacer(e, i, j)} />}
                    {msg && <div id={aideId} className="mt-0.5 text-right text-xs text-red-700">{msg}</div>}
                  </td>
                );
              })}
              {avecTotLignes && <td className="td text-right font-semibold tabular-nums">{format(totLigne(l))}</td>}
            </tr>
          ))}
        </tbody>
        {avecTotCols && (
          <tfoot>
            <tr className="bg-[#f1f4f8] font-semibold">
              <th scope="row" className="td sticky left-0 z-10 bg-[#f1f4f8] text-left">Total</th>
              {colonnes.map((c) => <td key={c.key} className="td px-6 text-right tabular-nums">{format(totCol(c))}</td>)}
              {avecTotLignes && <td className="td text-right tabular-nums">{format(somme(lignes.map(totLigne)))}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </ZoneDefilante>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────
/**
 * Section de formulaire : titre, explication, champs en grille (cols = 1 à 4 à partir de sm).
 * Rendue comme un groupe (fieldset) : le titre est annoncé avec chaque champ.
 */
export function FormSection({ title, description, cols = 2, children, className = '' }) {
  const grille = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols] ?? 'sm:grid-cols-2';
  return (
    <fieldset className={`min-w-0 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 ${className}`}>
      {title && <legend className="float-left mb-1 w-full font-display text-[15px] font-semibold text-dep-700">{title}</legend>}
      {description && <p className="clear-left mb-3 text-sm text-slate-600">{description}</p>}
      <div className={`clear-left grid gap-3 ${grille}`}>{children}</div>
    </fieldset>
  );
}

/**
 * Fenêtre de formulaire : Entrée valide le formulaire, le bouton reste désactivé pendant
 * l’enregistrement, et la fermeture d’une saisie modifiée (`dirty`) demande confirmation.
 * onSubmit : fonction asynchrone ; la fenêtre reste ouverte si elle lève une erreur (affichée une fois).
 */
export function FormModal({
  open, title, onClose, onSubmit, children, submitLabel = 'Enregistrer', dirty = false, size = 'md',
  danger = false, disabled = false, footer,
}) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  if (!open) return null;
  const fermer = async () => {
    if (busy) return;
    if (dirty && !(await confirm({ title: 'Abandonner la saisie ?', message: 'Les informations saisies dans cette fenêtre seront perdues.', confirmLabel: 'Abandonner', danger: true }))) return;
    onClose();
  };
  const soumettre = async (e) => {
    e.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    try { await onSubmit(); } catch (err) { signalerErreur(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={title} onClose={fermer} size={size}
      footer={<>
        {footer}
        <button type="button" className="btn-secondary" onClick={fermer} disabled={busy}>Annuler</button>
        <button type="submit" form={formId} className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || disabled} aria-busy={busy || undefined}>
          {busy ? 'Enregistrement…' : submitLabel}
        </button>
      </>}>
      <form id={formId} onSubmit={soumettre} noValidate className="space-y-4">{children}</form>
    </Modal>
  );
}

/**
 * Barre d’enregistrement d’un formulaire de page, collée en bas de l’écran : état de la saisie,
 * Annuler et Enregistrer ; protège la saisie non enregistrée (navigation et fermeture de l’onglet).
 * onSave : fonction asynchrone (ou bouton de type submit si `form` est fourni).
 */
export function ActionBar({ dirty, saving = false, onSave, onCancel, saveLabel = 'Enregistrer', form, children, guard = true, disabled = false }) {
  return (
    <>
      {guard && <UnsavedChangesGuard surOnglet when={dirty && !saving} />}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 flex items-center gap-2 border-t border-[#dde3ea] bg-white/95 px-4 py-2.5 shadow-[0_-2px_6px_rgba(23,65,138,0.06)] backdrop-blur sm:-mx-6 sm:px-6 sm:py-3 no-print">
        <p className="mr-auto min-w-0 text-xs text-slate-600 sm:text-sm" aria-live="polite">
          {saving ? 'Enregistrement en cours…' : dirty
            ? <span className="inline-flex items-center gap-1.5 font-medium text-amber-800"><span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />Modifications non enregistrées</span>
            : 'Aucune modification en attente.'}
        </p>
        {children}
        {onCancel && dirty && <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Annuler</button>}
        <button type={form ? 'submit' : 'button'} form={form} className="btn-primary" disabled={saving || disabled || !dirty}
          onClick={form ? undefined : () => Promise.resolve(onSave?.()).catch(signalerErreur)} aria-busy={saving || undefined}>
          <Save size={16} aria-hidden />{saving ? 'Enregistrement…' : saveLabel}
        </button>
      </div>
    </>
  );
}
