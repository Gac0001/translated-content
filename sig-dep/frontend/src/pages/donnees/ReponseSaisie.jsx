import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Send, Trash2, Undo2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Field, Badge, Button, WorkflowPanel, NumberInput, ActionBar, runAction, useConfirm } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime, fmtNombre, lireNombre } from '../../lib/format';
import { circuitReponse } from '../../lib/workflows';
import { SOURCES } from './Donnees';

const NUMERIQUES = ['NOMBRE', 'ENTIER'];
const affiche = (q, v) => {
  if (v === undefined || v === null || v === '') return '—';
  if (q.type === 'OUI_NON') return v ? 'Oui' : 'Non';
  if (q.type === 'CHOIX_MULTIPLE') return v.join(', ');
  if (NUMERIQUES.includes(q.type)) return `${fmtNombre(v, 4)}${q.unite ? ` ${q.unite}` : ''}`;
  if (q.type === 'DATE') return fmtDate(v);
  return String(v);
};

function Champ({ q, valeur, onChange, anomalies, precedent }) {
  const id = `q-${q.code}`;
  const erreur = anomalies.find((a) => a.niveau === 'ERREUR');
  const alerte = anomalies.find((a) => a.niveau === 'ALERTE');
  let input;
  switch (q.type) {
    case 'TEXTE': input = <textarea id={id} className="input" rows={2} value={valeur ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'DATE': input = <input id={id} type="date" className="input w-48" value={valeur ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'CHOIX': input = <select id={id} className="input" value={valeur ?? ''} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{q.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>; break;
    case 'CHOIX_MULTIPLE': input = (
      <div className="flex flex-wrap gap-3">{q.options.map((o) => (
        <label key={o} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={(valeur || []).includes(o)} onChange={(e) => onChange(e.target.checked ? [...(valeur || []), o] : (valeur || []).filter((x) => x !== o))} />{o}</label>
      ))}</div>
    ); break;
    case 'OUI_NON': input = (
      <div className="flex gap-4">{[[true, 'Oui'], [false, 'Non']].map(([v, l]) => <label key={l} className="flex items-center gap-1.5 text-sm"><input type="radio" name={id} checked={valeur === v} onChange={() => onChange(v)} />{l}</label>)}
        {valeur !== undefined && valeur !== null && <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => onChange(null)}>effacer</button>}</div>
    ); break;
    default: input = <div className="flex items-center gap-2"><NumberInput id={id} className="w-48" value={valeur ?? null} onChange={onChange} decimales={q.type === 'ENTIER' ? 0 : 4} aria-invalid={erreur ? true : undefined} />{q.unite && <span className="text-sm text-slate-500">{q.unite}</span>}</div>;
  }
  return (
    <div className={`rounded-md p-2 ${erreur ? 'bg-red-50' : alerte ? 'bg-amber-50' : ''}`}>
      <label htmlFor={id} className="label">{q.libelle}{q.obligatoire && <span className="text-red-600" aria-hidden> *</span>} <span className="font-mono text-xs font-normal text-slate-400">{q.code}</span></label>
      {input}
      {q.aide && <p className="mt-1 text-xs text-slate-500">{q.aide}</p>}
      {precedent !== undefined && precedent !== null && <p className="mt-1 text-xs text-slate-500">Période précédente : {affiche(q, precedent)}</p>}
      {anomalies.map((a, i) => <p key={i} className={`mt-1 text-xs ${a.niveau === 'ERREUR' ? 'text-red-700' : 'text-amber-800'}`}>{a.message}</p>)}
    </div>
  );
}

/** Valeur numérique enregistrée → nombre (une ancienne saisie non numérique est écartée). */
const enNombre = (v) => { if (typeof v === 'number') return v; const n = lireNombre(v); return Number.isFinite(n) ? n : null; };

function Formulaire({ d, onSaved, onModifie }) {
  const r = d.reponse;
  const [initial] = useState(() => ({
    valeurs: Object.fromEntries(Object.entries(r?.valeurs || {}).map(([k, v]) => [k, NUMERIQUES.includes(d.version.questions.find((q) => q.code === k)?.type) ? enNombre(v) : v])),
    meta: { source: r?.source || 'PAPIER', date_reception: r?.date_reception ? String(r.date_reception).slice(0, 10) : '', justification: r?.justification || '', observations: r?.statut === 'A_CORRIGER' ? '' : r?.observations || '' },
  }));
  const [valeurs, setValeurs] = useState(initial.valeurs);
  const [meta, setMeta] = useState(initial.meta);
  const [enCours, setEnCours] = useState(false);
  const change = JSON.stringify({ valeurs, meta }) !== JSON.stringify(initial);
  const modifie = !r || change; // une première saisie peut être enregistrée telle quelle
  useEffect(() => { onModifie(change); }, [change, onModifie]);
  const anomalies = r?.anomalies || [];
  const enregistrer = async () => {
    setEnCours(true);
    let res;
    try { res = await runAction(() => api.put(`/donnees/campagnes/${d.campagne.id}/reponses/${d.acteur.id}`, { valeurs, source: meta.source, date_reception: meta.date_reception || null, justification: meta.justification || null, observations: meta.observations || null }), 'Réponse enregistrée et contrôlée.'); } finally { setEnCours(false); }
    onSaved(res.data);
  };
  const sections = [];
  for (const q of d.version.questions) {
    const s = q.section || '';
    if (!sections.length || sections[sections.length - 1].titre !== s) sections.push({ titre: s, questions: [] });
    sections[sections.length - 1].questions.push(q);
  }
  const alertes = anomalies.some((a) => a.niveau === 'ALERTE');
  return (
    <div className="space-y-4">
      <Card title="Source">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Source de la réponse"><select className="input" value={meta.source} onChange={(e) => setMeta({ ...meta, source: e.target.value })}>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Reçue le"><input className="input" type="date" value={meta.date_reception} onChange={(e) => setMeta({ ...meta, date_reception: e.target.value })} /></Field>
        </div>
      </Card>
      {sections.map((s, i) => (
        <Card key={i} title={s.titre || 'Questions'}>
          <div className="grid gap-2 md:grid-cols-2">
            {s.questions.map((q) => <Champ key={q.code} q={q} valeur={valeurs[q.code]} precedent={d.precedent?.[q.code]} anomalies={anomalies.filter((a) => a.question === q.code)} onChange={(v) => setValeurs({ ...valeurs, [q.code]: v })} />)}
          </div>
        </Card>
      ))}
      {anomalies.filter((a) => !d.version.questions.some((q) => q.code === a.question)).map((a, i) => <InfoAlert key={i} tone="warning">{a.message}</InfoAlert>)}
      <Card title="Commentaires">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Justification des alertes" hint={alertes ? 'Obligatoire pour transmettre une réponse qui comporte des alertes.' : 'Explication des écarts importants avec la période précédente.'}><textarea className="input" rows={3} value={meta.justification} onChange={(e) => setMeta({ ...meta, justification: e.target.value })} /></Field>
          <Field label="Observations"><textarea className="input" rows={3} value={meta.observations} onChange={(e) => setMeta({ ...meta, observations: e.target.value })} /></Field>
        </div>
      </Card>
      <ActionBar dirty={modifie} guard={change} saving={enCours} onSave={enregistrer} saveLabel="Enregistrer et contrôler" />
    </div>
  );
}

export default function ReponseSaisie() {
  const { id, acteur } = useParams();
  const state = useApi(`/donnees/campagnes/${id}/reponses/${acteur}`, [id, acteur]);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [modifie, setModifie] = useState(false);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/donnees/campagnes/${id}/reponses/${acteur}/${path}`, body), msg).catch(() => null); state.reload(); };
  return (
    <Loadable state={state}>
      {(d) => {
        const r = d.reponse;
        const a = d.actions;
        const erreurs = (r?.anomalies || []).filter((x) => x.niveau === 'ERREUR').length;
        const alertes = (r?.anomalies || []).filter((x) => x.niveau === 'ALERTE').length;
        const supprimer = async () => {
          if (!(await confirm({ title: 'Supprimer le brouillon', message: 'La réponse en brouillon sera supprimée.', confirmLabel: 'Supprimer', danger: true }))) return;
          await runAction(() => api.del(`/donnees/campagnes/${id}/reponses/${acteur}`), 'Brouillon supprimé.');
          navigate(`/donnees/campagnes/${id}`);
        };
        const aCorriger = async () => {
          const motif = await confirm({ title: 'Réponse à corriger', message: 'La réponse sera renvoyée à l’agent qui l’a saisie.', input: { label: 'Corrections demandées', required: true }, confirmLabel: 'Retourner', danger: true });
          if (motif) post('controler', { decision: 'A_CORRIGER', motif }, 'Réponse retournée pour correction.');
        };
        const attente = !r ? (d.campagne.statut === 'OUVERTE' ? 'Aucune réponse saisie pour cet acteur.' : 'La campagne n’est pas ouverte à la saisie.')
          : { BROUILLON: 'Brouillon : enregistrez, corrigez les erreurs, puis transmettez au contrôle.', A_CORRIGER: 'Retournée pour correction à l’agent de saisie.', SAISIE: 'Transmise : en attente du contrôle par une autre personne que l’agent de saisie.', CONTROLEE: 'Réponse contrôlée : elle sera exploitée à la validation de la campagne.' }[r.statut];
        const bloque = erreurs > 0 ? 'Corrigez les erreurs avant transmission' : modifie ? 'Enregistrez d’abord la saisie' : undefined;
        return (
          <>
            <PageHeader title={d.acteur.raison_sociale} subtitle={`${d.campagne.titre} · période ${d.campagne.periode}`}
              breadcrumb={[{ label: 'Données sectorielles', to: '/donnees?onglet=campagnes' }, { label: d.campagne.reference, to: `/donnees/campagnes/${id}` }, { label: d.acteur.sigle || d.acteur.raison_sociale }]}
              menu={a.supprimer ? [{ label: 'Supprimer le brouillon', icon: Trash2, danger: true, onClick: supprimer }] : []} />
            <WorkflowPanel circuit={circuitReponse(r)} attente={attente}
              message={r && (r.statut === 'A_CORRIGER' || erreurs > 0 || alertes > 0) && <>
                {r?.statut === 'A_CORRIGER' && <InfoAlert tone="warning"><b>À corriger</b> : {r.observations}</InfoAlert>}
                {r && (erreurs > 0 || alertes > 0) && <div className={r?.statut === 'A_CORRIGER' ? 'mt-2' : ''}><InfoAlert tone={erreurs ? 'danger' : 'warning'}>Contrôle de qualité : {erreurs} erreur(s) bloquante(s), {alertes} alerte(s) à justifier.</InfoAlert></div>}
              </>}
              actions={[
                a.soumettre && <Button key="so" variant="primary" icon={Send} disabled={!!bloque} title={bloque} onClick={() => post('soumettre', {}, 'Réponse transmise au contrôle.')}>Transmettre au contrôle</Button>,
                a.controler && <Button key="co" variant="success" icon={CheckCircle2} onClick={() => post('controler', { decision: 'CONTROLEE' }, 'Réponse contrôlée.')}>Contrôlée</Button>,
                a.controler && <Button key="ac" icon={Undo2} onClick={aCorriger}>À corriger</Button>,
              ]} />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                {a.saisir ? <Formulaire key={r?.updated_at || 'nouvelle'} d={d} onModifie={setModifie} onSaved={() => state.reload()} /> : (
                  <Card title="Réponse">
                    {r ? (
                      <dl className="divide-y text-sm">{d.version.questions.map((q) => {
                        const an = r.anomalies.filter((x) => x.question === q.code);
                        return (
                          <div key={q.code} className="grid gap-1 py-1.5 sm:grid-cols-2">
                            <dt className="text-slate-600">{q.libelle}</dt>
                            <dd className="font-medium">{affiche(q, r.valeurs[q.code])}{d.precedent?.[q.code] !== undefined && <span className="ml-2 text-xs font-normal text-slate-500">(précédent : {affiche(q, d.precedent[q.code])})</span>}
                              {an.map((x, i) => <div key={i} className={`text-xs font-normal ${x.niveau === 'ERREUR' ? 'text-red-700' : 'text-amber-800'}`}>{x.message}</div>)}</dd>
                          </div>
                        );
                      })}</dl>
                    ) : <p className="text-sm text-slate-500">Aucune réponse saisie{d.campagne.statut !== 'OUVERTE' ? ' : la campagne n’est pas ouverte à la saisie.' : '.'}</p>}
                    {r?.justification && <p className="mt-3 border-t pt-2 text-sm"><b>Justification :</b> {r.justification}</p>}
                  </Card>
                )}
              </div>
              <div className="space-y-4">
                <Card title="Acteur">
                  <KeyValues cols={1} items={[['Référence', d.acteur.reference], ['Catégorie', d.acteur.categorie], ['Province', d.acteur.zone]]} />
                </Card>
                {r && (
                  <Card title="Réponse">
                    <KeyValues cols={1} items={[
                      ['Statut', <StatusBadge key="s" value={r.statut} />], ['Qualité', erreurs ? <Badge key="q" tone="danger">{erreurs} erreur(s)</Badge> : alertes ? <Badge key="q" tone="attention">{alertes} alerte(s)</Badge> : <Badge key="q" tone="succes">Conforme</Badge>],
                      ['Source', SOURCES[r.source]], ['Reçue le', r.date_reception ? fmtDate(r.date_reception) : '—'], ['Saisie par', r.saisi_par_nom || '—'], r.saisi_at && ['Transmise le', fmtDateTime(r.saisi_at)],
                    ]} />
                  </Card>
                )}
                {r && <Card title="Pièces sources"><Attachments type="REPONSE_SECT" id={r.id} canUpload={a.saisir} /></Card>}
                {r && <Card title="Historique"><Timeline items={d.historique} /></Card>}
              </div>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
