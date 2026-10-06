import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, RotateCcw, Upload, XCircle } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { PageHeader, Card, InfoAlert, ErrorAlert, Field, Badge, Stat, toast, UnsavedChangesGuard } from '../../components/ui';
import { aujourdhui } from '../../lib/format';
import { COLORS } from '../../lib/labels';

const ROLES = { CHEF_DIVISION: 'Chef de Division', CHEF_BUREAU: 'Chef de Bureau', AGENT: 'Agent' };
const NIVEAUX = {
  erreur: [COLORS.danger, XCircle],
  avertissement: [COLORS.attention, AlertTriangle],
  info: [COLORS.info, Info],
};

function Anomalies({ list: all }) {
  // Les informations (normalisation, sexe manquant) sont résumées en tête de tableau.
  const list = all.filter((a) => a.niveau !== 'info');
  if (!list.length) return <Badge tone="succes"><CheckCircle2 size={12} /> Conforme</Badge>;
  return (
    <ul className="space-y-1">
      {list.map((a, i) => { const [cls, Icon] = NIVEAUX[a.niveau]; return <li key={i}><span className={`inline-flex items-start gap-1 rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ${cls}`}><Icon size={12} className="mt-0.5 shrink-0" />{a.message}</span></li>; })}
    </ul>
  );
}

export default function AgentImport() {
  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [erreursServeur, setErreursServeur] = useState([]);
  const [rapport, setRapport] = useState(null);
  const [dateAff, setDateAff] = useState(aujourdhui);
  const [mode, setMode] = useState('ignorer');

  const analyser = async () => {
    setBusy(true); setErreur(null); setErreursServeur([]);
    try {
      const fd = new FormData(); fd.append('fichier', fichier);
      const r = await api.post('/imports/personnel/analyser', fd);
      setAnalyse(r.data);
      setLignes(r.data.lignes.map((l) => ({
        ...l, inclure: !l.anomalies.some((a) => a.niveau === 'erreur'),
        structureKey: l.structure && l.structure.type !== 'DIRECTION' ? `${l.structure.type}:${l.structure.id}` : '',
      })));
    } catch (e) { setErreur(errorMessage(e)); } finally { setBusy(false); }
  };

  const set = (i, patch) => setLignes((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const n = { ...l, ...patch };
    if (patch.structureKey !== undefined) {
      const [t] = patch.structureKey.split(':');
      n.role = t === 'DIVISION' ? 'CHEF_DIVISION' : t === 'BUREAU' ? (l.role === 'CHEF_BUREAU' ? 'CHEF_BUREAU' : 'AGENT') : null;
    }
    return n;
  }));

  const retenues = lignes.filter((l) => l.inclure);
  const erreursParLigne = useMemo(() => Object.fromEntries(erreursServeur.map((e) => [e.ligne, e.message])), [erreursServeur]);

  const executer = async () => {
    setBusy(true); setErreur(null); setErreursServeur([]);
    try {
      const payload = retenues.map((l) => {
        const [t, id] = (l.structureKey || ':').split(':');
        return {
          ligne: l.ligne, matricule: l.matricule, nom: l.nom, postnom: l.postnom || null, prenom: l.prenom || null,
          sexe: l.sexe || null, grade_id: l.grade_id ? Number(l.grade_id) : null, telephone: l.telephone || null, email: l.email || null,
          structure_type: t || null, structure_id: id ? Number(id) : null, role: t ? l.role : null,
        };
      });
      const r = await api.post('/imports/personnel/executer', { fichier: analyse.fichier, date_affectation: dateAff, mode_existants: mode, lignes: payload });
      setRapport(r.data);
      toast.success(`Import terminé : ${r.data.crees} créé(s), ${r.data.misAJour} mis à jour.`);
    } catch (e) {
      setErreur(errorMessage(e));
      setErreursServeur(e.response?.data?.error?.details || []);
    } finally { setBusy(false); }
  };

  const recommencer = () => { setFichier(null); setAnalyse(null); setLignes([]); setRapport(null); setErreur(null); setErreursServeur([]); };
  const modele = () => download('/imports/personnel/modele.xlsx', 'modele-import-personnel-DEP.xlsx').catch((e) => toast.error(errorMessage(e)));

  return (
    <>
      <UnsavedChangesGuard when={!!analyse && !rapport && !busy} message="L’analyse et vos corrections ligne par ligne n’ont pas été importées. Si vous quittez cette page, elles seront perdues." />
      <PageHeader title="Importer une liste du personnel" subtitle="Word (.docx), Excel (.xlsx) ou CSV — par exemple la liste officielle des agents de la DEP." breadcrumb={[{ label: 'Organisation' }, { label: 'Personnel', to: '/personnel' }, { label: 'Import' }]}
        actions={<button type="button" className="btn-secondary" onClick={modele}><FileSpreadsheet size={16} /> Modèle Excel</button>} />
      <ol className="mb-5 flex flex-wrap gap-2 text-sm no-print">
        {['1. Fichier', '2. Vérification', '3. Rapport'].map((e, i) => {
          const etape = rapport ? 2 : analyse ? 1 : 0;
          return <li key={e} className={`rounded-full px-3 py-1 ${i === etape ? 'bg-dep-700 text-white' : i < etape ? 'bg-dep-100 text-dep-800' : 'bg-slate-200 text-slate-600'}`}>{e}</li>;
        })}
      </ol>
      <ErrorAlert message={erreur} />

      {!analyse && (
        <Card title="Fichier à importer" className="mt-3">
          <div className="space-y-4 text-sm">
            <InfoAlert>
              Le tableau doit comporter une ligne d’en-tête avec au moins <b>Nom</b> (ou « NOM, POSTNOM &amp; PRENOM ») et <b>Matricule</b>, et de préférence le <b>grade</b> (colonne GRADE ou FONCTION : CD, CB, ATA1…).
              La structure est lue sur les lignes de section (« 1. Bureau Secrétariat de Direction », « 2.1. Bureau … ») ou dans une colonne « Structure ».
              L’analyse n’enregistre rien : vous vérifiez et corrigez chaque ligne avant l’import.
            </InfoAlert>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-8 text-center hover:border-dep-400 hover:bg-dep-50/40 focus-within:ring-2 focus-within:ring-dep-400">
              <Upload size={28} className="text-dep-600" aria-hidden />
              <span className="font-medium">{fichier ? fichier.name : 'Choisir un fichier'}</span>
              <span className="text-xs text-slate-500">.docx, .xlsx ou .csv — 5 Mo au maximum. Le fichier n’est pas conservé sur le serveur.</span>
              <input type="file" className="sr-only" accept=".docx,.xlsx,.csv" onChange={(e) => setFichier(e.target.files[0] || null)} />
            </label>
            <button type="button" className="btn-primary" disabled={!fichier || busy} onClick={analyser}>{busy ? 'Analyse…' : 'Analyser le fichier'}</button>
          </div>
        </Card>
      )}

      {analyse && !rapport && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Lignes lues" value={analyse.resume.total} />
            <Stat label="Retenues" value={retenues.length} tone="vert" />
            <Stat label="En erreur" value={analyse.resume.erreurs} tone={analyse.resume.erreurs ? 'rouge' : 'gris'} />
            <Stat label="Déjà existants" value={analyse.resume.existants} tone={analyse.resume.existants ? 'jaune' : 'gris'} />
            <Stat label="Sans structure" value={lignes.filter((l) => !l.structureKey).length} tone="gris" />
          </div>
          {analyse.resume.sansResponsable.length > 0 && (
            <InfoAlert tone="warning">
              Structures sans responsable dans ce fichier ni dans SIG-DEP : {analyse.resume.sansResponsable.map((s) => s.nom).join(' ; ')}. Vous pourrez désigner les responsables plus tard par une affectation.
            </InfoAlert>
          )}
          {(() => {
            const norm = lignes.filter((l) => l.anomalies.some((a) => a.message.startsWith('Matricule normalisé'))).length;
            const sexe = lignes.filter((l) => !l.sexe).length;
            return (norm || sexe) ? <InfoAlert>{norm ? `${norm} matricule(s) normalisé(s) (points et espaces retirés, ex. 1.234.567 → 1234567). ` : ''}{sexe ? `${sexe} ligne(s) sans sexe renseigné : vous pouvez le choisir ci-dessous ou le compléter plus tard sur les fiches (il n’est jamais déduit du prénom).` : ''}</InfoAlert> : null;
          })()}
          {!analyse.peutAffecter && <InfoAlert tone="warning">Vous pouvez créer les fiches, mais les affectations relèvent du Directeur : les Agents seront créés sans affectation.</InfoAlert>}
          <Card title={`Vérification — ${analyse.fichier} (${analyse.format})`}>
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <Field label="Date d’effet des affectations"><input type="date" className="input" value={dateAff} onChange={(e) => setDateAff(e.target.value)} /></Field>
              <Field label="Matricules déjà enregistrés">
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}><option value="ignorer">Ignorer ces lignes</option><option value="mettre_a_jour">Mettre à jour la fiche et l’affectation</option></select>
              </Field>
              <div className="flex items-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setLignes((ls) => ls.map((l) => ({ ...l, inclure: true })))}>Tout cocher</button>
                <button type="button" className="btn-ghost" onClick={() => setLignes((ls) => ls.map((l) => ({ ...l, inclure: false })))}>Tout décocher</button>
              </div>
            </div>
            <div className="-mx-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr>{['', 'N°', 'Nom', 'Postnom', 'Prénom', 'Matricule', 'Grade', 'Sexe', 'Structure', 'Poste', 'Contrôles'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>
                  {lignes.map((l, i) => {
                    const [t] = (l.structureKey || ':').split(':');
                    const errServeur = erreursParLigne[l.ligne];
                    return (
                      <tr key={l.ligne} className={`${l.inclure ? '' : 'opacity-50'} ${errServeur ? 'bg-red-50' : ''}`}>
                        <td className="td"><input type="checkbox" aria-label={`Inclure la ligne ${l.numero || l.ligne}`} checked={l.inclure} onChange={(e) => set(i, { inclure: e.target.checked })} /></td>
                        <td className="td text-slate-500">{l.numero || '—'}</td>
                        <td className="td"><input className="input min-w-[110px] py-1" value={l.nom || ''} onChange={(e) => set(i, { nom: e.target.value })} /></td>
                        <td className="td"><input className="input min-w-[110px] py-1" value={l.postnom || ''} onChange={(e) => set(i, { postnom: e.target.value })} /></td>
                        <td className="td"><input className="input min-w-[110px] py-1" value={l.prenom || ''} onChange={(e) => set(i, { prenom: e.target.value })} /></td>
                        <td className="td whitespace-nowrap font-mono text-xs">{l.matricule}</td>
                        <td className="td">
                          <select className="input min-w-[84px] py-1" value={l.grade_id || ''} onChange={(e) => set(i, { grade_id: e.target.value || null })}>
                            <option value="">—</option>
                            {analyse.referentiel.grades.map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}
                          </select>
                        </td>
                        <td className="td"><select className="input min-w-[64px] py-1" value={l.sexe || ''} onChange={(e) => set(i, { sexe: e.target.value || null })}><option value="">—</option><option value="M">M</option><option value="F">F</option></select></td>
                        <td className="td">
                          <select className="input min-w-[250px] py-1" value={l.structureKey} onChange={(e) => set(i, { structureKey: e.target.value })}>
                            <option value="">Sans affectation</option>
                            {[...new Set(analyse.referentiel.structures.map((s) => s.groupe))].map((g) => (
                              <optgroup key={g} label={g}>
                                {analyse.referentiel.structures.filter((s) => s.groupe === g).map((s) => <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>{s.type === 'DIVISION' ? `${s.nom} (niveau Division)` : s.nom}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td className="td">
                          {t === 'BUREAU' && <select className="input min-w-[140px] py-1" value={l.role || 'AGENT'} onChange={(e) => set(i, { role: e.target.value })}><option value="AGENT">Agent</option><option value="CHEF_BUREAU">Chef de Bureau</option></select>}
                          {t === 'DIVISION' && <span className="text-xs">{ROLES.CHEF_DIVISION}</span>}
                          {!t && <span className="text-xs text-slate-400">—</span>}
                        </td>
                        <td className="td min-w-[220px]">
                          {errServeur && <p className="mb-1 text-xs font-medium text-red-700">{errServeur}</p>}
                          <Anomalies list={l.anomalies} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy || !retenues.length} onClick={executer}><Upload size={16} /> {busy ? 'Import…' : `Importer ${retenues.length} ligne(s)`}</button>
            <button type="button" className="btn-secondary" onClick={recommencer}><RotateCcw size={16} /> Autre fichier</button>
          </div>
          <p className="text-xs text-slate-500">L’import est réalisé en une seule opération : si une ligne est refusée par le serveur, rien n’est enregistré et la ligne est signalée en rouge.</p>
        </div>
      )}

      {rapport && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Agents créés" value={rapport.crees} tone="vert" />
            <Stat label="Mis à jour" value={rapport.misAJour} />
            <Stat label="Ignorés" value={rapport.ignores} tone="gris" />
            <Stat label="Affectations" value={rapport.affectations} tone="violet" />
            <Stat label="Sans affectation" value={rapport.sansAffectation} tone={rapport.sansAffectation ? 'jaune' : 'gris'} />
          </div>
          <Card title="Détail par ligne" bodyClass="p-0">
            <table className="min-w-full text-sm"><thead><tr><th className="th">Ligne</th><th className="th">Matricule</th><th className="th">Résultat</th></tr></thead>
              <tbody>{rapport.details.map((d) => <tr key={`${d.ligne}${d.matricule}`}><td className="td">{d.ligne}</td><td className="td font-mono text-xs">{d.matricule}</td><td className="td">{d.resultat}</td></tr>)}</tbody>
            </table>
          </Card>
          <InfoAlert>Étapes suivantes : compléter le sexe, le téléphone et l’adresse électronique sur les fiches (nécessaire pour les notifications par e-mail), désigner les responsables manquants, puis créer les comptes utilisateurs depuis chaque fiche.</InfoAlert>
          <div className="flex gap-2"><Link to="/personnel" className="btn-primary">Voir le personnel</Link><button type="button" className="btn-secondary" onClick={recommencer}>Nouvel import</button></div>
        </div>
      )}
    </>
  );
}
