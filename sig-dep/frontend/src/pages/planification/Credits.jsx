import { useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import api from '../../lib/api';
import { ControleCadrage } from './Cadrage';
import { fmtNombre, lireNombre } from '../../lib/format';
import { useApi, Loadable, Card, InfoAlert, Empty, runAction, toast } from '../../components/ui';

const nombre = (v) => fmtNombre(v === null || v === undefined || v === '' ? v : Math.round(Number(v)), 0, { vide: '' });
const lire = lireNombre;

/** Colonnes du PAP et du CDMT : réalisations A-2, exercice en cours A-1, prévisions A à A+3. */
const colonnes = (A) => [
  { annee: A - 2, type: 'VOTE', label: `Votés ${A - 2}` }, { annee: A - 2, type: 'EXECUTE', label: `Exécutés ${A - 2}` },
  { annee: A - 1, type: 'VOTE', label: `Votés ${A - 1}` }, { annee: A - 1, type: 'EXECUTE_S1', label: `Exécutés fin juin ${A - 1}` },
  ...[A, A + 1, A + 2, A + 3].map((a) => ({ annee: a, type: 'PREVISION', label: `Prévision ${a}` })),
];
const cle = (annee, type, poste) => `${annee}:${type}:${poste}`;

function Grille({ d, programme, A }) {
  const [niveau, setNiveau] = useState('');
  const [saisie, setSaisie] = useState({});
  const action = niveau ? Number(niveau) : null;
  const cols = colonnes(A);
  const existants = useMemo(() => {
    const m = {};
    for (const c of d.credits.filter((r) => r.programme_id === programme.id && (r.action_id || null) === action)) m[cle(c.annee, c.type, c.poste_id)] = c.montant;
    return m;
  }, [d.credits, programme.id, action]);
  const valeur = (k) => (k in saisie ? saisie[k] : nombre(existants[k]));
  const modifies = Object.keys(saisie).filter((k) => lire(saisie[k]) !== (existants[k] ?? null));
  const enregistrer = async () => {
    const lignes = modifies.map((k) => { const [annee, type, poste] = k.split(':'); return { annee: Number(annee), type, poste_id: Number(poste), programme_id: programme.id, action_id: action, montant: lire(saisie[k]) }; });
    if (lignes.some((l) => l.montant !== null && !(Number.isFinite(l.montant) && l.montant >= 0))) { toast.error('Montant invalide : saisissez un nombre positif.'); return; }
    const r = await runAction(() => api.put('/programmation/credits', { lignes }), 'Crédits enregistrés.');
    if (r.data.depassements?.length) toast.error(`Plafond du CBMT dépassé : ${r.data.depassements.map((x) => `${x.rubrique} ${x.annee}`).join(', ')}.`);
    setSaisie({}); d.reload(); d.onSaved();
  };
  const axes = [['RUBRIQUE', 'Par rubrique budgétaire'], ['TITRE', 'Par titre']];
  const total = (axe, c) => {
    const postes = d.postes.filter((p) => p.axe === axe);
    const vals = postes.map((p) => lire(valeur(cle(c.annee, c.type, p.id)))).filter((v) => v !== null && Number.isFinite(v));
    return vals.length ? nombre(vals.reduce((s, v) => s + v, 0)) : '';
  };
  return (
    <Card title={`Programme ${programme.code} : ${programme.libelle}`} bodyClass="p-0"
      actions={<div className="flex items-center gap-2">
        <select className="input w-auto" value={niveau} onChange={(e) => { setNiveau(e.target.value); setSaisie({}); }} aria-label="Niveau de saisie">
          <option value="">Crédits du programme</option>{programme.actions.map((a) => <option key={a.id} value={a.id}>Action {a.code} — {a.libelle}</option>)}
        </select>
        {d.droits.saisir && <button type="button" className="btn-primary" disabled={!modifies.length} onClick={enregistrer}><Save size={16} /> Enregistrer{modifies.length ? ` (${modifies.length})` : ''}</button>}
      </div>}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="border-b bg-slate-50 text-xs text-slate-500"><th className="min-w-[15rem] px-3 py-2 text-left">Poste</th>{cols.map((c) => <th key={`${c.annee}${c.type}`} className="px-1 text-right font-medium">{c.label}</th>)}</tr></thead>
          <tbody>
            {axes.map(([axe, titre]) => [
              <tr key={axe} className="bg-slate-50/60"><td colSpan={cols.length + 1} className="px-3 py-1 text-xs font-semibold uppercase text-dep-800">{titre}</td></tr>,
              ...d.postes.filter((p) => p.axe === axe).map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="max-w-xs px-3 py-1">{p.libelle}</td>
                  {cols.map((c) => {
                    const k = cle(c.annee, c.type, p.id);
                    return <td key={k} className="px-1 py-0.5">{d.droits.saisir
                      ? <input className={`input w-28 px-1 py-0.5 text-right tabular-nums ${modifies.includes(k) ? 'border-amber-400 bg-amber-50' : ''}`} value={valeur(k)} onChange={(e) => setSaisie({ ...saisie, [k]: e.target.value })} aria-label={`${p.libelle} — ${c.label}`} />
                      : <span className="block text-right tabular-nums">{valeur(k) || '—'}</span>}</td>;
                  })}
                </tr>
              )),
              <tr key={`${axe}-t`} className="border-b font-semibold"><td className="px-3 py-1">Total</td>{cols.map((c) => <td key={`${c.annee}${c.type}`} className="px-2 text-right tabular-nums">{total(axe, c)}</td>)}</tr>,
            ])}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Crédits par programme et action, ventilés par rubrique et par titre (CDF). */
export default function Credits({ annee }) {
  const state = useApi(`/programmation/credits?annee=${annee}`, [annee]);
  const [version, setVersion] = useState(0);
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>Montants en francs congolais (CDF). Les crédits saisis au niveau du programme alimentent les tableaux par programme, rubrique et titre du PAP et le CDMT ; ceux saisis par action alimentent le tableau des crédits par action. Effacez une cellule pour supprimer le montant.</InfoAlert>
          {!d.programmes.length && <Empty message="Aucun programme : saisissez la maquette programmatique dans l’onglet Référentiel." />}
          <ControleCadrage annee={annee} version={version} />
          {d.programmes.map((p) => <Grille key={p.id} d={{ ...d, reload: state.reload, onSaved: () => setVersion((v) => v + 1) }} programme={p} A={annee} />)}
        </div>
      )}
    </Loadable>
  );
}
