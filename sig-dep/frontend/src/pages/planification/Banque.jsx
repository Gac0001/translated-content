import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, Card, DataTable, StatusBadge, Badge, Modal, Field, InfoAlert, Empty, runAction } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { cdf } from './Planification';

export const MATURITES = { IDEE: 'Idée de projet', ETUDE: 'En étude', PRET: 'Prêt à financer', EN_COURS: 'En exécution', ACHEVE: 'Achevé', ABANDONNE: 'Abandonné' };
const TONS_MATURITE = { IDEE: 'neutre', ETUDE: 'info', PRET: 'succes', EN_COURS: 'attention', ACHEVE: 'succes', ABANDONNE: 'danger' };
export const NIVEAUX = { 1: 'Faible', 2: 'Moyen', 3: 'Fort' };
export const STATUTS_RISQUE = { OUVERT: 'Ouvert', MAITRISE: 'Maîtrisé', CLOS: 'Clos' };

export function Criticite({ p, i }) {
  const c = p * i;
  return <Badge tone={c >= 6 ? 'danger' : c >= 3 ? 'attention' : 'succes'} title={`Probabilité ${p}/3 × impact ${i}/3`}>{c >= 6 ? 'Critique' : c >= 3 ? 'Modérée' : 'Faible'} ({c})</Badge>;
}

/** Saisie d’un risque : objet concerné, probabilité, impact, mesures d’atténuation. */
export function RisqueModal({ risque, objets, onClose, onSaved }) {
  const [f, setF] = useState({ statut: 'OUVERT', probabilite: 2, impact: 2, mesures: '', responsable: '', echeance: '', ...risque });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enregistrer = async () => {
    const [entity_type, entity_id] = (f.objet || `${f.entity_type}:${f.entity_id}`).split(':');
    const b = { entity_type, entity_id: Number(entity_id), libelle: f.libelle, probabilite: Number(f.probabilite), impact: Number(f.impact), mesures: f.mesures || null, responsable: f.responsable || null, echeance: f.echeance ? String(f.echeance).slice(0, 10) : null, statut: f.statut };
    await runAction(() => (f.id ? api.put(`/programmation/risques/${f.id}`, b) : api.post('/programmation/risques', b)), 'Risque enregistré.');
    onSaved();
  };
  return (
    <Modal open title={f.id ? 'Risque' : 'Nouveau risque'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {objets && !f.id && <Field label="Concerne" className="sm:col-span-2"><select className="input" value={f.objet || ''} onChange={up('objet')}><option value="">—</option>{objets.map(([g, opts]) => <optgroup key={g} label={g}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}</select></Field>}
        <Field label="Risque" className="sm:col-span-2"><textarea className="input" rows={2} value={f.libelle || ''} onChange={up('libelle')} /></Field>
        <Field label="Probabilité"><select className="input" value={f.probabilite} onChange={up('probabilite')}>{Object.entries(NIVEAUX).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Impact"><select className="input" value={f.impact} onChange={up('impact')}>{Object.entries(NIVEAUX).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Mesures d’atténuation" className="sm:col-span-2"><textarea className="input" rows={3} value={f.mesures || ''} onChange={up('mesures')} /></Field>
        <Field label="Responsable"><input className="input" value={f.responsable || ''} onChange={up('responsable')} /></Field>
        <Field label="Échéance"><input className="input" type="date" value={f.echeance ? String(f.echeance).slice(0, 10) : ''} onChange={up('echeance')} /></Field>
        <Field label="Statut"><select className="input" value={f.statut} onChange={up('statut')}>{Object.entries(STATUTS_RISQUE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Un risque de criticité 6 ou plus (probabilité × impact) est signalé au Directeur.</p>
    </Modal>
  );
}

function FicheProjet({ id, programmes, onClose, onChanged }) {
  const state = useApi(`/programmation/banque/${id}`, [id]);
  const [f, setF] = useState(null);
  const [jalon, setJalon] = useState(null);
  const [risque, setRisque] = useState(null);
  const reload = () => { state.reload(); onChanged(); };
  const enregistrer = async () => {
    await runAction(() => api.put(`/programmation/banque/${id}`, { maturite: f.maturite, programme_id: f.programme_id ? Number(f.programme_id) : null, localisation: f.localisation || null, partenaires: f.partenaires || null }), 'Fiche mise à jour.');
    setF(null); reload();
  };
  const enregistrerJalon = async () => {
    const b = { libelle: jalon.libelle, date_prevue: jalon.date_prevue?.slice(0, 10), date_realisee: jalon.date_realisee ? jalon.date_realisee.slice(0, 10) : null, commentaire: jalon.commentaire || null };
    await runAction(() => (jalon.id ? api.put(`/programmation/jalons/${jalon.id}`, b) : api.post(`/programmation/banque/${id}/jalons`, b)), 'Jalon enregistré.');
    setJalon(null); reload();
  };
  return (
    <Modal open size="lg" title="Projet de la banque" onClose={onClose}>
      <Loadable state={state}>
        {(p) => {
          const e = f || { maturite: p.maturite, programme_id: p.programme_id ? String(p.programme_id) : '', localisation: p.localisation || '', partenaires: p.partenaires || '' };
          const up = (k) => (ev) => setF({ ...e, [k]: ev.target.value });
          const retard = (j) => !j.date_realisee && new Date(j.date_prevue) < new Date();
          return (
            <div className="space-y-4">
              <p className="text-sm"><b>{p.code}</b> — {p.intitule}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Maturité"><select className="input" disabled={!p.droits.suivre} value={e.maturite} onChange={up('maturite')}>{Object.entries(MATURITES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Programme"><select className="input" disabled={!p.droits.suivre} value={e.programme_id} onChange={up('programme_id')}><option value="">—</option>{programmes.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.libelle}</option>)}</select></Field>
                <Field label="Localisation"><input className="input" disabled={!p.droits.suivre} value={e.localisation} onChange={up('localisation')} /></Field>
                <Field label="Partenaires"><input className="input" disabled={!p.droits.suivre} value={e.partenaires} onChange={up('partenaires')} /></Field>
              </div>
              {p.droits.suivre && <button type="button" className="btn-primary" disabled={!f} onClick={enregistrer}>Enregistrer la fiche</button>}
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold text-dep-800">Jalons</h3>{p.droits.suivre && <button type="button" className="btn-secondary" onClick={() => setJalon({ libelle: '', date_prevue: '', date_realisee: '', commentaire: '' })}><Plus size={14} /> Jalon</button>}</div>
                {p.jalons.length ? (
                  <ul className="divide-y text-sm">{p.jalons.map((j) => (
                    <li key={j.id} className="flex items-center justify-between py-1.5">
                      <button type="button" className="text-left" disabled={!p.droits.suivre} onClick={() => setJalon(j)}>{j.libelle}{j.commentaire && <span className="block text-xs text-slate-500">{j.commentaire}</span>}</button>
                      <span className="whitespace-nowrap text-xs">Prévu {fmtDate(j.date_prevue)} · {j.date_realisee ? <span className="text-emerald-700">réalisé {fmtDate(j.date_realisee)}</span> : retard(j) ? <span className="font-semibold text-red-700">en retard</span> : 'à venir'}</span>
                    </li>
                  ))}</ul>
                ) : <Empty compact message="Aucun jalon." />}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold text-dep-800">Risques</h3>{p.droits.suivre && <button type="button" className="btn-secondary" onClick={() => setRisque({ entity_type: 'PIP', entity_id: p.id })}><Plus size={14} /> Risque</button>}</div>
                {p.risques.length ? (
                  <ul className="divide-y text-sm">{p.risques.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-1.5"><button type="button" className="text-left" disabled={!p.droits.suivre} onClick={() => setRisque(r)}>{r.libelle}</button><span className="flex shrink-0 gap-1"><Criticite p={r.probabilite} i={r.impact} /><Badge tone="neutre">{STATUTS_RISQUE[r.statut]}</Badge></span></li>
                  ))}</ul>
                ) : <Empty compact message="Aucun risque identifié." />}
              </div>
              {jalon && (
                <Modal open title="Jalon" onClose={() => setJalon(null)} footer={<><button type="button" className="btn-secondary" onClick={() => setJalon(null)}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrerJalon}>Enregistrer</button></>}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Jalon" className="sm:col-span-2"><input className="input" value={jalon.libelle} onChange={(ev) => setJalon({ ...jalon, libelle: ev.target.value })} /></Field>
                    <Field label="Date prévue"><input className="input" type="date" value={jalon.date_prevue?.slice(0, 10) || ''} onChange={(ev) => setJalon({ ...jalon, date_prevue: ev.target.value })} /></Field>
                    <Field label="Date de réalisation"><input className="input" type="date" value={jalon.date_realisee?.slice(0, 10) || ''} onChange={(ev) => setJalon({ ...jalon, date_realisee: ev.target.value })} /></Field>
                    <Field label="Commentaire" className="sm:col-span-2"><textarea className="input" rows={2} value={jalon.commentaire || ''} onChange={(ev) => setJalon({ ...jalon, commentaire: ev.target.value })} /></Field>
                  </div>
                </Modal>
              )}
              {risque && <RisqueModal risque={risque} onClose={() => setRisque(null)} onSaved={() => { setRisque(null); reload(); }} />}
            </div>
          );
        }}
      </Loadable>
    </Modal>
  );
}

/** Banque des projets : fiches PIP soumises, maturité, rattachement aux programmes, jalons et risques. */
export default function Banque({ programmes }) {
  const state = useApi('/programmation/banque');
  const [fiche, setFiche] = useState(null);
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>La banque reprend les fiches du Programme d’Investissements Publics (PIP) soumises. Le Bureau Suivi-Évaluation y suit la maturité des projets, leurs jalons et leurs risques.</InfoAlert>
          <Card title="Banque des projets" bodyClass="p-0">
            <DataTable rows={d.data} onRowClick={(p) => setFiche(p.id)} empty="Aucune fiche PIP soumise."
              columns={[
                { key: 'code', header: 'Code' },
                { key: 'intitule', header: 'Projet', render: (p) => <div><div className="font-medium">{p.intitule}</div>{p.programme_libelle && <div className="text-xs text-slate-500">{p.programme_libelle}</div>}</div>, search: (p) => `${p.intitule} ${p.programme_libelle || ''}` },
                { key: 'maturite', header: 'Maturité', render: (p) => <Badge tone={TONS_MATURITE[p.maturite]}>{MATURITES[p.maturite]}</Badge> },
                { key: 'cout_total', header: 'Coût', render: (p) => <span className="whitespace-nowrap tabular-nums">{p.devise && p.devise !== 'CDF' ? `${Math.round(p.cout_total).toLocaleString('fr-FR')} ${p.devise}` : cdf(p.cout_total)}</span> },
                { key: 'jalons', header: 'Jalons', render: (p) => <>{p.jalons}{p.jalons_en_retard > 0 && <span className="ml-1 text-xs font-semibold text-red-700">({p.jalons_en_retard} en retard)</span>}</> },
                { key: 'risques_ouverts', header: 'Risques ouverts' },
                { key: 'statut', header: 'Fiche PIP', render: (p) => <StatusBadge value={p.statut} /> },
              ]} />
          </Card>
          {fiche && <FicheProjet id={fiche} programmes={programmes} onClose={() => setFiche(null)} onChanged={state.reload} />}
        </div>
      )}
    </Loadable>
  );
}
