import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, CopyPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Badge, Field, InfoAlert, EmptyState, FormModal, FormSection, ActionBar, runAction, toast, useConfirm } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export const TYPES = { NOMBRE: 'Nombre', ENTIER: 'Nombre entier', TEXTE: 'Texte', CHOIX: 'Choix unique', CHOIX_MULTIPLE: 'Choix multiples', DATE: 'Date', OUI_NON: 'Oui / Non' };
const NUMERIQUES = ['NOMBRE', 'ENTIER'];
const QUESTION_VIDE = { code: '', libelle: '', type: 'ENTIER', obligatoire: false, unite: '', section: '', aide: '', min: '', max: '', options: [] };

const nombreOuNull = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));

/** Aperçu en lecture d’une question. */
function Apercu({ q, i }) {
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2"><span className="font-mono text-xs text-slate-500">{i + 1}. {q.code}</span><span className="font-medium">{q.libelle}</span>{q.obligatoire && <Badge tone="danger">Obligatoire</Badge>}</div>
      <div className="mt-0.5 text-xs text-slate-500">
        {TYPES[q.type]}{q.unite && ` · ${q.unite}`}{NUMERIQUES.includes(q.type) && (q.min !== null && q.min !== undefined || q.max !== null && q.max !== undefined) && ` · bornes ${q.min ?? '—'} à ${q.max ?? '—'}`}
        {q.options?.length > 0 && ` · ${q.options.join(' / ')}`}{q.section && ` · section « ${q.section} »`}
      </div>
      {q.aide && <div className="text-xs italic text-slate-500">{q.aide}</div>}
    </li>
  );
}

function Editeur({ version, onSaved, onCancel }) {
  const [initial] = useState(() => ({ questions: version.questions.map((q) => ({ ...QUESTION_VIDE, ...q, min: q.min ?? '', max: q.max ?? '', options: q.options || [] })), controles: version.controles || [] }));
  const [questions, setQuestions] = useState(initial.questions);
  const [controles, setControles] = useState(initial.controles);
  const [enCours, setEnCours] = useState(false);
  const modifie = JSON.stringify({ questions, controles }) !== JSON.stringify(initial);
  const maj = (i, k, v) => setQuestions(questions.map((q, j) => (j === i ? { ...q, [k]: v } : q)));
  const deplacer = (i, d) => { const t = [...questions]; [t[i], t[i + d]] = [t[i + d], t[i]]; setQuestions(t); };
  const numeriques = questions.filter((q) => NUMERIQUES.includes(q.type) && q.code);
  const enregistrer = async () => {
    const corps = {
      questions: questions.map((q) => ({
        code: q.code.trim().toUpperCase(), libelle: q.libelle, type: q.type, obligatoire: !!q.obligatoire, unite: q.unite || null, section: q.section || null, aide: q.aide || null,
        ...(NUMERIQUES.includes(q.type) ? { min: nombreOuNull(q.min), max: nombreOuNull(q.max) } : {}),
        ...(['CHOIX', 'CHOIX_MULTIPLE'].includes(q.type) ? { options: q.options.map((o) => o.trim()).filter(Boolean) } : {}),
      })),
      controles: controles.map((c) => ({ ...c, droite: c.droiteType === 'valeur' || typeof c.droite === 'number' ? Number(c.droite) : c.droite, droiteType: undefined, message: c.message || null })),
    };
    setEnCours(true);
    try { await runAction(() => api.put(`/donnees/versions/${version.id}`, corps), 'Questionnaire enregistré.'); } finally { setEnCours(false); }
    onSaved();
  };
  return (
    <div className="space-y-4">
      <Card title={`Questions de la version ${version.version}`}>
        <div className="space-y-3">
          {questions.map((q, i) => (
            <fieldset key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 lg:grid-cols-12">
              <legend className="sr-only">Question {i + 1}</legend>
              <input className="input font-mono lg:col-span-2" placeholder="CODE" value={q.code} onChange={(e) => maj(i, 'code', e.target.value.toUpperCase())} aria-label="Code de la question" />
              <input className="input lg:col-span-6" placeholder="Libellé de la question" value={q.libelle} onChange={(e) => maj(i, 'libelle', e.target.value)} aria-label="Libellé" />
              <select className="input lg:col-span-2" value={q.type} onChange={(e) => maj(i, 'type', e.target.value)} aria-label="Type">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <div className="flex items-center justify-end gap-1 lg:col-span-2">
                <label className="mr-1 flex items-center gap-1 text-xs"><input type="checkbox" checked={!!q.obligatoire} onChange={(e) => maj(i, 'obligatoire', e.target.checked)} /> Obligatoire</label>
                <button type="button" className="btn-ghost px-1" disabled={i === 0} aria-label="Monter" onClick={() => deplacer(i, -1)}><ArrowUp size={14} aria-hidden /></button>
                <button type="button" className="btn-ghost px-1" disabled={i === questions.length - 1} aria-label="Descendre" onClick={() => deplacer(i, 1)}><ArrowDown size={14} aria-hidden /></button>
                <button type="button" className="btn-ghost px-1 text-red-700" aria-label="Retirer" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden /></button>
              </div>
              <input className="input lg:col-span-3" placeholder="Section (facultatif)" value={q.section || ''} onChange={(e) => maj(i, 'section', e.target.value)} aria-label="Section" />
              <input className="input lg:col-span-5" placeholder="Aide à la saisie (facultatif)" value={q.aide || ''} onChange={(e) => maj(i, 'aide', e.target.value)} aria-label="Aide" />
              {NUMERIQUES.includes(q.type) && <>
                <input className="input lg:col-span-2" placeholder="Unité" value={q.unite || ''} onChange={(e) => maj(i, 'unite', e.target.value)} aria-label="Unité" />
                <div className="flex gap-1 lg:col-span-2"><input className="input" placeholder="Min" value={q.min} onChange={(e) => maj(i, 'min', e.target.value)} aria-label="Minimum" /><input className="input" placeholder="Max" value={q.max} onChange={(e) => maj(i, 'max', e.target.value)} aria-label="Maximum" /></div>
              </>}
              {['CHOIX', 'CHOIX_MULTIPLE'].includes(q.type) && <input className="input lg:col-span-4" placeholder="Options séparées par ;" value={q.options.join(';')} onChange={(e) => maj(i, 'options', e.target.value.split(';'))} aria-label="Options" />}
            </fieldset>
          ))}
          {!questions.length && <EmptyState compact title="Aucune question">Ajoutez les questions dans l’ordre du formulaire papier : code, libellé, type, puis unité et bornes pour les nombres.</EmptyState>}
        </div>
        <button type="button" className="btn-secondary mt-3" onClick={() => setQuestions([...questions, { ...QUESTION_VIDE }])}><Plus size={16} aria-hidden /> Question</button>
      </Card>
      <Card title="Contrôles de cohérence">
        <p className="mb-2 text-xs text-slate-500">Comparaison entre deux questions numériques, ou avec une valeur ; une réponse qui ne respecte pas le contrôle est bloquée.</p>
        <div className="space-y-2">
          {controles.map((c, i) => {
            const set = (k, v) => setControles(controles.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
            const valeur = c.droiteType === 'valeur' || typeof c.droite === 'number';
            return (
              <div key={i} className="grid gap-2 lg:grid-cols-12">
                <select className="input lg:col-span-2" value={c.gauche} onChange={(e) => set('gauche', e.target.value)} aria-label="Question"><option value="">—</option>{numeriques.map((q) => <option key={q.code} value={q.code}>{q.code}</option>)}</select>
                <select className="input lg:col-span-1" value={c.operateur} onChange={(e) => set('operateur', e.target.value)} aria-label="Opérateur">{['<=', '>=', '=', '<', '>'].map((o) => <option key={o} value={o}>{o}</option>)}</select>
                {valeur
                  ? <input className="input lg:col-span-2" value={c.droite} onChange={(e) => set('droite', e.target.value)} aria-label="Valeur" />
                  : <select className="input lg:col-span-2" value={c.droite} onChange={(e) => set('droite', e.target.value)} aria-label="Comparée à"><option value="">—</option>{numeriques.map((q) => <option key={q.code} value={q.code}>{q.code}</option>)}</select>}
                <button type="button" className="text-xs text-dep-700 hover:underline lg:col-span-1" onClick={() => setControles(controles.map((x, j) => (j === i ? { ...x, droiteType: valeur ? 'question' : 'valeur', droite: '' } : x)))}>{valeur ? 'question' : 'valeur'}</button>
                <input className="input lg:col-span-5" placeholder="Message affiché" value={c.message || ''} onChange={(e) => set('message', e.target.value)} aria-label="Message" />
                <button type="button" className="btn-ghost justify-self-end px-2 text-red-700 lg:col-span-1" aria-label="Retirer le contrôle" onClick={() => setControles(controles.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden /></button>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn-secondary mt-3" disabled={numeriques.length < 1} onClick={() => setControles([...controles, { gauche: '', operateur: '<=', droite: '', message: '' }])}><Plus size={16} aria-hidden /> Contrôle</button>
      </Card>
      <ActionBar dirty={modifie} saving={enCours} onSave={enregistrer} onCancel={onCancel} saveLabel={`Enregistrer la version ${version.version}`} />
    </div>
  );
}

export default function QuestionnaireDetail() {
  const { id } = useParams();
  const state = useApi(`/donnees/questionnaires/${id}`, [id]);
  const confirm = useConfirm();
  const [edition, setEdition] = useState(false);
  const [entete, setEntete] = useState(null);
  const [vue, setVue] = useState(null);
  return (
    <Loadable state={state}>
      {(q) => {
        const g = q.droits.questionnaires;
        const brouillon = q.versions.find((v) => v.statut === 'BROUILLON');
        const courante = q.versions.find((v) => v.id === vue) || brouillon || q.versions[0];
        const publier = async () => {
          if (!(await confirm({ title: `Publier la version ${brouillon.version} ?`, message: 'Une version publiée est figée : elle ne pourra plus être modifiée. Les campagnes l’utiliseront telle quelle.', confirmLabel: 'Publier' }))) return;
          await runAction(() => api.post(`/donnees/versions/${brouillon.id}/publier`), 'Version publiée.');
          state.reload();
        };
        const nouvelleVersion = async () => { const r = await runAction(() => api.post(`/donnees/questionnaires/${id}/versions`), 'Nouvelle version créée à partir de la dernière.'); setVue(r.data.id); state.reload(); };
        return (
          <>
            <PageHeader title={q.titre} subtitle={`Questionnaire ${q.code}${q.actif ? '' : ' · inactif'}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees?onglet=questionnaires' }, { label: q.code }]}
              actions={g && !edition && <>
                {brouillon && <button type="button" className="btn-secondary" onClick={() => { setVue(brouillon.id); setEdition(true); }}><Pencil size={16} aria-hidden /> Modifier la v{brouillon.version}</button>}
                {brouillon && <button type="button" className="btn-success" disabled={!brouillon.questions.length} title={brouillon.questions.length ? undefined : 'Ajoutez au moins une question'} onClick={publier}><CheckCircle2 size={16} aria-hidden /> Publier la v{brouillon.version}</button>}
              </>}
              menu={g && !edition ? [
                { label: 'Intitulé', icon: Pencil, onClick: () => setEntete({ titre: q.titre, description: q.description || '', actif: q.actif }) },
                !brouillon && { label: 'Nouvelle version', icon: CopyPlus, onClick: nouvelleVersion },
              ] : []} />
            {q.description && <p className="mb-3 whitespace-pre-line text-sm text-slate-600">{q.description}</p>}
            {edition && brouillon ? <Editeur version={brouillon} onCancel={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} /> : (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title={`Version ${courante.version}`} className="lg:col-span-2" actions={courante.statut === 'PUBLIEE' ? <Badge tone="succes">Publiée</Badge> : <Badge tone="attention">En préparation</Badge>}>
                  {courante.questions.length ? <ol className="divide-y">{courante.questions.map((x, i) => <Apercu key={x.code} q={x} i={i} />)}</ol> : <EmptyState compact title="Aucune question">{g && courante.statut !== 'PUBLIEE' ? 'Utilisez « Modifier » pour saisir les questions de cette version.' : 'Cette version ne comporte pas de question.'}</EmptyState>}
                  {courante.controles.length > 0 && (
                    <div className="mt-3 border-t pt-2 text-sm"><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Contrôles de cohérence</div>
                      <ul className="space-y-0.5">{courante.controles.map((c, i) => <li key={i}><span className="font-mono text-xs">{c.gauche} {c.operateur} {c.droite}</span>{c.message && <span className="text-slate-600"> — {c.message}</span>}</li>)}</ul>
                    </div>
                  )}
                </Card>
                <Card title="Versions">
                  <ul className="divide-y text-sm">{q.versions.map((v) => (
                    <li key={v.id}><button type="button" className={`flex w-full items-center justify-between gap-2 py-1.5 text-left ${v.id === courante.id ? 'font-semibold text-dep-800' : ''}`} onClick={() => setVue(v.id)}>
                      <span>v{v.version} · {v.questions.length} question(s){v.campagnes > 0 && ` · ${v.campagnes} campagne(s)`}</span>
                      <span className="text-xs text-slate-500">{v.statut === 'PUBLIEE' ? `publiée ${fmtDateTime(v.publiee_at)}` : 'en préparation'}</span>
                    </button></li>
                  ))}</ul>
                  <InfoAlert>Une version publiée est figée en base. Pour faire évoluer le questionnaire, créez une nouvelle version : les campagnes passées gardent la leur.</InfoAlert>
                </Card>
              </div>
            )}
            {entete && (
              <FormModal open title="Questionnaire" onClose={() => setEntete(null)} dirty={entete.titre !== q.titre || entete.description !== (q.description || '') || entete.actif !== q.actif}
                onSubmit={async () => { if (!entete.titre.trim()) throw new Error('Le titre est obligatoire.'); await api.put(`/donnees/questionnaires/${id}`, entete); toast.success('Questionnaire mis à jour.'); setEntete(null); state.reload(); }}>
                <FormSection cols={1}>
                  <Field label="Titre" required><input className="input" value={entete.titre} onChange={(e) => setEntete({ ...entete, titre: e.target.value })} /></Field>
                  <Field label="Description"><textarea className="input" rows={3} value={entete.description} onChange={(e) => setEntete({ ...entete, description: e.target.value })} /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entete.actif} onChange={(e) => setEntete({ ...entete, actif: e.target.checked })} /> Actif (proposé pour de nouvelles campagnes)</label>
                </FormSection>
              </FormModal>
            )}
          </>
        );
      }}
    </Loadable>
  );
}
