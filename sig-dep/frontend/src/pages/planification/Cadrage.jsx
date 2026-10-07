import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { fmtNombre, lireNombre } from '../../lib/format';
import { useApi, Card, Field, InfoAlert, Badge, runAction, toast } from '../../components/ui';

const nombre = (v) => fmtNombre(v, 2, { vide: '' });
const lire = lireNombre;
const cdf = (v) => fmtNombre(v === null || v === undefined ? v : Math.round(v));
const HYPOTHESES = [['croissance', 'Croissance du PIB réel (%)'], ['inflation', 'Inflation (%)'], ['taux_change', 'Taux de change moyen (CDF/USD)'], ['pib_nominal', 'PIB nominal (milliards CDF)']];

/** Respect du cadrage : plafond, prévision et écart par rubrique et par année. */
export function TableauCadrage({ controle, compact = false }) {
  if (!controle) return null;
  const { annees } = controle;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-xs text-slate-500"><th className="px-3 py-2 text-left">Rubrique</th>{annees.map((y) => <th key={y.annee} colSpan={compact ? 2 : 3} className="border-l px-2 text-center">{y.annee}</th>)}</tr>
          <tr className="border-b text-xs text-slate-500"><th />{annees.map((y) => [<th key={`p${y.annee}`} className="border-l px-2 text-right font-medium">Plafond</th>, <th key={`v${y.annee}`} className="px-2 text-right font-medium">Prévision</th>, !compact && <th key={`e${y.annee}`} className="px-2 text-right font-medium">Écart</th>])}</tr>
        </thead>
        <tbody>
          {[...annees[0].lignes.map((l, k) => ({ libelle: l.libelle, cel: annees.map((y) => y.lignes[k]) })), { libelle: 'Total', total: true, cel: annees.map((y) => y.total) }].map((r) => (
            <tr key={r.libelle} className={`border-b border-slate-100 ${r.total ? 'font-semibold' : ''}`}>
              <td className="px-3 py-1.5">{r.libelle}</td>
              {r.cel.map((c, i) => [
                <td key={`p${i}`} className="border-l px-2 text-right tabular-nums">{cdf(c.plafond)}</td>,
                <td key={`v${i}`} className={`px-2 text-right tabular-nums ${c.depasse ? 'font-semibold text-red-700' : ''}`} title={c.depasse ? 'Prévision supérieure au plafond' : undefined}>{cdf(c.prevision)}</td>,
                !compact && <td key={`e${i}`} className={`whitespace-nowrap px-2 text-right tabular-nums ${c.depasse ? "text-red-700" : "text-slate-600"}`}>{c.ecart === null ? '—' : `${c.depasse ? '▼ ' : ''}${cdf(c.ecart)}`}</td>,
              ])}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bandeau de l’onglet Crédits : respect du CBMT applicable à l’exercice. */
export function ControleCadrage({ annee, version }) {
  const state = useApi(`/programmation/cadrage?annee=${annee}`, [annee, version]);
  const c = state.data?.controle;
  if (!state.data) return null;
  if (!c) return <InfoAlert>Aucun CBMT ne couvre l’exercice {annee} : créez-le dans l’onglet « PAP · RAP · CDMT » (type CBMT) pour contrôler les prévisions par rapport aux plafonds.</InfoAlert>;
  const depassements = c.annees.flatMap((y) => [...y.lignes.filter((l) => l.depasse), ...(y.total.depasse ? [y.total] : [])]).length;
  return (
    <Card title={`Respect du cadrage budgétaire — CBMT ${c.cbmt.periode}`} bodyClass="p-0"
      actions={<span className="flex gap-1">{c.cbmt.statut !== 'VALIDE' && <Badge tone="attention">CBMT non validé</Badge>}{depassements ? <Badge tone="danger">{depassements} dépassement(s)</Badge> : <Badge tone="succes">Plafonds respectés</Badge>}</span>}>
      <TableauCadrage controle={c} />
      <p className="px-3 py-2 text-xs text-slate-500">Plafonds du Ministère par nature (CDF) comparés aux prévisions saisies au niveau des programmes. Un dépassement est signalé en rouge ; l’export du CDMT et le PAP le reprennent.</p>
    </Card>
  );
}

/** Fiche CBMT en lecture. */
export function VueCbmt({ doc, programmes }) {
  const banque = useApi('/programmation/banque');
  const c = doc.contenu || {};
  const annees = [doc.annee, doc.annee + 1, doc.annee + 2];
  return (
    <div className="space-y-4">
      <Card title="Respect des plafonds" bodyClass="p-0"><TableauCadrage controle={doc.controle} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Hypothèses macroéconomiques">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="text-left" />{annees.map((a) => <th key={a} className="text-right">{a}</th>)}</tr></thead>
            <tbody>{HYPOTHESES.map(([k, l]) => <tr key={k} className="border-t border-slate-100"><td className="py-1">{l}</td>{annees.map((a) => <td key={a} className="text-right tabular-nums">{nombre(c.hypotheses?.[a]?.[k]) || '—'}</td>)}</tr>)}</tbody>
          </table>
          {(c.source || c.date_publication) && <p className="mt-2 text-xs text-slate-500">Source : {c.source || '—'}{c.date_publication ? ` (${c.date_publication})` : ''}</p>}
        </Card>
        <Card title="Orientations du secteur">{c.orientations ? <p className="whitespace-pre-line text-sm">{c.orientations}</p> : <p className="text-sm italic text-slate-400">Non renseignées.</p>}</Card>
      </div>
      <Card title="Actions prioritaires du secteur">
        {(c.actions || []).length ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">{c.actions.map((a, i) => {
            const p = programmes.find((x) => x.id === a.programme_id);
            const pips = (banque.data?.data || []).filter((x) => a.pips.includes(x.id));
            return <li key={i}>{a.libelle}<div className="text-xs text-slate-500">{p ? `Programme ${p.code} — ${p.libelle}` : 'Sans programme'}{pips.length ? ` · PIP : ${pips.map((x) => x.code).join(', ')}` : ''}</div></li>;
          })}</ol>
        ) : <p className="text-sm italic text-slate-400">Aucune action saisie.</p>}
      </Card>
    </div>
  );
}

/** Saisie du CBMT : source, hypothèses, plafonds par année et rubrique, actions prioritaires. */
export function EditeurCbmt({ doc, programmes, onSaved, onCancel }) {
  const banque = useApi('/programmation/banque');
  const annees = [doc.annee, doc.annee + 1, doc.annee + 2];
  const c0 = doc.contenu || {};
  const [c, setC] = useState({ source: 'Ministère du Budget — DGPPB', date_publication: '', orientations: '', ...c0, actions: c0.actions || [] });
  const [hyp, setHyp] = useState(() => Object.fromEntries(annees.map((a) => [a, Object.fromEntries(HYPOTHESES.map(([k]) => [k, nombre(c0.hypotheses?.[a]?.[k])]))])));
  const [pla, setPla] = useState(() => Object.fromEntries(annees.map((a) => [a, Object.fromEntries(doc.rubriques.map((r) => [r.code, nombre(c0.plafonds?.[a]?.[r.code])]))])));
  const majAction = (i, k, v) => setC({ ...c, actions: c.actions.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const enregistrer = async () => {
    const conv = (o) => Object.fromEntries(Object.entries(o).map(([a, v]) => [a, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lire(x)]))]));
    const h = conv(hyp);
    const p = conv(pla);
    if ([...Object.values(h), ...Object.values(p)].some((v) => Object.values(v).some((x) => x !== null && !Number.isFinite(x)))) { toast.error('Valeur numérique attendue.'); return; }
    const contenu = { ...c, date_publication: c.date_publication || null, hypotheses: h, plafonds: p, actions: c.actions.filter((a) => a.libelle.trim()).map((a) => ({ libelle: a.libelle, programme_id: a.programme_id ? Number(a.programme_id) : null, pips: a.pips })) };
    await runAction(() => api.put(`/programmation/documents/${doc.id}`, { contenu }), 'CBMT enregistré.');
    onSaved();
  };
  const grille = (titre, lignes, valeurs, setValeurs, unite) => (
    <Card title={titre} bodyClass="p-0">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b bg-slate-50 text-xs text-slate-500"><th className="px-3 py-2 text-left">{unite}</th>{annees.map((a) => <th key={a} className="px-2 text-right">{a}</th>)}</tr></thead>
        <tbody>{lignes.map(([k, l]) => (
          <tr key={k} className="border-b border-slate-100"><td className="px-3 py-1">{l}</td>{annees.map((a) => (
            <td key={a} className="px-1 py-0.5"><input className="input w-36 px-1 py-0.5 text-right tabular-nums" aria-label={`${l} ${a}`} value={valeurs[a][k] ?? ''} onChange={(e) => setValeurs({ ...valeurs, [a]: { ...valeurs[a], [k]: e.target.value } })} /></td>
          ))}</tr>
        ))}</tbody>
      </table>
    </Card>
  );
  return (
    <div className="space-y-4">
      <Card title="Document">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Source" className="sm:col-span-2"><input className="input" value={c.source || ''} onChange={(e) => setC({ ...c, source: e.target.value })} /></Field>
          <Field label="Date de publication"><input className="input" type="date" value={c.date_publication || ''} onChange={(e) => setC({ ...c, date_publication: e.target.value })} /></Field>
          <Field label="Orientations de la politique du secteur Numérique" className="sm:col-span-3"><textarea className="input" rows={4} value={c.orientations || ''} onChange={(e) => setC({ ...c, orientations: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Joignez le document du Ministère du Budget dans les pièces du CBMT. Les plafonds du Ministère figurent dans l’annexe « cadre des dépenses sectorielles » ou dans la lettre de cadrage.</p>
      </Card>
      {grille('Plafonds du Ministère par nature (CDF)', doc.rubriques.map((r) => [r.code, r.libelle]), pla, setPla, 'Rubrique')}
      {grille('Hypothèses macroéconomiques', HYPOTHESES, hyp, setHyp, 'Indicateur')}
      <Card title="Actions prioritaires du secteur">
        <div className="space-y-3">
          {c.actions.map((a, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 lg:grid-cols-12">
              <input className="input lg:col-span-6" placeholder="Action prioritaire" value={a.libelle} onChange={(e) => majAction(i, 'libelle', e.target.value)} aria-label="Action prioritaire" />
              <select className="input lg:col-span-5" value={a.programme_id || ''} onChange={(e) => majAction(i, 'programme_id', e.target.value)} aria-label="Programme"><option value="">— Programme —</option>{programmes.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.libelle}</option>)}</select>
              <button type="button" className="btn-ghost justify-self-end px-2 text-red-700 lg:col-span-1" aria-label="Retirer l’action" onClick={() => setC({ ...c, actions: c.actions.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
              <div className="flex flex-wrap gap-1.5 lg:col-span-12">{(banque.data?.data || []).map((p) => {
                const on = a.pips.includes(p.id);
                return <button key={p.id} type="button" aria-pressed={on} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-dep-600 bg-dep-50 text-dep-800' : 'border-slate-300 text-slate-600'}`} onClick={() => majAction(i, 'pips', on ? a.pips.filter((x) => x !== p.id) : [...a.pips, p.id])}>{p.code} — {p.intitule}</button>;
              })}</div>
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary mt-3" onClick={() => setC({ ...c, actions: [...c.actions, { libelle: '', programme_id: '', pips: [] }] })}><Plus size={16} /> Action</button>
      </Card>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={enregistrer}><Save size={16} /> Enregistrer</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}
