import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Plus, Upload } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useApi, Loadable, PageHeader, Tabs, DataTable, StatusBadge, Card, Modal, Field, InfoAlert, Select, Badge, runAction, toast } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import Indicateurs from './Indicateurs';
import Tableaux from './Tableaux';
import { Bulletins } from './BulletinDetail';

export const STATUTS_ACTEUR = { ACTIF: 'Actif', SUSPENDU: 'Suspendu', CESSE: 'Cessé' };
export const SOURCES = { PAPIER: 'Formulaire papier', FICHIER: 'Fichier reçu', COURRIEL: 'Courriel', ENTRETIEN: 'Entretien' };

/** Formulaire d’un acteur de l’annuaire (création ou modification). */
export function ActeurModal({ acteur, referentiel, onClose, onSaved }) {
  const [f, setF] = useState({ statut: 'ACTIF', ...acteur });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const champ = (k, label, props = {}) => <Field label={label} required={props.required}><input className="input" value={f[k] ?? ''} onChange={up(k)} {...props} /></Field>;
  const enregistrer = async () => {
    const b = { ...f };
    for (const k of ['annee_creation', 'effectif']) b[k] = b[k] === '' || b[k] === undefined || b[k] === null ? null : Number(b[k]);
    for (const k of ['categorie_id', 'zone_id']) b[k] = Number(b[k]);
    const r = await runAction(() => (f.id ? api.put(`/donnees/acteurs/${f.id}`, b) : api.post('/donnees/acteurs', b)), f.id ? 'Fiche mise à jour.' : 'Acteur enregistré dans l’annuaire.');
    onSaved(r.data);
  };
  return (
    <Modal open size="lg" title={f.id ? `Acteur ${f.reference}` : 'Nouvel acteur'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">{champ('raison_sociale', 'Raison sociale', { required: true })}</div>
        {champ('sigle', 'Sigle')}
        <Field label="Catégorie" required><select className="input" value={f.categorie_id || ''} onChange={up('categorie_id')}><option value="">—</option>{referentiel.categories.filter((c) => c.actif || c.id === Number(f.categorie_id)).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></Field>
        <Field label="Province" required><select className="input" value={f.zone_id || ''} onChange={up('zone_id')}><option value="">—</option>{referentiel.zones.filter((z) => z.actif || z.id === Number(f.zone_id)).map((z) => <option key={z.id} value={z.id}>{z.libelle}</option>)}</select></Field>
        {champ('ville', 'Ville')}
        <div className="sm:col-span-2">{champ('adresse', 'Adresse')}</div>
        {champ('forme_juridique', 'Forme juridique')}
        {champ('rccm', 'RCCM')}{champ('id_nat', 'Identification nationale')}{champ('numero_impot', 'N° impôt')}
        {champ('telephone', 'Téléphone')}{champ('email', 'Courriel', { type: 'email' })}{champ('site_web', 'Site web')}
        {champ('responsable', 'Responsable')}{champ('annee_creation', 'Année de création', { type: 'number', min: 1900, max: 2100 })}{champ('effectif', 'Effectif', { type: 'number', min: 0 })}
        <Field label="Statut"><select className="input" value={f.statut} onChange={up('statut')}>{Object.entries(STATUTS_ACTEUR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Observations" className="sm:col-span-3"><textarea className="input" rows={2} value={f.observations || ''} onChange={up('observations')} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Un acteur ne peut figurer deux fois dans l’annuaire : même RCCM, même identification nationale ou même raison sociale dans une province.</p>
    </Modal>
  );
}

const ETATS_IMPORT = { NOUVEAU: ['Nouveau', 'succes'], DOUBLON: ['Doublon', 'attention'], ERREUR: ['Erreur', 'danger'] };

function ImportModal({ onClose, onDone }) {
  const [analyse, setAnalyse] = useState(null);
  const [nom, setNom] = useState('');
  const [choix, setChoix] = useState({});
  const [busy, setBusy] = useState(false);
  const analyser = async (fichier) => {
    if (!fichier) return;
    const fd = new FormData(); fd.append('fichier', fichier);
    setBusy(true); setNom(fichier.name);
    try {
      const r = await api.post('/donnees/acteurs/import/analyser', fd);
      setAnalyse(r.data);
      setChoix(Object.fromEntries(r.data.lignes.map((l, i) => [i, l.etat === 'NOUVEAU'])));
    } catch (e) { toast.error(errorMessage(e)); setAnalyse(null); } finally { setBusy(false); }
  };
  const retenues = analyse ? analyse.lignes.filter((l, i) => choix[i] && l.etat === 'NOUVEAU') : [];
  const confirmer = async () => {
    await runAction(() => api.post('/donnees/acteurs/import/confirmer', { fichier: nom, acteurs: retenues.map((l) => l.acteur) }), `${retenues.length} acteur(s) ajouté(s) à l’annuaire.`);
    onDone();
  };
  return (
    <Modal open size="xl" title="Importer des acteurs (modèle Excel)" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!retenues.length} onClick={confirmer}>Importer {retenues.length} acteur(s)</button></>}>
      <div className="space-y-3">
        <InfoAlert>Remplissez le <button type="button" className="font-semibold underline" onClick={() => download('/donnees/acteurs/modele', 'Modele-import-annuaire.xlsx').catch((e) => toast.error(errorMessage(e)))}>modèle d’import</button> (listes des catégories et provinces incluses). Chaque ligne est contrôlée avant import : les doublons et les lignes en erreur ne sont pas importés.</InfoAlert>
        <Field label="Classeur Excel (.xlsx)" required><input type="file" accept=".xlsx" className="input" disabled={busy} onChange={(e) => analyser(e.target.files[0])} /></Field>
        {busy && <p className="text-sm text-slate-500">Analyse du classeur…</p>}
        {analyse && (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              {Object.entries(ETATS_IMPORT).map(([k, [l, t]]) => <Badge key={k} tone={t}>{analyse.lignes.filter((x) => x.etat === k).length} {l.toLowerCase()}(s)</Badge>)}
              <span className="text-slate-500">— feuille « {analyse.feuille} »</span>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-2 py-1.5" /><th className="px-2">Ligne</th><th className="px-2">Acteur</th><th className="px-2">Catégorie · province</th><th className="px-2">Contrôle</th></tr></thead>
                <tbody>{analyse.lignes.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Importer la ligne ${l.ligne}`} disabled={l.etat !== 'NOUVEAU'} checked={!!choix[i] && l.etat === 'NOUVEAU'} onChange={(e) => setChoix({ ...choix, [i]: e.target.checked })} /></td>
                    <td className="px-2 py-1.5 tabular-nums">{l.ligne}</td>
                    <td className="px-2 py-1.5 font-medium">{l.acteur.raison_sociale || '—'}{l.acteur.sigle && <span className="text-slate-500"> ({l.acteur.sigle})</span>}</td>
                    <td className="px-2 py-1.5 text-xs">{l.categorie || '—'} · {l.zone || '—'}</td>
                    <td className="px-2 py-1.5"><Badge tone={ETATS_IMPORT[l.etat][1]}>{ETATS_IMPORT[l.etat][0]}</Badge>{l.motif && <div className="text-xs text-slate-600">{l.motif}</div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Annuaire({ referentiel }) {
  const [filtres, setFiltres] = useState({ categorie: '', zone: '', statut: '' });
  const qs = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v)).toString();
  const state = useApi(`/donnees/acteurs${qs ? `?${qs}` : ''}`, [qs]);
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const d = referentiel.droits;
  return (
    <Loadable state={state}>
      {(r) => (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select label="Catégorie" placeholder="Toutes catégories" value={filtres.categorie} onChange={(v) => setFiltres({ ...filtres, categorie: v })} options={referentiel.categories.map((c) => [c.id, c.libelle])} />
            <Select label="Province" placeholder="Toutes provinces" value={filtres.zone} onChange={(v) => setFiltres({ ...filtres, zone: v })} options={referentiel.zones.map((z) => [z.id, z.libelle])} />
            <Select label="Statut" placeholder="Tous statuts" value={filtres.statut} onChange={(v) => setFiltres({ ...filtres, statut: v })} options={Object.entries(STATUTS_ACTEUR)} />
            <div className="ml-auto flex flex-wrap gap-2">
              {d.exporter && <button type="button" className="btn-secondary" onClick={() => download('/donnees/acteurs/export', 'Annuaire.xlsx').catch((e) => toast.error(errorMessage(e)))}><FileSpreadsheet size={16} /> Excel</button>}
              {d.annuaire && <button type="button" className="btn-secondary" onClick={() => setModal('import')}><Upload size={16} /> Importer</button>}
              {d.annuaire && <button type="button" className="btn-primary" onClick={() => setModal('nouveau')}><Plus size={16} /> Acteur</button>}
            </div>
          </div>
          <DataTable rows={r.data} onRowClick={(a) => navigate(`/donnees/acteurs/${a.id}`)} empty="Aucun acteur dans l’annuaire."
            columns={[
              { key: 'raison_sociale', header: 'Acteur', render: (a) => <div><div className="font-medium">{a.raison_sociale}{a.sigle && <span className="text-slate-500"> ({a.sigle})</span>}</div><div className="text-xs text-slate-500">{a.reference}</div></div>, search: (a) => `${a.raison_sociale} ${a.sigle || ''} ${a.reference} ${a.rccm || ''} ${a.id_nat || ''} ${a.ville || ''}` },
              { key: 'categorie', header: 'Catégorie' },
              { key: 'zone', header: 'Province', render: (a) => <>{a.zone}{a.ville && <div className="text-xs text-slate-500">{a.ville}</div>}</> },
              { key: 'rccm', header: 'RCCM / Id. nat.', render: (a) => <span className="text-xs">{a.rccm || '—'}<br />{a.id_nat || ''}</span> },
              { key: 'reponses', header: 'Réponses' },
              { key: 'statut', header: 'Statut', render: (a) => <StatusBadge value={a.statut} /> },
            ]} />
          {modal === 'nouveau' && <ActeurModal referentiel={referentiel} onClose={() => setModal(null)} onSaved={(a) => navigate(`/donnees/acteurs/${a.id}`)} />}
          {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
        </>
      )}
    </Loadable>
  );
}

function Questionnaires({ referentiel }) {
  const state = useApi('/donnees/questionnaires');
  const navigate = useNavigate();
  const [nouveau, setNouveau] = useState(null);
  const creer = async () => {
    const r = await runAction(() => api.post('/donnees/questionnaires', nouveau), 'Questionnaire créé.');
    navigate(`/donnees/questionnaires/${r.data.id}`);
  };
  return (
    <Loadable state={state}>
      {(r) => (
        <>
          <div className="mb-3 flex justify-end">{referentiel.droits.questionnaires && <button type="button" className="btn-primary" onClick={() => setNouveau({ code: '', titre: '', description: '' })}><Plus size={16} /> Questionnaire</button>}</div>
          <DataTable rows={r.data} onRowClick={(q) => navigate(`/donnees/questionnaires/${q.id}`)} empty="Aucun questionnaire."
            columns={[
              { key: 'code', header: 'Code' },
              { key: 'titre', header: 'Questionnaire', render: (q) => <div><div className="font-medium">{q.titre}</div>{q.description && <div className="line-clamp-1 text-xs text-slate-500">{q.description}</div>}</div> },
              { key: 'version_publiee', header: 'Version en vigueur', render: (q) => (q.version_publiee ? `v${q.version_publiee}` : <span className="text-slate-500">aucune</span>) },
              { key: 'brouillons', header: 'En préparation', render: (q) => (q.brouillons ? <Badge tone="attention">Version en préparation</Badge> : '—') },
              { key: 'campagnes', header: 'Campagnes' },
              { key: 'actif', header: 'État', render: (q) => (q.actif ? <Badge tone="succes">Actif</Badge> : <Badge>Inactif</Badge>) },
            ]} />
          {nouveau && (
            <Modal open title="Nouveau questionnaire" onClose={() => setNouveau(null)} footer={<><button type="button" className="btn-secondary" onClick={() => setNouveau(null)}>Annuler</button><button type="button" className="btn-primary" onClick={creer}>Créer</button></>}>
              <div className="grid gap-3">
                <Field label="Code" required hint="Ex. ENQ-FAI : 2 à 30 lettres, chiffres, - ou _."><input className="input" value={nouveau.code} onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })} /></Field>
                <Field label="Titre" required><input className="input" value={nouveau.titre} onChange={(e) => setNouveau({ ...nouveau, titre: e.target.value })} /></Field>
                <Field label="Description"><textarea className="input" rows={3} value={nouveau.description} onChange={(e) => setNouveau({ ...nouveau, description: e.target.value })} /></Field>
              </div>
            </Modal>
          )}
        </>
      )}
    </Loadable>
  );
}

/** Formulaire de campagne (création ou modification en préparation). */
export function CampagneModal({ campagne, referentiel, onClose, onSaved }) {
  const qs = useApi('/donnees/questionnaires');
  const [f, setF] = useState(() => ({ titre: '', version_id: '', periode: '', periode_debut: '', periode_fin: '', echeance: '', zones: [], categories: [], responsable_id: '', instructions: '', ...campagne }));
  const [versions, setVersions] = useState(null);
  const [questionnaire, setQuestionnaire] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const choisirQuestionnaire = async (id) => {
    setQuestionnaire(id); setVersions(null);
    if (!id) return;
    const r = await api.get(`/donnees/questionnaires/${id}`);
    const pub = r.data.versions.filter((v) => v.statut === 'PUBLIEE');
    setVersions(pub);
    setF((x) => ({ ...x, version_id: pub[0]?.id || '' }));
  };
  const bascule = (k, id) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const enregistrer = async () => {
    const b = { ...f, version_id: Number(f.version_id), responsable_id: Number(f.responsable_id), periode_debut: String(f.periode_debut).slice(0, 10), periode_fin: String(f.periode_fin).slice(0, 10), echeance: String(f.echeance).slice(0, 10) };
    const r = await runAction(() => (f.id ? api.put(`/donnees/campagnes/${f.id}`, b) : api.post('/donnees/campagnes', b)), f.id ? 'Campagne mise à jour.' : 'Campagne créée.');
    onSaved(r.data);
  };
  const d = (v) => (v ? String(v).slice(0, 10) : '');
  return (
    <Modal open size="xl" title={f.id ? 'Campagne de collecte' : 'Nouvelle campagne de collecte'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!f.version_id} onClick={enregistrer}>Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Titre" required className="sm:col-span-3"><input className="input" value={f.titre} onChange={up('titre')} /></Field>
        {!f.id && (
          <Field label="Questionnaire" required className="sm:col-span-2"><select className="input" value={questionnaire} onChange={(e) => choisirQuestionnaire(e.target.value)}><option value="">—</option>{(qs.data?.data || []).filter((q) => q.actif && q.version_publiee).map((q) => <option key={q.id} value={q.id}>{q.code} — {q.titre}</option>)}</select></Field>
        )}
        {!f.id && <Field label="Version"><select className="input" value={f.version_id} onChange={up('version_id')} disabled={!versions}>{(versions || []).map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}</select></Field>}
        <Field label="Période" required hint="Ex. 2025, 2026-T1"><input className="input" value={f.periode} onChange={up('periode')} /></Field>
        <Field label="Début de période" required><input className="input" type="date" value={d(f.periode_debut)} onChange={up('periode_debut')} /></Field>
        <Field label="Fin de période" required><input className="input" type="date" value={d(f.periode_fin)} onChange={up('periode_fin')} /></Field>
        <Field label="Échéance de la collecte" required><input className="input" type="date" value={d(f.echeance)} onChange={up('echeance')} /></Field>
        <Field label="Responsable" required className="sm:col-span-2"><select className="input" value={f.responsable_id} onChange={up('responsable_id')}><option value="">—</option>{referentiel.responsables.map((u) => <option key={u.id} value={u.id}>{u.nom} — {u.fonction}{u.structure ? `, ${u.structure}` : ''}</option>)}</select></Field>
        <Field label={`Catégories ciblées (${f.categories.length || 'toutes'})`} className="sm:col-span-3">
          <div className="flex flex-wrap gap-1.5">{referentiel.categories.filter((c) => c.actif).map((c) => <button key={c.id} type="button" aria-pressed={f.categories.includes(c.id)} className={`rounded-full border px-2.5 py-0.5 text-xs ${f.categories.includes(c.id) ? 'border-dep-600 bg-dep-50 text-dep-800' : 'border-slate-300 text-slate-600'}`} onClick={() => bascule('categories', c.id)}>{c.libelle}</button>)}</div>
        </Field>
        <Field label={`Provinces ciblées (${f.zones.length || 'toutes'})`} className="sm:col-span-3">
          <div className="flex flex-wrap gap-1.5">{referentiel.zones.filter((z) => z.actif).map((z) => <button key={z.id} type="button" aria-pressed={f.zones.includes(z.id)} className={`rounded-full border px-2.5 py-0.5 text-xs ${f.zones.includes(z.id) ? 'border-dep-600 bg-dep-50 text-dep-800' : 'border-slate-300 text-slate-600'}`} onClick={() => bascule('zones', z.id)}>{z.libelle}</button>)}</div>
        </Field>
        <Field label="Instructions aux agents de saisie" className="sm:col-span-3"><textarea className="input" rows={3} value={f.instructions || ''} onChange={up('instructions')} /></Field>
      </div>
      {!f.id && <p className="mt-2 text-xs text-slate-500">Les acteurs actifs des catégories et provinces choisies sont ciblés à la création ; le ciblage se complète ensuite acteur par acteur.</p>}
    </Modal>
  );
}

function Campagnes({ referentiel }) {
  const state = useApi('/donnees/campagnes');
  const navigate = useNavigate();
  const [nouvelle, setNouvelle] = useState(false);
  return (
    <Loadable state={state}>
      {(r) => (
        <>
          <div className="mb-3 flex justify-end">{referentiel.droits.questionnaires && <button type="button" className="btn-primary" onClick={() => setNouvelle(true)}><Plus size={16} /> Campagne</button>}</div>
          <DataTable rows={r.data} onRowClick={(c) => navigate(`/donnees/campagnes/${c.id}`)} empty="Aucune campagne de collecte."
            columns={[
              { key: 'titre', header: 'Campagne', render: (c) => <div><div className="font-medium">{c.titre}</div><div className="text-xs text-slate-500">{c.reference} · {c.questionnaire_code} v{c.version}</div></div>, search: (c) => `${c.titre} ${c.reference} ${c.questionnaire_titre}` },
              { key: 'periode', header: 'Période' },
              { key: 'echeance', header: 'Échéance', render: (c) => fmtDate(c.echeance) },
              { key: 'responsable', header: 'Responsable' },
              { key: 'reponses', header: 'Réponses', render: (c) => <span className="tabular-nums">{c.reponses}/{c.cibles}{c.reponses > 0 && <span className="block text-xs text-slate-500">{c.controlees} contrôlée(s)</span>}</span> },
              { key: 'statut', header: 'Statut', render: (c) => <StatusBadge value={c.statut} /> },
            ]} />
          {nouvelle && <CampagneModal referentiel={referentiel} onClose={() => setNouvelle(false)} onSaved={(c) => navigate(`/donnees/campagnes/${c.id}`)} />}
        </>
      )}
    </Loadable>
  );
}

function Referentiel({ referentiel, reload }) {
  const [edition, setEdition] = useState(null);
  const gerer = referentiel.droits.annuaire;
  const enregistrer = async () => {
    const { type, id, ...b } = edition;
    b.ordre = Number(b.ordre) || 0;
    await runAction(() => (id ? api.put(`/donnees/${type}/${id}`, b) : api.post(`/donnees/${type}`, b)), 'Référentiel mis à jour.');
    setEdition(null); reload();
  };
  const liste = (type, titre, rows, libelle) => (
    <Card title={titre} actions={gerer && <button type="button" className="btn-secondary" onClick={() => setEdition(type === 'zones' ? { type, libelle: '', ordre: rows.length + 1, actif: true } : { type, code: '', libelle: '', ordre: rows.length + 1, actif: true })}><Plus size={14} /> Ajouter</button>}>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">{rows.map((x) => (
        <li key={x.id}><button type="button" disabled={!gerer} className={`text-left ${x.actif ? '' : 'text-slate-400 line-through'}`} onClick={() => setEdition({ type, ...x })}>{libelle(x)}</button></li>
      ))}</ul>
    </Card>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {liste('categories', 'Catégories d’acteurs', referentiel.categories, (c) => <><b>{c.code}</b> — {c.libelle}</>)}
      {liste('zones', 'Provinces', referentiel.zones, (z) => z.libelle)}
      {edition && (
        <Modal open title={edition.type === 'zones' ? 'Province' : 'Catégorie d’acteurs'} onClose={() => setEdition(null)} footer={<><button type="button" className="btn-secondary" onClick={() => setEdition(null)}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
          <div className="grid gap-3 sm:grid-cols-3">
            {edition.type === 'categories' && <Field label="Code" required><input className="input" value={edition.code} onChange={(e) => setEdition({ ...edition, code: e.target.value })} /></Field>}
            <Field label="Libellé" required className={edition.type === 'categories' ? 'sm:col-span-2' : 'sm:col-span-3'}><input className="input" value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} /></Field>
            <Field label="Ordre"><input className="input" type="number" min="0" value={edition.ordre} onChange={(e) => setEdition({ ...edition, ordre: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={edition.actif} onChange={(e) => setEdition({ ...edition, actif: e.target.checked })} /> Actif (proposé à la saisie)</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Données sectorielles : annuaire des acteurs, questionnaires, campagnes de collecte, référentiel. */
export default function Donnees() {
  const ref = useApi('/donnees/referentiel');
  const [onglet, setOnglet] = useState(() => { try { return sessionStorage.getItem('donnees.onglet') || 'annuaire'; } catch { return 'annuaire'; } });
  const choisir = (o) => { setOnglet(o); try { sessionStorage.setItem('donnees.onglet', o); } catch { /* stockage indisponible */ } };
  return (
    <>
      <PageHeader title="Données sectorielles" subtitle="Annuaire des acteurs du numérique, collecte et contrôle de la qualité des données, indicateurs, tableaux croisés et bulletins internes."
        breadcrumb={[{ label: 'Données sectorielles' }]} />
      <Tabs value={onglet} onChange={choisir} tabs={[{ value: 'annuaire', label: 'Annuaire des acteurs' }, { value: 'campagnes', label: 'Campagnes' }, { value: 'questionnaires', label: 'Questionnaires' }, { value: 'indicateurs', label: 'Indicateurs' }, { value: 'tableaux', label: 'Tableaux croisés' }, { value: 'bulletins', label: 'Bulletins' }, { value: 'referentiel', label: 'Référentiel' }]} />
      <Loadable state={ref}>
        {(r) => (
          <>
            {onglet === 'annuaire' && <Annuaire referentiel={r} />}
            {onglet === 'campagnes' && <Campagnes referentiel={r} />}
            {onglet === 'questionnaires' && <Questionnaires referentiel={r} />}
            {onglet === 'indicateurs' && <Indicateurs referentiel={r} />}
            {onglet === 'tableaux' && <Tableaux />}
            {onglet === 'bulletins' && <Bulletins referentiel={r} />}
            {onglet === 'referentiel' && <Referentiel referentiel={r} reload={ref.reload} />}
          </>
        )}
      </Loadable>
    </>
  );
}
