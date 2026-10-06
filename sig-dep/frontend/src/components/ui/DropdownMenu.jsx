import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { VARIANTES } from './Button';

/**
 * Menu déroulant accessible : bouton déclencheur + liste d’actions.
 * items : [{ label, icon, onClick, to, danger, disabled }] — les valeurs fausses sont ignorées.
 * Clavier : flèches, Début / Fin, Échap (retour au bouton), Tab ferme le menu.
 */
export function DropdownMenu({
  label, icon: Icon, items, header, align = 'right', variant = 'secondary', width = 'w-56',
  trigger, triggerClassName, triggerLabel, menuLabel, busy = false,
}) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const bouton = useRef(null);
  const menu = useRef(null);
  const id = useId();
  const liste = items.filter(Boolean);
  const entrees = () => [...(menu.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || [])];

  useEffect(() => {
    if (!open) return undefined;
    entrees()[0]?.focus();
    const dehors = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [open]);

  if (!liste.length) return null;
  const fermer = (rendreFocus = true) => { setOpen(false); if (rendreFocus) bouton.current?.focus(); };
  const onKeyDown = (e) => {
    const els = entrees();
    const i = els.indexOf(document.activeElement);
    const cible = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: els.length - 1 }[e.key];
    if (cible !== undefined) { e.preventDefault(); els[(cible + els.length) % els.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); }
    else if (e.key === 'Tab') fermer(false);
  };
  const cls = (it) => `flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus:outline-none ${it.danger ? 'text-red-700 hover:bg-red-50 focus:bg-red-50' : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-100'}${it.disabled ? ' cursor-not-allowed opacity-50' : ''}`;

  return (
    <div ref={box} className="relative">
      <button ref={bouton} type="button" className={triggerClassName || VARIANTES[variant]} disabled={busy}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}>
        {trigger || <>{Icon && <Icon size={16} aria-hidden />}{label}<ChevronDown size={14} aria-hidden /></>}
      </button>
      {open && (
        <div onKeyDown={onKeyDown} className={`absolute z-40 mt-1 ${width} max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white py-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {header}
          <div id={id} ref={menu} role="menu" aria-label={menuLabel || triggerLabel || label}>
            {liste.map((it, i) => {
              const contenu = <>{it.icon && <it.icon size={16} aria-hidden className="shrink-0" />}<span>{it.label}</span></>;
              return it.to && !it.disabled
                ? <Link key={i} to={it.to} role="menuitem" tabIndex={-1} className={cls(it)} onClick={() => setOpen(false)}>{contenu}</Link>
                : <button key={i} type="button" role="menuitem" tabIndex={-1} aria-disabled={it.disabled || undefined} className={cls(it)} onClick={() => { if (!it.disabled) { fermer(); it.onClick?.(); } }}>{contenu}</button>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
