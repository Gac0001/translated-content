import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Plus, Upload } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Tabs, DataTable, StatusBadge, Card, Modal, Field, InfoAlert, Stat, Progress, runAction, toast, Empty } from '../../components/ui';

export const cdf = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} CDF`;

/** Import d’un classeur PTBA au format du Ministère : analyse, choix des feuilles, confirmation. */
function ImportModal({ referentiel, onClose, onDone }) {
  const [exercice, setExercice] = useState(String(referentiel.exercices[0]?.id || ''));
  const [analyse, setAnalyse] = useState(null);
  const [choix, setChoix] = useState({});
  const [busy, setBusy] = useState(false);
  const analyser = async (fichier) => {
    if (!fichier) return;
    const fd = new FormData(); fd.append('fichier', fichier);
    setBusy(true);
    try {
      const r = await api.post('/ptba/import/analyser', fd);
      setAnalyse(r.data);
      setChoix(Object.fromEntries(r.data.feuilles.map((f, i) => [i, !!f.service_id])));
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const maj = (i, k, v) => setAnalyse({ ...analyse, feuilles: analyse.feuilles.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });
  const confirmer = async () => {
    const feuilles = analyse.feuilles.filter((_, i) => choix[i]).map((f) => ({
      sigle: f.sigle, service_id: f.service_id || null, service_libelle: f.service_libelle || f.sigle, programme_id: f.programme_id ? Number(f.programme_id) : null,
      objectif_global: f.objectif_global || null, objectifs: f.objectifs,
    }));
    await runAction(() => api.post('/ptba/import/confirmer', { exercice_id: Number(exercice), feuilles }), `${feuilles.length} PTBA importé(s) en brouillon.`);
    onDone();
  };
  const nb = Object.values(choix).filter(Boolean).length;
  return (
    <Modal open size="xl" title="Importer un PTBA (format du Ministère)" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!analyse || !nb || !exercice} onClick={confirmer}>Importer {nb} feuille(s)</button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Exercice" required><select className="input" value={exercice} onChange={(e) => setExercice(e.target.value)}>{referentiel.exercices.map((x) => <option key={x.id} value={x.id}>{x.annee}</option>)}</select></Field>
          <Field label="Classeur Excel (.xlsx)" required hint="Une feuille par service : activités principales, tâches, coût, chronogramme, structure responsable…"><input type="file" accept=".xlsx" className="input" disabled={busy} onChange={(e) => analyser(e.target.files[0])} /></Field>
        </div>
        {busy && <p className="text-sm text-slate-500">Analyse du classeur…</p>}
        {analyse && (
          <>
            {analyse.ignorees.length > 0 && <InfoAlert>Feuilles ignorées (autre format) : {analyse.ignorees.join(', ')}.</InfoAlert>}
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {analyse.feuilles.map((f, i) => (
                <li key={f.feuille} className="grid gap-2 p-3 text-sm sm:grid-cols-12 sm:items-center">
                  <label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" checked={!!choix[i]} onChange={(e) => setChoix({ ...choix, [i]: e.target.checked })} /><span><b>{f.feuille}</b><span className="block text-xs text-slate-500">{f.nb_lignes} ligne(s) · {cdf(f.cout_total)}</span></span></label>
                  <div className="sm:col-span-3">{f.service_id ? <span>Service <b>{f.sigle}</b></span> : <input className="input" placeholder={`Intitulé du nouveau service ${f.sigle}`} value={f.service_libelle || ''} onChange={(e) => maj(i, 'service_libelle', e.target.value)} />}</div>
                  <select className="input sm:col-span-3" value={f.programme_id || ''} onChange={(e) => maj(i, 'programme_id', e.target.value)} aria-label="Programme">
                    <option value="">— Programme —</option>
                    {referentiel.programmes.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.libelle}</option>)}
                  </select>
                  <span className="truncate text-xs text-slate-500 sm:col-span-3" title={f.objectif_global}>{f.objectif_global || 'Objectif global non renseigné'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

function NouveauPtba({ referentiel, onClose, onCreated }) {
  const [f, setF] = useState({ exercice_id: String(referentiel.exercices[0]?.id || ''), service_id: '', programme_id: '', objectif_global: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const creer = async () => {
    const r = await runAction(() => api.post('/ptba', { exercice_id: Number(f.exercice_id), service_id: Number(f.service_id), programme_id: f.programme_id ? Number(f.programme_id) : null, objectif_global: f.objectif_global || null }), 'PTBA créé.');
    onCreated(r.data.id);
  };
  return (
    <Modal open title="Nouveau PTBA" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!f.exercice_id || !f.service_id} onClick={creer}>Créer</button></>}>
      <div className="grid gap-3">
        <Field label="Exercice" required><select className="input" value={f.exercice_id} onChange={up('exercice_id')}>{referentiel.exercices.map((x) => <option key={x.id} value={x.id}>{x.annee}</option>)}</select></Field>
        <Field label="Service" required><select className="input" value={f.service_id} onChange={up('service_id')}><option value="">— Choisir —</option>{referentiel.services.filter((s) => s.actif).map((s) => <option key={s.id} value={s.id}>{s.sigle} — {s.libelle}</option>)}</select></Field>
        <Field label="Programme"><select className="input" value={f.programme_id} onChange={up('programme_id')}><option value="">—</option>{referentiel.programmes.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.libelle}</option>)}</select></Field>
        <Field label="Objectif global"><textarea className="input" rows={3} value={f.objectif_global} onChange={up('objectif_global')} /></Field>
      </div>
    </Modal>
  );
}

function ListePtba({ referentiel, annee }) {
  const state = useApi(`/ptba?exercice=${annee}`, [annee]);
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const [modal, setModal] = useState(null);
  return (
    <Loadable state={state}>
      {(d) => (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {d.droits.preparer && <button type="button" className="btn-primary" onClick={() => setModal('import')}><Upload size={16} /> Importer un classeur</button>}
            {d.droits.preparer && <button type="button" className="btn-secondary" onClick={() => setModal('nouveau')}><Plus size={16} /> Nouveau PTBA</button>}
            {can('exports.generer') && <button type="button" className="btn-secondary" onClick={() => download(`/ptba/export/consolide?exercice=${annee}`, `PTBA-${annee}.xlsx`).catch((e) => toast.error(errorMessage(e)))}><FileSpreadsheet size={16} /> PTBA consolidé {annee}</button>}
          </div>
          <DataTable rows={d.data} onRowClick={(p) => navigate(`/planification/ptba/${p.id}`)} empty={`Aucun PTBA pour ${annee}.`}
            columns={[
              { key: 'service_sigle', header: 'Service', render: (p) => <div><div className="font-semibold">{p.service_sigle}</div><div className="text-xs text-slate-500">{p.service_libelle}</div></div>, search: (p) => `${p.service_sigle} ${p.service_libelle}` },
              { key: 'programme_libelle', header: 'Programme', render: (p) => p.programme_libelle || '—' },
              { key: 'nb_lignes', header: 'Lignes' },
              { key: 'cout_total', header: 'Coût', render: (p) => <span className="whitespace-nowrap tabular-nums">{cdf(p.cout_total)}</span> },
              { key: 'statut', header: 'Statut', render: (p) => <StatusBadge value={p.statut} /> },
            ]} />
          {modal === 'import' && <ImportModal referentiel={referentiel} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
          {modal === 'nouveau' && <NouveauPtba referentiel={referentiel} onClose={() => setModal(null)} onCreated={(id) => navigate(`/planification/ptba/${id}`)} />}
        </>
      )}
    </Loadable>
  );
}

function Execution({ annee }) {
  const state = useApi(`/ptba/tableau-de-bord?exercice=${annee}`, [annee]);
  return (
    <Loadable state={state}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Coût programmé" value={cdf(d.global.cout)} />
            <Stat label="Décaissé" value={cdf(d.global.decaisse)} hint={`Engagé : ${cdf(d.global.engage)}`} tone="vert" />
            <Stat label="Exécution financière" value={`${d.global.tauxFinancier} %`} tone="jaune" />
            <Stat label="Exécution physique" value={`${d.global.tauxPhysique} %`} hint="Moyenne pondérée par le coût" tone="violet" />
          </div>
          <Card title={`Exécution des PTBA validés — ${annee}`} className="mt-4">
            {d.services.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="py-2 pr-3">Service</th><th className="pr-3 text-right">Programmé</th><th className="pr-3 text-right">Engagé</th><th className="pr-3 text-right">Décaissé</th><th className="w-40 pr-3">Physique</th><th className="w-40">Financier</th></tr></thead>
                  <tbody>{d.services.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100"><td className="py-2 pr-3"><b>{s.sigle}</b> <span className="text-xs text-slate-500">{s.libelle}</span></td><td className="pr-3 text-right tabular-nums">{cdf(s.cout)}</td><td className="pr-3 text-right tabular-nums">{cdf(s.engage)}</td><td className="pr-3 text-right tabular-nums">{cdf(s.decaisse)}</td><td className="pr-3"><Progress value={s.tauxPhysique} /></td><td><Progress value={Math.round(s.tauxFinancier)} /></td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty message="Aucun PTBA validé pour cet exercice." />}
          </Card>
        </>
      )}
    </Loadable>
  );
}

function Referentiel({ referentiel, reload }) {
  const [edition, setEdition] = useState(null);
  const gerer = referentiel.droits.gerer;
  const enregistrer = async () => {
    const { type, id, ...body } = edition;
    const chemins = { exercice: 'exercices', programme: 'programmes', action: 'actions', service: 'services' };
    if (body.annee) body.annee = Number(body.annee);
    if (body.programme_id) body.programme_id = Number(body.programme_id);
    await runAction(() => (id ? api.put(`/planification/${chemins[type]}/${id}`, body) : api.post(`/planification/${chemins[type]}`, body)), 'Référentiel mis à jour.');
    setEdition(null); reload();
  };
  const champ = (k, label, props = {}) => <Field label={label}><input className="input" value={edition[k] ?? ''} onChange={(e) => setEdition({ ...edition, [k]: e.target.value })} {...props} /></Field>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Exercices" actions={gerer && <button type="button" className="btn-secondary" onClick={() => setEdition({ type: 'exercice', annee: new Date().getFullYear() + 1, statut: 'PREPARATION' })}><Plus size={14} /> Exercice</button>}>
        <ul className="space-y-1 text-sm">{referentiel.exercices.map((e) => <li key={e.id} className="flex justify-between"><span className="font-semibold">{e.annee}</span><button type="button" className="text-xs text-dep-700 hover:underline disabled:text-slate-500" disabled={!gerer} onClick={() => setEdition({ type: 'exercice', id: e.id, annee: e.annee, statut: e.statut })}>{({ PREPARATION: 'En préparation', EXECUTION: 'En exécution', CLOTURE: 'Clôturé' })[e.statut]}</button></li>)}</ul>
      </Card>
      <Card title="Programmes et actions" className="lg:col-span-2" actions={gerer && <button type="button" className="btn-secondary" onClick={() => setEdition({ type: 'programme', code: '', libelle: '', objectif_global: '' })}><Plus size={14} /> Programme</button>}>
        {referentiel.programmes.length ? referentiel.programmes.map((p) => (
          <div key={p.id} className="mb-3 border-b border-slate-100 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" disabled={!gerer} className="text-left font-semibold text-dep-800" onClick={() => setEdition({ type: 'programme', id: p.id, code: p.code, libelle: p.libelle, objectif_global: p.objectif_global || '', ordre: p.ordre })}>Programme {p.code} — {p.libelle}</button>
              {gerer && <button type="button" className="text-xs text-dep-700 hover:underline" onClick={() => setEdition({ type: 'action', programme_id: p.id, code: '', libelle: '', services_normatifs: '', operateurs: '' })}>+ action</button>}</div>
            <ul className="ml-4 mt-1 space-y-0.5 text-sm">{p.actions.map((a) => <li key={a.id}><button type="button" disabled={!gerer} className="text-left" onClick={() => setEdition({ type: 'action', id: a.id, programme_id: p.id, code: a.code, libelle: a.libelle, services_normatifs: a.services_normatifs || '', operateurs: a.operateurs || '' })}>Action {a.code} : {a.libelle}</button></li>)}</ul>
          </div>
        )) : <Empty message="Aucun programme : saisissez la maquette programmatique du Ministère." />}
      </Card>
      <Card title="Services du Ministère" className="lg:col-span-3" actions={gerer && <button type="button" className="btn-secondary" onClick={() => setEdition({ type: 'service', sigle: '', libelle: '' })}><Plus size={14} /> Service</button>}>
        <div className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">{referentiel.services.map((s) => <button key={s.id} type="button" disabled={!gerer} className="text-left" onClick={() => setEdition({ type: 'service', id: s.id, sigle: s.sigle, libelle: s.libelle, actif: s.actif })}><b>{s.sigle}</b> — {s.libelle}{!s.actif && ' (inactif)'}</button>)}</div>
      </Card>
      {edition && (
        <Modal open title={{ exercice: 'Exercice', programme: 'Programme', action: 'Action', service: 'Service du Ministère' }[edition.type]} onClose={() => setEdition(null)} footer={<><button type="button" className="btn-secondary" onClick={() => setEdition(null)}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
          <div className="grid gap-3">
            {edition.type === 'exercice' && <>{champ('annee', 'Année', { type: 'number' })}<Field label="État"><select className="input" value={edition.statut} onChange={(e) => setEdition({ ...edition, statut: e.target.value })}><option value="PREPARATION">En préparation</option><option value="EXECUTION">En exécution</option><option value="CLOTURE">Clôturé</option></select></Field></>}
            {edition.type === 'programme' && <>{champ('code', 'Code')}{champ('libelle', 'Intitulé')}<Field label="Objectif global"><textarea className="input" rows={3} value={edition.objectif_global} onChange={(e) => setEdition({ ...edition, objectif_global: e.target.value })} /></Field></>}
            {edition.type === 'action' && <>{champ('code', 'Code')}{champ('libelle', 'Intitulé')}{champ('services_normatifs', 'Services normatifs')}{champ('operateurs', 'Opérateurs')}</>}
            {edition.type === 'service' && <>{champ('sigle', 'Sigle')}{champ('libelle', 'Intitulé')}</>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Planification : PTBA des services du Ministère, exécution, référentiel. */
export default function Planification() {
  const ref = useApi('/planification/referentiel');
  const [onglet, setOnglet] = useState('ptba');
  const [annee, setAnnee] = useState(null);
  useEffect(() => { if (ref.data && !annee) setAnnee(ref.data.exercices[0]?.annee || new Date().getFullYear()); }, [ref.data, annee]);
  return (
    <>
      <PageHeader title="Planification" subtitle="Plans de Travail Annuels Budgétisés des services du Ministère, consolidés par la DEP, et suivi de leur exécution."
        breadcrumb={[{ label: 'Planification' }, { label: 'PTBA' }]}
        actions={ref.data?.exercices.length > 0 && <select className="input w-32" value={annee || ''} onChange={(e) => setAnnee(Number(e.target.value))} aria-label="Exercice">{ref.data.exercices.map((e) => <option key={e.id} value={e.annee}>{e.annee}</option>)}</select>} />
      <Tabs value={onglet} onChange={setOnglet} tabs={[{ value: 'ptba', label: 'PTBA' }, { value: 'execution', label: 'Exécution' }, { value: 'referentiel', label: 'Référentiel' }]} />
      <Loadable state={ref}>
        {(r) => (
          <>
            {!r.exercices.length && onglet !== 'referentiel' && <InfoAlert>Aucun exercice : ouvrez un exercice dans l’onglet Référentiel.</InfoAlert>}
            {onglet === 'ptba' && annee && r.exercices.length > 0 && <ListePtba referentiel={r} annee={annee} />}
            {onglet === 'execution' && annee && r.exercices.length > 0 && <Execution annee={annee} />}
            {onglet === 'referentiel' && <Referentiel referentiel={r} reload={ref.reload} />}
          </>
        )}
      </Loadable>
    </>
  );
}
