import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import api from '../../lib/api';
import { ControleCadrage } from './Cadrage';
import { useApi, Loadable, Card, InfoAlert, EmptyState, EditableGrid, UnsavedChangesGuard, runAction, toast } from '../../components/ui';

/** Colonnes du PAP et du CDMT : réalisations A-2, exercice en cours A-1, prévisions A à A+3. */
const colonnes = (A) => [
  { annee: A - 2, type: 'VOTE', label: `Votés ${A - 2}` }, { annee: A - 2, type: 'EXECUTE', label: `Exécutés ${A - 2}` },
  { annee: A - 1, type: 'VOTE', label: `Votés ${A - 1}` }, { annee: A - 1, type: 'EXECUTE_S1', label: `Exécutés fin juin ${A - 1}` },
  ...[A, A + 1, A + 2, A + 3].map((a) => ({ annee: a, type: 'PREVISION', label: `Prévision ${a}` })),
].map((c) => ({ ...c, key: `${c.annee}:${c.type}` }));
const AXES = [['RUBRIQUE', 'Par rubrique budgétaire'], ['TITRE', 'Par titre']];

function Grille({ d, programme, A }) {
  const [niveau, setNiveau] = useState('');
  const [saisie, setSaisie] = useState({}); // { [poste]: { [colonne]: montant | null } }
  const [enCours, setEnCours] = useState(false);
  const action = niveau ? Number(niveau) : null;
  const cols = colonnes(A);
  const existants = useMemo(() => {
    const m = {};
    for (const c of d.credits.filter((r) => r.programme_id === programme.id && (r.action_id || null) === action)) {
      (m[c.poste_id] ||= {})[`${c.annee}:${c.type}`] = Number(c.montant);
    }
    return m;
  }, [d.credits, programme.id, action]);
  const valeurs = useMemo(() => {
    const v = Object.fromEntries(d.postes.map((p) => [p.id, { ...existants[p.id] }]));
    for (const [p, cs] of Object.entries(saisie)) Object.assign(v[p], cs);
    return v;
  }, [d.postes, existants, saisie]);
  const modifiee = (p, c) => saisie[p] && c in saisie[p] && (saisie[p][c] ?? null) !== (existants[p]?.[c] ?? null);
  const modifs = Object.entries(saisie).flatMap(([p, cs]) => Object.keys(cs).filter((c) => modifiee(p, c)).map((c) => [p, c]));
  const enregistrer = async () => {
    const lignes = modifs.map(([p, c]) => { const [annee, type] = c.split(':'); return { annee: Number(annee), type, poste_id: Number(p), programme_id: programme.id, action_id: action, montant: saisie[p][c] }; });
    setEnCours(true);
    try {
      const r = await runAction(() => api.put('/programmation/credits', { lignes }), 'Crédits enregistrés.');
      if (r.data.depassements?.length) toast.error(`Plafond du CBMT dépassé : ${r.data.depassements.map((x) => `${x.rubrique} ${x.annee}`).join(', ')}.`);
      setSaisie({}); d.reload(); d.onSaved();
    } catch { /* erreur déjà signalée */ } finally { setEnCours(false); }
  };
  const editable = d.droits.saisir;
  const { signaler } = d;
  const aSauver = modifs.length > 0 && !enCours;
  useEffect(() => { signaler(programme.id, aSauver); }, [signaler, programme.id, aSauver]);
  useEffect(() => () => signaler(programme.id, false), [signaler, programme.id]);
  return (
    <Card title={`Programme ${programme.code} : ${programme.libelle}`} bodyClass="p-0"
      actions={<div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto max-w-full" value={niveau} onChange={(e) => { setNiveau(e.target.value); setSaisie({}); }} aria-label="Niveau de saisie" disabled={modifs.length > 0}>
          <option value="">Crédits du programme</option>{programme.actions.map((a) => <option key={a.id} value={a.id}>Action {a.code} — {a.libelle}</option>)}
        </select>
        {editable && <button type="button" className="btn-primary" disabled={!modifs.length || enCours} onClick={enregistrer}><Save size={16} aria-hidden /> {enCours ? 'Enregistrement…' : `Enregistrer${modifs.length ? ` (${modifs.length})` : ''}`}</button>}
      </div>}>
      {AXES.map(([axe, titre]) => (
        <div key={axe}>
          <h3 className="border-b border-[#e9edf2] bg-white px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-dep-800">{titre}</h3>
          <EditableGrid label={`${titre} — programme ${programme.code}`} entete="Poste" unite="CDF" lectureSeule={!editable} totaux="colonnes"
            lignes={d.postes.filter((p) => p.axe === axe).map((p) => ({ key: String(p.id), label: p.libelle }))}
            colonnes={cols} valeurs={valeurs} modifiee={modifiee}
            onChange={(p, c, v) => setSaisie((s) => ({ ...s, [p]: { ...s[p], [c]: v } }))} />
        </div>
      ))}
    </Card>
  );
}

/** Crédits par programme et action, ventilés par rubrique et par titre (CDF). */
export default function Credits({ annee }) {
  const state = useApi(`/programmation/credits?annee=${annee}`, [annee]);
  const [version, setVersion] = useState(0);
  // Une seule protection de saisie pour la page (le routeur n’en accepte qu’une) : grilles modifiées.
  const [modifiees, setModifiees] = useState({});
  const signaler = useCallback((id, v) => setModifiees((m) => (!!m[id] === v ? m : { ...m, [id]: v })), []);
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <UnsavedChangesGuard surOnglet when={Object.values(modifiees).some(Boolean)} />
          <InfoAlert>Montants en francs congolais (CDF). Les crédits saisis au niveau du programme alimentent les tableaux par programme, rubrique et titre du PAP et le CDMT ; ceux saisis par action alimentent le tableau des crédits par action. Effacez une cellule pour supprimer le montant ; Entrée passe à la ligne suivante.</InfoAlert>
          {!d.programmes.length && <div className="card"><EmptyState title="Aucun programme">Saisissez la maquette programmatique du Ministère dans l’onglet Référentiel : les crédits se saisissent ensuite par programme et par action.</EmptyState></div>}
          <ControleCadrage annee={annee} version={version} />
          {d.programmes.map((p) => <Grille key={p.id} d={{ ...d, signaler, reload: state.reload, onSaved: () => setVersion((v) => v + 1) }} programme={p} A={annee} />)}
        </div>
      )}
    </Loadable>
  );
}
