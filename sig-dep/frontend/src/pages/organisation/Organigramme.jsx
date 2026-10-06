import { createContext, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ChevronDown, ChevronRight, Crown, Landmark, Layers, Pencil, Plus, User, Users } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, Badge, RangBadge, InfoAlert, Stat, runAction, useConfirm } from '../../components/ui';
import StructureModal from './StructureModal';

/** Actions de gestion (Directeur) transmises aux nœuds de l’organigramme. */
const ManageCtx = createContext(null);

function ManageButtons({ type, s }) {
  const m = useContext(ManageCtx);
  if (!m) return null;
  return (
    <span className="flex items-center gap-1 no-print">
      {type === 'division' && <button type="button" className="btn-ghost px-1.5 py-1 text-xs" onClick={() => m.open({ type: 'bureau', defaultDivisionId: s.id })} title="Ajouter un Bureau à cette Division"><Plus size={14} /> Bureau</button>}
      <button type="button" className="btn-ghost px-1.5 py-1" onClick={() => m.open({ type, structure: s })} aria-label={`Modifier ${s.nom}`}><Pencil size={14} /></button>
      {!s.estSecretariatDirection && <button type="button" className="btn-ghost px-1.5 py-1 text-red-700" onClick={() => m.archive(type, s)} aria-label={`Archiver ${s.nom}`}><Archive size={14} /></button>}
    </span>
  );
}

function Person({ p, titre }) {
  if (!p) return <div className="text-xs italic text-slate-400">{titre} : poste vacant</div>;
  return (
    <div className="flex items-center gap-2 text-sm">
      <User size={14} className="shrink-0 text-slate-400" />
      <span><span className="text-xs text-slate-500">{titre} : </span><Link to={`/personnel/${p.agentId}`} className="font-medium link">{p.nomComplet}</Link></span>
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
            {b.badge && <Badge tone="ambre">{b.badge}</Badge>}
          </div>
          <div className="mt-1 text-xs text-slate-500">Rattachement : {b.rattachement.libelle} · Supérieur direct : {b.rattachement.superieurDirect === 'DIRECTEUR' ? 'Directeur' : 'Chef de Division'} · Périmètre d’accès : Bureau</div>
          <div className="mt-1.5"><Person p={b.responsable} titre="Chef de Bureau" /></div>
        </div>
        <Badge><Users size={12} /> {b.effectif}</Badge>
        <ManageButtons type="bureau" s={b} />
      </div>
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm">
          {b.missions && <p className="text-slate-700"><b>Missions : </b>{b.missions}</p>}
          <Attributions list={b.attributions} />
          {b.agents.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Agents du Bureau</div>
              <ul className="grid gap-1 sm:grid-cols-2">{b.agents.map((a) => <li key={a.agentId} className="text-sm"><Link to={`/personnel/${a.agentId}`} className="link">{a.nomComplet}</Link> <span className="text-xs text-slate-500">— {a.fonction || a.poste}</span></li>)}</ul>
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
            <span className="ml-auto"><ManageButtons type="division" s={d} /></span>
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
          {!d.bureaux.length && <p className="text-sm text-slate-500">Aucun Bureau rattaché.</p>}
        </div>
      )}
    </div>
  );
}

export default function Organigramme() {
  const state = useApi('/organisation/organigramme');
  const canManage = useAuth((s) => s.can('organisation.gerer'));
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const manage = canManage ? {
    open: setModal,
    archive: async (type, s) => {
      if (!(await confirm({ title: 'Archiver la structure', message: `Archiver « ${s.nom} » ? L’opération n’est possible que si aucun Agent n’y est affecté${type === 'division' ? ' et qu’aucun Bureau ne lui est rattaché' : ''}. L’historique est conservé.`, danger: true, confirmLabel: 'Archiver' }))) return;
      await runAction(() => api.post(`/organisation/${type === 'division' ? 'divisions' : 'bureaux'}/${s.id}/archiver`), 'Structure archivée.');
      state.reload();
    },
  } : null;
  return (
    <ManageCtx.Provider value={manage}>
      <PageHeader title="Organigramme de la DEP" subtitle="Rang organique et rattachement hiérarchique sont présentés séparément." breadcrumb={[{ label: 'Organisation' }, { label: 'Organigramme' }]}
        actions={<>
          {canManage && <button type="button" className="btn-secondary" onClick={() => setModal({ type: 'division' })}><Plus size={16} /> Nouvelle Division</button>}
          {canManage && <button type="button" className="btn-secondary" onClick={() => setModal({ type: 'bureau' })}><Plus size={16} /> Nouveau Bureau</button>}
          <button type="button" className="btn-secondary" onClick={() => window.print()}>Imprimer</button>
        </>} />
      <Loadable state={state}>
        {(o) => (
          <div className="space-y-5">
            {modal && <StructureModal {...modal} divisions={o.divisions} onClose={() => setModal(null)} onSaved={() => { setModal(null); state.reload(); }} />}
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
    </ManageCtx.Provider>
  );
}
