import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import api from '../../lib/api';
import { StatusBadge } from '../ui';

const GROUPES = { agents: 'Personnel', instructions: 'Instructions', taches: 'Tâches', courriers: 'Courriers', documents: 'Documents', pip: 'Projets PIP' };

/**
 * Recherche globale dans le périmètre de l’utilisateur.
 * En-tête : liste déroulante et raccourci Ctrl+K. `panel` : résultats affichés sous le champ (fenêtre mobile).
 */
export default function GlobalSearch({ panel = false, onNavigate }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef();
  const box = useRef();
  const navigate = useNavigate();
  const listeId = useId();
  const optionId = (i) => `${listeId}-option-${i}`;

  useEffect(() => {
    if (panel) return undefined;
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [panel]);

  useEffect(() => {
    if (q.trim().length < 2) { setData(null); return undefined; }
    // Le délai limite les appels pendant la saisie et le drapeau ignore une réponse devenue obsolète.
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try { const r = await api.get('/recherche', { params: { q: q.trim() } }); if (alive) { setData(r.data); setActive(0); } } catch { if (alive) setData(null); } finally { if (alive) setLoading(false); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const flat = data ? Object.entries(data.resultats).flatMap(([g, items]) => items.map((it) => ({ ...it, groupe: g }))) : [];
  const visible = (panel || open) && q.trim().length >= 2;
  const go = (it) => { setOpen(false); setQ(''); onNavigate?.(); navigate(it.lien); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !panel) { setOpen(false); ref.current?.blur(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && visible && flat[active]) { e.preventDefault(); go(flat[active]); }
  };

  let index = -1;
  return (
    <div ref={box} className={`relative w-full ${panel ? '' : 'max-w-md'}`}>
      <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
      <input ref={ref} className="input pl-8 pr-14" placeholder="Rechercher…" value={q} aria-label="Recherche globale (agents, instructions, tâches, courriers, documents, PIP)"
        role="combobox" aria-expanded={visible} aria-controls={listeId} aria-autocomplete="list"
        aria-activedescendant={visible && flat[active] ? optionId(active) : undefined} data-autofocus={panel || undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
      {!panel && <kbd className="pointer-events-none absolute right-2 top-2 hidden rounded border bg-slate-50 px-1.5 font-sans text-xs text-slate-500 sm:block" aria-hidden>Ctrl K</kbd>}
      {visible && (
        <div className={panel ? 'mt-3' : 'absolute left-0 right-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-white shadow-lg sm:min-w-[420px]'}>
          <p role="status" className={data?.total || (loading && data) ? 'sr-only' : 'p-3 text-sm text-slate-500'}>
            {loading && !data && <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden /> Recherche…</span>}
            {data && (data.total ? `${data.total} résultat(s)` : `Aucun résultat dans votre périmètre pour « ${data.q} ».`)}
          </p>
          <div id={listeId} role="listbox" aria-label="Résultats de la recherche">
            {data && Object.entries(data.resultats).filter(([, items]) => items.length).map(([g, items]) => (
              <div key={g} role="group" aria-labelledby={`${listeId}-${g}`}>
                <div id={`${listeId}-${g}`} className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{GROUPES[g]}</div>
                {items.map((it) => {
                  index += 1;
                  const i = index;
                  return (
                    <div key={`${g}${it.id}`} id={optionId(i)} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(it)}
                      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-dep-50' : ''}`}>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.titre}</span><span className="block truncate text-xs text-slate-500">{it.sousTitre}</span></span>
                      {it.statut && <StatusBadge value={it.statut} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
