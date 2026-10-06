import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, Tabs, Modal, Field, DataTable, RangBadge, Badge, runAction, useConfirm } from '../../components/ui';
import { ROLES } from '../../lib/labels';

const attrSchema = z.object({
  cible: z.string().min(1, 'Choisissez la cible'),
  categorie: z.enum(['MISSION', 'ATTRIBUTION', 'RESPONSABILITE']),
  libelle: z.string().trim().min(3, 'Au moins 3 caractères'),
});

function AttributionForm({ data, onClose, onSaved }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(attrSchema), defaultValues: { categorie: 'ATTRIBUTION' } });
  const submit = async (v) => {
    const [t, idv] = v.cible.split(':');
    const body = { cible_type: t, categorie: v.categorie, libelle: v.libelle };
    if (t === 'DIVISION') body.division_id = Number(idv);
    if (t === 'BUREAU') body.bureau_id = Number(idv);
    if (t === 'ROLE') body.role_code = idv;
    await runAction(() => api.post('/organisation/attributions', body), 'Attribution enregistrée.');
    onSaved();
  };
  return (
    <Modal open title="Nouvelle mission / attribution" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="attr-form" className="btn-primary" disabled={isSubmitting}>Enregistrer</button></>}>
      <form id="attr-form" onSubmit={handleSubmit(submit)} className="space-y-3">
        <Field label="Cible" error={errors.cible?.message} required>
          <select className="input" {...register('cible')}>
            <option value="">— Choisir —</option>
            <option value="DIRECTION:">Direction d’Études et Planification</option>
            <optgroup label="Divisions">{data.divisions.map((d) => <option key={d.id} value={`DIVISION:${d.id}`}>{d.nom}</option>)}</optgroup>
            <optgroup label="Bureaux">{data.bureaux.map((b) => <option key={b.id} value={`BUREAU:${b.id}`}>{b.nom}</option>)}</optgroup>
            <optgroup label="Responsabilités par fonction">{['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'].map((r) => <option key={r} value={`ROLE:${r}`}>{ROLES[r]}</option>)}</optgroup>
          </select>
        </Field>
        <Field label="Catégorie" required><select className="input" {...register('categorie')}><option value="MISSION">Mission</option><option value="ATTRIBUTION">Attribution</option><option value="RESPONSABILITE">Responsabilité</option></select></Field>
        <Field label="Libellé" error={errors.libelle?.message} required><textarea className="input" rows={3} {...register('libelle')} /></Field>
      </form>
    </Modal>
  );
}

export default function Cadre() {
  const state = useApi('/organisation/cadre');
  const [tab, setTab] = useState('missions');
  const [form, setForm] = useState(false);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const remove = async (a) => {
    if (!(await confirm({ title: 'Désactiver', message: `Désactiver « ${a.libelle} » ? L’élément reste conservé dans l’historique.`, danger: true }))) return;
    await runAction(() => api.delete(`/organisation/attributions/${a.id}`), 'Élément désactivé.');
    state.reload();
  };
  return (
    <>
      <PageHeader title="Cadre organique" subtitle="Missions, attributions, responsabilités, postes organiques, grades et fonctions." breadcrumb={[{ label: 'Organisation' }, { label: 'Cadre organique' }]}
        actions={can('cadre.gerer') && <button type="button" className="btn-primary" onClick={() => setForm(true)}><Plus size={16} /> Ajouter</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'missions', label: 'Missions et attributions' }, { value: 'responsabilites', label: 'Responsabilités' }, { value: 'postes', label: 'Postes organiques' }, { value: 'grades', label: 'Grades et fonctions' }]} />
      <Loadable state={state}>
        {(c) => {
          const Del = ({ a }) => (can('cadre.gerer') ? <button type="button" className="ml-2 text-red-600 no-print" onClick={() => remove(a)} aria-label="Désactiver"><Trash2 size={14} /></button> : null);
          const list = (filter) => c.attributions.filter(filter);
          return (
            <>
              {form && <AttributionForm data={c} onClose={() => setForm(false)} onSaved={() => { setForm(false); state.reload(); }} />}
              {tab === 'missions' && (
                <div className="space-y-4">
                  <Card title={<span className="flex items-center gap-2">{c.direction.nom} <RangBadge rang="DIRECTION" /></span>}>
                    <ul className="list-disc space-y-1 pl-5 text-sm">{list((a) => a.cible_type === 'DIRECTION').map((a) => <li key={a.id}>{a.libelle}<Del a={a} /></li>)}</ul>
                  </Card>
                  {c.bureaux.filter((b) => b.parent_type === 'DIRECTION').map((b) => (
                    <Card key={b.id} title={<span className="flex flex-wrap items-center gap-2">{b.nom} <RangBadge rang="BUREAU" /><Badge tone="ambre">Bureau directement rattaché au Directeur</Badge></span>}>
                      <p className="mb-2 text-sm text-slate-600">{b.missions}</p>
                      <ul className="list-disc space-y-1 pl-5 text-sm">{list((a) => a.bureau_id === b.id).map((a) => <li key={a.id}>{a.libelle}<Del a={a} /></li>)}</ul>
                    </Card>
                  ))}
                  {c.divisions.map((d) => (
                    <Card key={d.id} title={<span className="flex items-center gap-2">{d.nom} <RangBadge rang="DIVISION" /></span>}>
                      <p className="mb-2 text-sm text-slate-600">{d.missions}</p>
                      <ul className="list-disc space-y-1 pl-5 text-sm">{list((a) => a.cible_type === 'DIVISION' && a.division_id === d.id).map((a) => <li key={a.id}>{a.libelle}<Del a={a} /></li>)}</ul>
                      <div className="mt-3 space-y-3 border-l-2 border-teal-200 pl-4">
                        {c.bureaux.filter((b) => b.division_id === d.id).map((b) => (
                          <div key={b.id}>
                            <div className="flex items-center gap-2 text-sm font-semibold">{b.nom} <RangBadge rang="BUREAU" /></div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">{list((a) => a.cible_type === 'BUREAU' && a.bureau_id === b.id).map((a) => <li key={a.id}>{a.libelle}<Del a={a} /></li>)}</ul>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
              {tab === 'responsabilites' && (
                <div className="grid gap-4 md:grid-cols-2">
                  {['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU', 'AGENT'].map((r) => (
                    <Card key={r} title={`Responsabilités du ${ROLES[r]}`}>
                      <ul className="list-disc space-y-1 pl-5 text-sm">{list((a) => a.cible_type === 'ROLE' && a.role_code === r).map((a) => <li key={a.id}>{a.libelle}<Del a={a} /></li>)}</ul>
                    </Card>
                  ))}
                </div>
              )}
              {tab === 'postes' && (
                <DataTable rows={c.postes} columns={[
                  { key: 'code', header: 'Code' }, { key: 'libelle', header: 'Poste organique' },
                  { key: 'niveau', header: 'Rang de la structure', render: (p) => <RangBadge rang={p.niveau} /> },
                  { key: 'structure', header: 'Structure', render: (p) => p.bureau_nom || p.division_nom || 'Direction', search: (p) => p.bureau_nom || p.division_nom },
                  { key: 'role_associe', header: 'Fonction', render: (p) => ROLES[p.role_associe] },
                  { key: 'grade_minimum', header: 'Grade minimal' },
                  ...(can('cadre.gerer') ? [{ key: 'act', header: '', render: (p) => <button type="button" className="text-red-600" aria-label={`Désactiver ${p.libelle}`} onClick={async () => {
                    if (!(await confirm({ title: 'Désactiver le poste', message: `Désactiver « ${p.libelle} » ? Impossible si le poste est occupé.`, danger: true }))) return;
                    await runAction(() => api.post(`/organisation/postes/${p.id}/desactiver`), 'Poste désactivé.');
                    state.reload();
                  }}><Trash2 size={14} /></button> }] : []),
                ]} />
              )}
              {tab === 'grades' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <DataTable rows={c.grades} searchable={false} columns={[{ key: 'code', header: 'Code' }, { key: 'libelle', header: 'Grade' }, { key: 'categorie', header: 'Catégorie' }]} />
                  <DataTable rows={c.fonctions} searchable={false} columns={[{ key: 'libelle', header: 'Fonction' }, { key: 'grade_libelle', header: 'Grade correspondant' }]} />
                </div>
              )}
            </>
          );
        }}
      </Loadable>
    </>
  );
}
