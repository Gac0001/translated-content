import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { fmtNombre } from '../../lib/format';
import { useApi, Loadable, DataTable, Modal, Field, InfoAlert, Badge, runAction } from '../../components/ui';

export const fmtVal = (v, d = 0, unite) => { const n = fmtNombre(v, d); return n === '—' || !unite ? n : `${n} ${unite}`; };
export const evolution = (v, p) => (v === null || v === undefined || !p ? null : ((v - p) / Math.abs(p)) * 100);
export function Evolution({ v, p }) {
  const e = evolution(v, p);
  if (e === null) return <span className="text-slate-400">—</span>;
  return <span className={`tabular-nums ${e >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{e >= 0 ? '▲ +' : '▼ '}{e.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>;
}

/**
 * Barres horizontales d’une seule série (valeur par province ou catégorie) : une teinte, valeur
 * écrite en clair à côté de chaque barre, détail au survol ; le tableau reste lisible sans les barres.
 */
export function Barres({ rows, decimales, unite, label }) {
  const max = Math.max(0, ...rows.map((r) => r.valeur ?? 0));
  return (
    <table className="w-full text-sm" aria-label={label}>
      <tbody>{rows.map((r) => (
        <tr key={r.libelle} title={`${r.libelle} : ${fmtVal(r.valeur, decimales, unite)} — ${r.n} répondant(s)`} className="hover:bg-slate-50">
          <td className="w-1/3 py-1 pr-2 text-slate-700">{r.libelle}</td>
          <td className="py-1"><div className="h-3 bg-slate-100" aria-hidden>{r.valeur > 0 && max > 0 && <div className="h-full rounded-r bg-dep-600" style={{ width: `${(r.valeur / max) * 100}%` }} />}</div></td>
          <td className="w-24 whitespace-nowrap py-1 pl-2 text-right tabular-nums font-medium text-slate-800">{fmtVal(r.valeur, decimales)}</td>
          <td className="w-14 whitespace-nowrap py-1 pl-2 text-right text-xs text-slate-500">{r.n} rép.</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Définition d’un indicateur : questionnaire, calcul, questions et option mesurées. */
export function IndicateurModal({ indicateur, calculs, onClose, onSaved }) {
  const qs = useApi('/donnees/questionnaires');
  const [f, setF] = useState({ code: '', libelle: '', questionnaire_id: '', calcul: 'SOMME', question: '', question_denominateur: '', valeur_choix: '', facteur: 1, unite: '', decimales: 0, description: '', actif: true, ...indicateur });
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
    const b = { ...f, questionnaire_id: Number(f.questionnaire_id), facteur: Number(f.facteur) || 1, decimales: Number(f.decimales) || 0 };
    await runAction(() => (f.id ? api.put(`/donnees/indicateurs/${f.id}`, b) : api.post('/donnees/indicateurs', b)), 'Indicateur enregistré.');
    onSaved();
  };
  const selectQ = (k, liste, label) => <Field label={label} required><select className="input" value={f[k] || ''} onChange={up(k)}><option value="">—</option>{liste.map((q) => <option key={q.code} value={q.code}>{q.code} — {q.libelle}</option>)}</select></Field>;
  return (
    <Modal open size="lg" title={f.id ? `Indicateur ${f.code}` : 'Nouvel indicateur sectoriel'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code" required><input className="input" value={f.code} onChange={up('code')} /></Field>
        <Field label="Libellé" required className="sm:col-span-2"><input className="input" value={f.libelle} onChange={up('libelle')} /></Field>
        <Field label="Questionnaire" required className="sm:col-span-2"><select className="input" value={f.questionnaire_id} disabled={!!f.id} onChange={(e) => { setF({ ...f, questionnaire_id: e.target.value, question: '', question_denominateur: '', valeur_choix: '' }); charger(e.target.value); }}><option value="">—</option>{(qs.data?.data || []).filter((q) => q.version_publiee).map((q) => <option key={q.id} value={q.id}>{q.code} — {q.titre}</option>)}</select></Field>
        <Field label="Calcul" required><select className="input" value={f.calcul} onChange={(e) => setF({ ...f, calcul: e.target.value, question: '', valeur_choix: '' })}>{Object.entries(calculs).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {['SOMME', 'MOYENNE', 'RATIO'].includes(f.calcul) && selectQ('question', numeriques, f.calcul === 'RATIO' ? 'Numérateur' : 'Question mesurée')}
        {f.calcul === 'RATIO' && selectQ('question_denominateur', numeriques, 'Dénominateur')}
        {f.calcul === 'RATIO' && <Field label="Multiplicateur" hint="100 pour un pourcentage"><input className="input" type="number" min="0" value={f.facteur} onChange={up('facteur')} /></Field>}
        {['PART', 'NOMBRE'].includes(f.calcul) && (
          <Field label={f.calcul === 'NOMBRE' ? 'Question (facultatif)' : 'Question'} required={f.calcul === 'PART'}><select className="input" value={f.question || ''} onChange={(e) => setF({ ...f, question: e.target.value, valeur_choix: '' })}><option value="">{f.calcul === 'NOMBRE' ? 'Tous les répondants' : '—'}</option>{choix.map((q) => <option key={q.code} value={q.code}>{q.code} — {q.libelle}</option>)}</select></Field>
        )}
        {['PART', 'NOMBRE'].includes(f.calcul) && f.question && <Field label="Option retenue" required={f.calcul === 'PART'}><select className="input" value={f.valeur_choix || ''} onChange={up('valeur_choix')}><option value="">—</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></Field>}
        <Field label="Unité"><input className="input" value={f.unite || ''} onChange={up('unite')} /></Field>
        <Field label="Décimales"><input className="input" type="number" min="0" max="4" value={f.decimales} onChange={up('decimales')} /></Field>
        <Field label="Description" className="sm:col-span-3"><textarea className="input" rows={2} value={f.description || ''} onChange={up('description')} /></Field>
        {f.id && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} /> Actif</label>}
      </div>
    </Modal>
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
            {referentiel.droits.questionnaires && <button type="button" className="btn-primary" onClick={() => setNouveau(true)}><Plus size={16} /> Indicateur</button>}
          </div>
          <DataTable rows={r.data} onRowClick={(i) => navigate(`/donnees/indicateurs/${i.id}`)} empty="Aucun indicateur défini."
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
