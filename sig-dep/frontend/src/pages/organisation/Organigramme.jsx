import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Crown, Landmark, Layers, User, Users } from 'lucide-react';
import { useApi, Loadable, PageHeader, Card, Badge, RangBadge, InfoAlert, Stat } from '../../components/ui';

function Person({ p, titre }) {
  if (!p) return <div className="text-xs italic text-slate-400">{titre} : poste vacant</div>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <User size={14} className="shrink-0 text-slate-400" />
      <span><span className="text-xs text-slate-500">{titre} : </span><Link to={`/personnel/${p.agentId}`} className="font-medium text-dep-800 hover:underline">{p.nomComplet}</Link></span>
    </div>
  );
}

function Attributions({ list }) {
  if (!list?.length) return null;
  return <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">{list.map((a, i) => <li key={i}>{a}</li>)}</ul>;
}

/** Carte d’un Bureau : icône et badge de Bureau, jamais de Division. */
function BureauNode({ b, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const direct = b.rattachement.parentType === 'DIRECTION';
  return (
    <div className={`rounded-md border bg-white ${direct ? 'border-amber-300' : 'border-teal-200'}`}>
      <div className="flex flex-wrap items-start gap-2 p-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 text-slate-500" aria-expanded={open} aria-label={open ? 'Réduire' : 'Déplier'}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        <Layers size={18} className="mt-0.5 text-teal-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/structures/bureau/${b.id}`} className="font-semibold text-slate-900 hover:underline">{b.nom}</Link>
            <RangBadge rang={b.rangOrganique} />
            {b.badge && <Badge className="bg-amber-100 text-amber-900 ring-amber-300">{b.badge}</Badge>}
          </div>
          <div className="mt-1 text-xs text-slate-500">Rattachement : {b.rattachement.libelle} · Supérieur direct : {b.rattachement.superieurDirect === 'DIRECTEUR' ? 'Directeur' : 'Chef de Division'} · Périmètre d’accès : Bureau</div>
          <div className="mt-1.5"><Person p={b.responsable} titre="Chef de Bureau" /></div>
        </div>
        <Badge><Users size={12} /> {b.effectif}</Badge>
      </div>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm">
          {b.missions && <p className="text-slate-700"><b>Missions : </b>{b.missions}</p>}
          <Attributions list={b.attributions} />
          {b.agents.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Agents du Bureau</div>
              <ul className="grid gap-1 sm:grid-cols-2">{b.agents.map((a) => <li key={a.agentId} className="text-sm"><Link to={`/personnel/${a.agentId}`} className="text-dep-700 hover:underline">{a.nomComplet}</Link> <span className="text-xs text-slate-500">— {a.fonction || a.poste}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DivisionNode({ d }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40">
      <div className="flex flex-wrap items-start gap-2 p-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 text-slate-500" aria-expanded={open} aria-label={open ? 'Réduire' : 'Déplier'}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
        <Landmark size={18} className="mt-0.5 text-indigo-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/structures/division/${d.id}`} className="font-semibold text-slate-900 hover:underline">{d.nom}</Link>
            <RangBadge rang="DIVISION" />
          </div>
          <div className="mt-1 text-xs text-slate-500">Rattachement : {d.rattachement.libelle} · Périmètre d’accès : Division</div>
          <div className="mt-1.5"><Person p={d.responsable} titre="Chef de Division" /></div>
          {open && <><p className="mt-2 text-sm text-slate-700">{d.missions}</p><Attributions list={d.attributions} /></>}
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t border-indigo-100 p-3 pl-6 sm:pl-10">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bureaux rattachés à la Division</div>
          {d.bureaux.map((b) => <BureauNode key={b.id} b={b} />)}
        </div>
      )}
    </div>
  );
}

export default function Organigramme() {
  const state = useApi('/organisation/organigramme');
  return (
    <>
      <PageHeader title="Organigramme de la DEP" subtitle="Rang organique et rattachement hiérarchique sont présentés séparément." breadcrumb={[{ label: 'Organisation' }, { label: 'Organigramme' }]} actions={<button type="button" className="btn-secondary" onClick={() => window.print()}>Imprimer</button>} />
      <Loadable state={state}>
        {(o) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Divisions" value={o.statistiques.divisions} icon={Landmark} />
              <Stat label="Bureaux rattachés aux Divisions" value={o.statistiques.bureauxRattachesDivisions} icon={Layers} tone="gris" />
              <Stat label="Bureaux rattachés au Directeur" value={o.statistiques.bureauxRattachesDirection} icon={Layers} tone="jaune" />
              <Stat label="Agents affectés" value={o.statistiques.agents} icon={Users} tone="vert" />
            </div>
            <InfoAlert>La position du Bureau Secrétariat de Direction directement sous le Directeur traduit uniquement son <b>rattachement hiérarchique</b>. Son <b>rang organique</b> reste celui d’un Bureau : il n’est ni une Division, ni comptabilisé comme tel, et n’exerce aucune autorité sur les Divisions ou les autres Bureaux.</InfoAlert>

            <Card bodyClass="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <Crown size={22} className="text-dep-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Link to={`/structures/direction/${o.direction.id}`} className="text-lg font-semibold hover:underline">{o.direction.nom} ({o.direction.sigle})</Link><RangBadge rang="DIRECTION" /></div>
                  <div className="text-xs text-slate-500">Placée sous l’autorité du {o.direction.autoriteTutelle}</div>
                  <div className="mt-1.5"><Person p={o.direction.responsable} titre="Directeur" /></div>
                  <details className="mt-2 text-sm"><summary className="cursor-pointer text-dep-700">Missions de la Direction</summary><ul className="mt-1 list-disc pl-5 text-slate-700">{o.direction.missions.map((m, i) => <li key={i}>{m}</li>)}</ul></details>
                </div>
              </div>

              <div className="mt-5 space-y-5 border-l-2 border-dep-200 pl-4 sm:pl-6">
                <section>
                  <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">Rattachement direct au Directeur <RangBadge rang="BUREAU" /></h2>
                  <div className="space-y-2">{o.bureauxRattachesDirection.map((b) => <BureauNode key={b.id} b={b} defaultOpen />)}</div>
                </section>
                <section>
                  <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">Divisions de la DEP <RangBadge rang="DIVISION" /></h2>
                  <div className="space-y-3">{o.divisions.map((d) => <DivisionNode key={d.id} d={d} />)}</div>
                </section>
              </div>
            </Card>
          </div>
        )}
      </Loadable>
    </>
  );
}
