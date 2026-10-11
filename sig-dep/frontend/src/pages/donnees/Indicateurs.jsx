import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { fmtNombre } from '../../lib/format';
import { useApi, Loadable, DataTable, FormModal, FormSection, Field, InfoAlert, Badge, NumberInput, toast } from '../../components/ui';

export const fmtVal = (v, d = 0, unite) => { const n = fmtNombre(v, d); return n === '—' || !unite ? n : `${n} ${unite}`; };
export const evolution = (v, p) => (v === null || v === undefined || !p ? null : ((v - p) / Math.abs(p)) * 100);
export function Evolution({ v, p }) {
  const e = evolution(v, p);
  if (e === null) return <span className="text-slate-500">—</span>;
  return <span className={`tabular-nums ${e >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{e >= 0 ? '▲ +' : '▼ '}{fmtNombre(e, 1)} %<span className="sr-only">{e >= 0 ? ' (hausse)' : ' (baisse)'}</span></span>;
}

/**
 * Barres horizontales d’une seule série (valeur par province ou catégorie) : une teinte, valeur
 * écrite en clair à côté de chaque barre, détail au survol ; le tableau reste lisible sans les barres.
 */
export function Barres({ rows, decimales, unite, label }) {
  const max = Math.max(0, ...rows.map((r) => r.valeur ?? 0));
  if (!rows.length) return <p className="text-sm text-slate-500">Aucune donnée.</p>;
  return (
    <ul className="space-y-1 text-sm" aria-label={label}>
      {rows.map((r) => (
        <li key={r.libelle} title={`${r.libelle} : ${fmtVal(r.valeur, decimales, unite)} — ${r.n} répondant(s)`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
          <span className="truncate text-slate-700">{r.libelle}</span>
          <span className="h-3 bg-dep-100" aria-hidden>{r.valeur > 0 && max > 0 && <span className="block h-full rounded-r bg-dep-600" style={{ width: `${(r.valeur / max) * 100}%` }} />}</span>
          <span className="whitespace-nowrap text-right tabular-nums"><b className="font-medium text-slate-800">{fmtVal(r.valeur, decimales)}</b> <span className="text-xs text-slate-500">· {r.n} rép.</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Définition d’un indicateur : questionnaire, calcul, questions et option mesurées. */
export function IndicateurModal({ indicateur, calculs, onClose, onSaved }) {
  const qs = useApi('/donnees/questionnaires');
  const [initial] = useState(() => ({ code: '', libelle: '', questionnaire_id: '', calcul: 'SOMME', question: '', question_denominateur: '', valeur_choix: '', facteur: 1, unite: '', decimales: 0, description: '', actif: true, ...indicateur }));
  const [f, setF] = useState(initial);
  const [questions, setQuestions] = useState(null);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const charger = async (id) => {
    if (!id) { setQuestions(null); return; }
    const r = await api.get(`/donnees/questionnaires/${id}`);
    const pub = r.data.versions.find((v) => v.statut === 'PUBLIEE');
    setQuestions(pub ? pub.questions : []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (f.questionnaire_id) charger(f.questionnaire_id); }, []);
  const numeriques = (questions || []).filter((q) => ['NOMBRE', 'ENTIER'].includes(q.type));
  const choix = (questions || []).filter((q) => ['CHOIX', 'CHOIX_MULTIPLE', 'OUI_NON'].includes(q.type));
  const qSel = (questions || []).find((q) => q.code === f.question);
  const options = qSel ? (qSel.type === 'OUI_NON' ? ['Oui', 'Non'] : qSel.options || []) : [];
  const enregistrer = async () => {
    if (!f.code?.trim() || !f.libelle?.trim() || !f.questionnaire_id) throw new Error('Le code, le libellé et le questionnaire sont obligatoires.');
    const b = { ...f, questionnaire_id: Number(f.questionnaire_id), facteur: Number(f.facteur) || 1, decimales: Number(f.decimales) || 0 };
    await (f.id ? api.put(`/donnees/indicateurs/${f.id}`, b) : api.post('/donnees/indicateurs', b));
    toast.success('Indicateur enregistré.');
    onSaved();
  };
  const selectQ = (k, liste, label) => <Field label={label} required><select className="input" value={f[k] || ''} onChange={up(k)}><option value="">—</option>{liste.map((q) => <option key={q.code} value={q.code}>{q.code} — {q.libelle}</option>)}</select></Field>;
  return (
    <FormModal open size="lg" title={f.id ? `Indicateur ${f.code}` : 'Nouvel indicateur sectoriel'} onClose={onClose} onSubmit={enregistrer} dirty={JSON.stringify(f) !== JSON.stringify(initial)}>
      <FormSection title="Identification" cols={3}>
        <Field label="Code" required><input className="input" value={f.code} onChange={up('code')} /></Field>
        <Field label="Libellé" required className="sm:col-span-2"><input className="input" value={f.libelle} onChange={up('libelle')} /></Field>
        <Field label="Questionnaire" required className="sm:col-span-2"><select className="input" value={f.questionnaire_id} disabled={!!f.id} onChange={(e) => { setF({ ...f, questionnaire_id: e.target.value, question: '', question_denominateur: '', valeur_choix: '' }); charger(e.target.value); }}><option value="">—</option>{(qs.data?.data || []).filter((q) => q.version_publiee).map((q) => <option key={q.id} value={q.id}>{q.code} — {q.titre}</option>)}</select></Field>
      </FormSection>
      <FormSection title="Calcul" cols={3} description="Calculé sur les réponses contrôlées des campagnes validées du questionnaire.">
        <Field label="Calcul" required><select className="input" value={f.calcul} onChange={(e) => setF({ ...f, calcul: e.target.value, question: '', valeur_choix: '' })}>{Object.entries(calculs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {['SOMME', 'MOYENNE', 'RATIO'].includes(f.calcul) && selectQ('question', numeriques, f.calcul === 'RATIO' ? 'Numérateur' : 'Question mesurée')}
        {f.calcul === 'RATIO' && selectQ('question_denominateur', numeriques, 'Dénominateur')}
        {f.calcul === 'RATIO' && <Field label="Multiplicateur" hint="100 pour un pourcentage"><NumberInput value={f.facteur === '' ? null : Number(f.facteur)} min={0} decimales={4} onChange={(v) => setF({ ...f, facteur: v ?? 1 })} /></Field>}
        {['PART', 'NOMBRE'].includes(f.calcul) && (
          <Field label={f.calcul === 'NOMBRE' ? 'Question (facultatif)' : 'Question'} required={f.calcul === 'PART'}><select className="input" value={f.question || ''} onChange={(e) => setF({ ...f, question: e.target.value, valeur_choix: '' })}><option value="">{f.calcul === 'NOMBRE' ? 'Tous les répondants' : '—'}</option>{choix.map((q) => <option key={q.code} value={q.code}>{q.code} — {q.libelle}</option>)}</select></Field>
        )}
        {['PART', 'NOMBRE'].includes(f.calcul) && f.question && <Field label="Option retenue" required={f.calcul === 'PART'}><select className="input" value={f.valeur_choix || ''} onChange={up('valeur_choix')}><option value="">—</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>}
      </FormSection>
      <FormSection title="Présentation" cols={3}>
        <Field label="Unité"><input className="input" value={f.unite || ''} onChange={up('unite')} /></Field>
        <Field label="Décimales" hint="De 0 à 4"><NumberInput value={Number(f.decimales) || 0} min={0} max={4} onChange={(v) => setF({ ...f, decimales: v ?? 0 })} /></Field>
        <Field label="Description" className="sm:col-span-3"><textarea className="input" rows={2} value={f.description || ''} onChange={up('description')} /></Field>
        {f.id && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} /> Actif</label>}
      </FormSection>
    </FormModal>
  );
}

/** Indicateurs sectoriels : dernière valeur et évolution par rapport à la période précédente. */
export default function Indicateurs({ referentiel }) {
  const state = useApi('/donnees/indicateurs');
  const navigate = useNavigate();
  const [nouveau, setNouveau] = useState(false);
  return (
    <Loadable state={state}>
      {(r) => (
        <>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <InfoAlert>Calculés sur les réponses contrôlées des campagnes validées, par période, province et catégorie d’acteurs.</InfoAlert>
            {referentiel.droits.questionnaires && <button type="button" className="btn-primary" onClick={() => setNouveau(true)}><Plus size={16} aria-hidden /> Indicateur</button>}
          </div>
          <DataTable rows={r.data} label="Indicateurs sectoriels" onRowClick={(i) => navigate(`/donnees/indicateurs/${i.id}`)} empty="Aucun indicateur défini."
            columns={[
              { key: 'libelle', header: 'Indicateur', render: (i) => <div><div className="font-medium">{i.libelle}</div><div className="text-xs text-slate-500">{i.code} · {r.calculs[i.calcul]} · {i.questionnaire_code}</div></div>, search: (i) => `${i.libelle} ${i.code}` },
              { key: 'derniere', header: 'Dernière valeur', render: (i) => (i.derniere ? <div><div className="font-semibold tabular-nums">{fmtVal(i.derniere.valeur, i.decimales, i.unite)}</div><div className="text-xs text-slate-500">{i.derniere.periode} · {i.derniere.n} rép.</div></div> : <span className="text-xs text-slate-500">Aucune campagne validée</span>) },
              { key: 'precedente', header: 'Évolution', render: (i) => <Evolution v={i.derniere?.valeur} p={i.precedente} /> },
              { key: 'actif', header: 'État', render: (i) => (i.actif ? <Badge tone="succes">Actif</Badge> : <Badge>Inactif</Badge>) },
            ]} />
          {nouveau && <IndicateurModal calculs={r.calculs} onClose={() => setNouveau(false)} onSaved={() => { setNouveau(false); state.reload(); }} />}
        </>
      )}
    </Loadable>
  );
}
