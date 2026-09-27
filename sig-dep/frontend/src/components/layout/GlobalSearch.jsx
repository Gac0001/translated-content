import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import api from '../../lib/api';
import { StatusBadge } from '../ui';

const GROUPES = { agents: 'Personnel', instructions: 'Instructions', taches: 'Tâches', courriers: 'Courriers', documents: 'Documents', pip: 'Projets PIP' };

/** Recherche globale dans le périmètre de l’utilisateur (Ctrl+K). */
export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef();
  const box = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setData(null); return undefined; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try { const r = await api.get('/recherche', { params: { q: q.trim() } }); if (alive) { setData(r.data); setActive(0); } } catch { if (alive) setData(null); } finally { if (alive) setLoading(false); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const flat = data ? Object.entries(data.resultats).flatMap(([g, items]) => items.map((it) => ({ ...it, groupe: g }))) : [];
  const go = (it) => { setOpen(false); setQ(''); navigate(it.lien); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && flat[active]) go(flat[active]);
  };

  let index = -1;
  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
      <input ref={ref} className="input pl-8 pr-14" placeholder="Rechercher…" value={q} aria-label="Recherche globale"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
      <span className="pointer-events-none absolute right-2 top-2 hidden rounded border bg-slate-50 px-1.5 text-[11px] text-slate-500 sm:block">Ctrl K</span>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-white shadow-lg sm:min-w-[420px]" role="listbox">
          {loading && !data && <div className="flex items-center gap-2 p-3 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Recherche…</div>}
          {data && !data.total && <div className="p-3 text-sm text-slate-500">Aucun résultat dans votre périmètre pour « {data.q} ».</div>}
          {data && Object.entries(data.resultats).filter(([, items]) => items.length).map(([g, items]) => (
            <div key={g}>
              <div className="bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{GROUPES[g]}</div>
              {items.map((it) => {
                index += 1;
                const i = index;
                return (
                  <button key={`${g}${it.id}`} type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(it)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-dep-50' : ''}`}>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.titre}</span><span className="block truncate text-xs text-slate-500">{it.sousTitre}</span></span>
                    {it.statut && <StatusBadge value={it.statut} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
