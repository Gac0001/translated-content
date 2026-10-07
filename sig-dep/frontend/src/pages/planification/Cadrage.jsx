import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { fmtNombre } from '../../lib/format';
import { useApi, Card, Field, InfoAlert, Badge, SimpleTable, EditableGrid, EmptyState, ActionBar, runAction } from '../../components/ui';

const nombre = (v) => fmtNombre(v, 2);
const cdf = (v) => fmtNombre(v === null || v === undefined ? v : Math.round(v));
const HYPOTHESES = [['croissance', 'Croissance du PIB réel (%)'], ['inflation', 'Inflation (%)'], ['taux_change', 'Taux de change moyen (CDF/USD)'], ['pib_nominal', 'PIB nominal (milliards CDF)']];

/** Respect du cadrage : plafond, prévision et écart par rubrique et par année. */
export function TableauCadrage({ controle, compact = false }) {
  if (!controle) return null;
  const { annees } = controle;
  const rouge = (c) => (c.depasse ? 'font-semibold text-red-700' : '');
  const columns = [
    { key: 'libelle', header: 'Rubrique', className: 'min-w-[12rem]' },
    ...annees.flatMap((y, i) => [
      { key: `p${i}`, header: 'Plafond', align: 'right', debutGroupe: true, render: (r) => cdf(r.cel[i].plafond) },
      { key: `v${i}`, header: 'Prévision', align: 'right', render: (r) => <span className={rouge(r.cel[i])} title={r.cel[i].depasse ? 'Prévision supérieure au plafond' : undefined}>{cdf(r.cel[i].prevision)}</span> },
      !compact && { key: `e${i}`, header: 'Écart', align: 'right', className: 'whitespace-nowrap', render: (r) => { const c = r.cel[i]; return <span className={c.depasse ? 'text-red-700' : 'text-slate-600'}>{c.ecart === null ? '—' : `${c.depasse ? '▼ ' : ''}${cdf(c.ecart)}`}{c.depasse && <span className="sr-only"> (dépassement)</span>}</span>; } },
    ].filter(Boolean)),
  ];
  return (
    <SimpleTable label="Respect des plafonds du CBMT" dense figee rowKey="libelle" columns={columns}
      groupes={[{ label: '' }, ...annees.map((y) => ({ label: String(y.annee), colSpan: compact ? 2 : 3 }))]}
      rows={annees[0].lignes.map((l, k) => ({ libelle: l.libelle, cel: annees.map((y) => y.lignes[k]) }))}
      footer={[{ libelle: 'Total', cel: annees.map((y) => y.total) }]} />
  );
}

/** Bandeau de l’onglet Crédits : respect du CBMT applicable à l’exercice. */
export function ControleCadrage({ annee, version }) {
  const state = useApi(`/programmation/cadrage?annee=${annee}`, [annee, version]);
  const c = state.data?.controle;
  if (!state.data) return null;
  if (!c) return <InfoAlert>Aucun CBMT ne couvre l’exercice {annee} : créez-le dans l’onglet « CBMT · PAP · RAP · CDMT » pour contrôler les prévisions par rapport aux plafonds.</InfoAlert>;
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
          <div className="-mx-4 -mt-4 mb-2">
            <SimpleTable label="Hypothèses macroéconomiques" dense rowKey="k"
              columns={[{ key: 'l', header: 'Indicateur' }, ...annees.map((an) => ({ key: String(an), header: String(an), align: 'right', render: (r) => nombre(c.hypotheses?.[an]?.[r.k]) }))]}
              rows={HYPOTHESES.map(([k, l]) => ({ k, l }))} />
          </div>
          {(c.source || c.date_publication) && <p className="mt-2 text-xs text-slate-500">Source : {c.source || '—'}{c.date_publication ? ` (${c.date_publication})` : ''}</p>}
        </Card>
        <Card title="Orientations du secteur">{c.orientations ? <p className="whitespace-pre-line text-sm">{c.orientations}</p> : <p className="text-sm italic text-slate-500">Non renseignées.</p>}</Card>
      </div>
      <Card title="Actions prioritaires du secteur">
        {(c.actions || []).length ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">{c.actions.map((a, i) => {
            const p = programmes.find((x) => x.id === a.programme_id);
            const pips = (banque.data?.data || []).filter((x) => a.pips.includes(x.id));
            return <li key={i}>{a.libelle}<div className="text-xs text-slate-500">{p ? `Programme ${p.code} — ${p.libelle}` : 'Sans programme'}{pips.length ? ` · PIP : ${pips.map((x) => x.code).join(', ')}` : ''}</div></li>;
          })}</ol>
        ) : <EmptyState title="Aucune action prioritaire">Les actions prioritaires du secteur, reliées aux programmes et aux projets de la banque, se saisissent avec « Rédiger ».</EmptyState>}
      </Card>
    </div>
  );
}

/** Valeurs par ligne puis par année (grille) ⇄ par année puis par ligne (contenu du CBMT). */
const parLigne = (source, cles, annees) => Object.fromEntries(cles.map((k) => [k, Object.fromEntries(annees.map((a) => [a, source?.[a]?.[k] ?? null]))]));
const parAnnee = (grille, annees) => Object.fromEntries(annees.map((a) => [a, Object.fromEntries(Object.entries(grille).map(([k, v]) => [k, v[a] ?? null]))]));

/** Saisie du CBMT : source, hypothèses, plafonds par année et rubrique, actions prioritaires. */
export function EditeurCbmt({ doc, programmes, onSaved, onCancel }) {
  const banque = useApi('/programmation/banque');
  const annees = useMemo(() => [doc.annee, doc.annee + 1, doc.annee + 2], [doc.annee]);
  const colonnes = annees.map((a) => ({ key: String(a), label: String(a) }));
  const [initial] = useState(() => {
    const c0 = doc.contenu || {};
    return {
      c: { source: 'Ministère du Budget — DGPPB', date_publication: '', orientations: '', ...c0, actions: c0.actions || [] },
      hyp: parLigne(c0.hypotheses, HYPOTHESES.map(([k]) => k), annees),
      pla: parLigne(c0.plafonds, doc.rubriques.map((r) => r.code), annees),
    };
  });
  const [c, setC] = useState(initial.c);
  const [hyp, setHyp] = useState(initial.hyp);
  const [pla, setPla] = useState(initial.pla);
  const [enCours, setEnCours] = useState(false);
  const modifie = JSON.stringify({ c, hyp, pla }) !== JSON.stringify(initial);
  const majAction = (i, k, v) => setC({ ...c, actions: c.actions.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const enregistrer = async () => {
    const contenu = { ...c, date_publication: c.date_publication || null, hypotheses: parAnnee(hyp, annees), plafonds: parAnnee(pla, annees), actions: c.actions.filter((a) => a.libelle.trim()).map((a) => ({ libelle: a.libelle, programme_id: a.programme_id ? Number(a.programme_id) : null, pips: a.pips })) };
    setEnCours(true);
    try { await runAction(() => api.put(`/programmation/documents/${doc.id}`, { contenu }), 'CBMT enregistré.'); } finally { setEnCours(false); }
    onSaved();
  };
  const maj = (set) => (l, a, v) => set((g) => ({ ...g, [l]: { ...g[l], [a]: v } }));
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
      <Card title="Plafonds du Ministère par nature (CDF)" bodyClass="p-0">
        <EditableGrid label="Plafonds du Ministère par nature" entete="Rubrique" unite="CDF" totaux="colonnes" colonnes={colonnes}
          lignes={doc.rubriques.map((r) => ({ key: r.code, label: r.libelle }))} valeurs={pla} onChange={maj(setPla)} />
      </Card>
      <Card title="Hypothèses macroéconomiques" bodyClass="p-0">
        <EditableGrid label="Hypothèses macroéconomiques" entete="Indicateur" decimales={2} totaux={null} colonnes={colonnes}
          lignes={HYPOTHESES.map(([k, l]) => ({ key: k, label: l }))} valeurs={hyp} onChange={maj(setHyp)} />
      </Card>
      <Card title="Actions prioritaires du secteur" actions={<button type="button" className="btn-secondary" onClick={() => setC({ ...c, actions: [...c.actions, { libelle: '', programme_id: '', pips: [] }] })}><Plus size={16} aria-hidden /> Action</button>}>
        {!c.actions.length && <p className="text-sm text-slate-500">Aucune action : ajoutez les actions prioritaires retenues par le cadrage.</p>}
        <div className="space-y-3">
          {c.actions.map((a, i) => (
            <fieldset key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 lg:grid-cols-12">
              <legend className="sr-only">Action prioritaire {i + 1}</legend>
              <input className="input lg:col-span-6" placeholder="Action prioritaire" value={a.libelle} onChange={(e) => majAction(i, 'libelle', e.target.value)} aria-label={`Action prioritaire ${i + 1}`} />
              <select className="input lg:col-span-5" value={a.programme_id || ''} onChange={(e) => majAction(i, 'programme_id', e.target.value)} aria-label={`Programme de l’action ${i + 1}`}><option value="">— Programme —</option>{programmes.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.libelle}</option>)}</select>
              <button type="button" className="btn-ghost justify-self-end px-2 text-red-700 lg:col-span-1" aria-label={`Retirer l’action ${i + 1}`} onClick={() => setC({ ...c, actions: c.actions.filter((_, j) => j !== i) })}><Trash2 size={15} aria-hidden /></button>
              <div className="flex flex-wrap gap-1.5 lg:col-span-12" role="group" aria-label={`Projets de la banque liés à l’action ${i + 1}`}>{(banque.data?.data || []).map((p) => {
                const on = a.pips.includes(p.id);
                return <button key={p.id} type="button" aria-pressed={on} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-dep-600 bg-dep-50 text-dep-800' : 'border-slate-300 text-slate-600'}`} onClick={() => majAction(i, 'pips', on ? a.pips.filter((x) => x !== p.id) : [...a.pips, p.id])}>{p.code} — {p.intitule}</button>;
              })}</div>
            </fieldset>
          ))}
        </div>
      </Card>
      <ActionBar dirty={modifie} saving={enCours} onSave={enregistrer} onCancel={onCancel} saveLabel="Enregistrer le CBMT" />
    </div>
  );
}
