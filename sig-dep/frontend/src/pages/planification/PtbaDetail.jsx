import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileDown, FileSpreadsheet, Gauge, Pencil, Plus, Save, Send, Trash2, Undo2, X } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Modal, Field, Progress, runAction, toast } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDateTime } from '../../lib/format';
import { TextModal } from '../instructions/WorkflowActions';
import { cdf } from './Planification';

const MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const LIGNE_VIDE = { activite: '', taches: '', cout: 0, mois: [], structure_responsable: '', resultats_attendus: '', indicateur: '', source_verification: '', source_financement: 'Trésor Public' };

function Chronogramme({ mois, onToggle }) {
  return (
    <div className="flex">
      {MOIS.map((m, k) => {
        const on = mois.includes(k + 1);
        const cls = `h-6 w-5 border-y border-r border-slate-300 text-center text-[10px] leading-6 first:border-l ${on ? 'bg-yellow-300 font-semibold text-slate-900' : 'bg-white text-slate-400'} ${k % 3 === 0 ? 'border-l-slate-500' : ''}`;
        return onToggle
          ? <button key={k} type="button" className={cls} aria-pressed={on} aria-label={`Mois ${k + 1}`} onClick={() => onToggle(k + 1)}>{m}</button>
          : <span key={k} className={cls}>{m}</span>;
      })}
    </div>
  );
}

/** Éditeur du PTBA : objectifs spécifiques et lignes (activité, tâches, coût, chronogramme…). */
function Editeur({ p, referentiel, onSaved, onCancel }) {
  const [entete, setEntete] = useState({ programme_id: p.programme_id ? String(p.programme_id) : '', objectif_global: p.objectif_global || '' });
  const [objectifs, setObjectifs] = useState(() => {
    const g = p.objectifs.map((o) => ({ libelle: o.libelle, lignes: p.lignes.filter((l) => l.objectif_id === o.id) }));
    const libres = p.lignes.filter((l) => !l.objectif_id);
    if (libres.length || !g.length) g.push({ libelle: '', lignes: libres.length ? libres : [{ ...LIGNE_VIDE }] });
    return g;
  });
  const majLigne = (oi, li, k, v) => setObjectifs(objectifs.map((o, i) => (i !== oi ? o : { ...o, lignes: o.lignes.map((l, j) => (j === li ? { ...l, [k]: v } : l)) })));
  const toggle = (oi, li, m) => { const l = objectifs[oi].lignes[li]; majLigne(oi, li, 'mois', l.mois.includes(m) ? l.mois.filter((x) => x !== m) : [...l.mois, m]); };
  const enregistrer = async () => {
    const corps = {
      programme_id: entete.programme_id ? Number(entete.programme_id) : null, objectif_global: entete.objectif_global || null,
      objectifs: objectifs.map((o) => ({ libelle: o.libelle, lignes: o.lignes.filter((l) => l.activite.trim()).map((l) => ({
        numero: l.numero || null, activite: l.activite, taches: l.taches || null, cout: Number(l.cout) || 0, mois: l.mois, structure_responsable: l.structure_responsable || null,
        resultats_attendus: l.resultats_attendus || null, indicateur: l.indicateur || null, source_verification: l.source_verification || null, source_financement: l.source_financement || null,
      })) })).filter((o) => o.libelle || o.lignes.length),
    };
    await runAction(() => api.put(`/ptba/${p.id}`, corps), 'PTBA enregistré.');
    onSaved();
  };
  return (
    <div className="space-y-4">
      <Card title="En-tête">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Programme"><select className="input" value={entete.programme_id} onChange={(e) => setEntete({ ...entete, programme_id: e.target.value })}><option value="">—</option>{referentiel.programmes.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.libelle}</option>)}</select></Field>
          <Field label="Objectif global"><textarea className="input" rows={2} value={entete.objectif_global} onChange={(e) => setEntete({ ...entete, objectif_global: e.target.value })} /></Field>
        </div>
      </Card>
      {objectifs.map((o, oi) => (
        <Card key={oi} title={`Objectif spécifique ${oi + 1}`} actions={<button type="button" className="btn-ghost px-2 text-red-700" aria-label="Retirer l’objectif" onClick={() => setObjectifs(objectifs.filter((_, i) => i !== oi))}><Trash2 size={15} /></button>}>
          <input className="input mb-3" placeholder="Libellé de l’objectif spécifique" value={o.libelle} onChange={(e) => setObjectifs(objectifs.map((x, i) => (i === oi ? { ...x, libelle: e.target.value } : x)))} />
          <div className="space-y-3">
            {o.lignes.map((l, li) => (
              <div key={li} className="grid gap-2 rounded-md border border-slate-200 p-3 lg:grid-cols-12">
                <input className="input lg:col-span-5" placeholder="Activité principale" value={l.activite} onChange={(e) => majLigne(oi, li, 'activite', e.target.value)} />
                <input className="input lg:col-span-2" type="number" min="0" step="1000" placeholder="Coût (CDF)" value={l.cout} onChange={(e) => majLigne(oi, li, 'cout', e.target.value)} aria-label="Coût en CDF" />
                <div className="flex items-center lg:col-span-4"><Chronogramme mois={l.mois} onToggle={(m) => toggle(oi, li, m)} /></div>
                <button type="button" className="btn-ghost justify-self-end px-2 text-red-700 lg:col-span-1" aria-label="Retirer la ligne" onClick={() => setObjectifs(objectifs.map((x, i) => (i === oi ? { ...x, lignes: x.lignes.filter((_, j) => j !== li) } : x)))}><X size={15} /></button>
                <textarea className="input lg:col-span-6" rows={2} placeholder="Tâches" value={l.taches || ''} onChange={(e) => majLigne(oi, li, 'taches', e.target.value)} />
                <textarea className="input lg:col-span-6" rows={2} placeholder="Résultats attendus" value={l.resultats_attendus || ''} onChange={(e) => majLigne(oi, li, 'resultats_attendus', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Structure responsable" value={l.structure_responsable || ''} onChange={(e) => majLigne(oi, li, 'structure_responsable', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Indicateur de réalisation" value={l.indicateur || ''} onChange={(e) => majLigne(oi, li, 'indicateur', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Source / moyen de vérification" value={l.source_verification || ''} onChange={(e) => majLigne(oi, li, 'source_verification', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Source de financement" value={l.source_financement || ''} onChange={(e) => majLigne(oi, li, 'source_financement', e.target.value)} />
              </div>
            ))}
          </div>
          <button type="button" className="btn-secondary mt-3" onClick={() => setObjectifs(objectifs.map((x, i) => (i === oi ? { ...x, lignes: [...x.lignes, { ...LIGNE_VIDE }] } : x)))}><Plus size={16} /> Ligne</button>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setObjectifs([...objectifs, { libelle: '', lignes: [{ ...LIGNE_VIDE }] }])}><Plus size={16} /> Objectif spécifique</button>
        <button type="button" className="btn-primary" onClick={enregistrer}><Save size={16} /> Enregistrer</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function SuiviModal({ ligne, onClose, onSaved }) {
  const dernier = ligne.suivi[ligne.suivi.length - 1];
  const [f, setF] = useState({ trimestre: String(Math.min(4, Math.floor(new Date().getMonth() / 3) + 1)), taux_physique: dernier?.taux_physique ?? 0, montant_engage: dernier?.montant_engage ?? 0, montant_decaisse: dernier?.montant_decaisse ?? 0, commentaire: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enregistrer = async () => {
    await runAction(() => api.put(`/ptba/lignes/${ligne.id}/suivi/${f.trimestre}`, { taux_physique: Number(f.taux_physique), montant_engage: Number(f.montant_engage), montant_decaisse: Number(f.montant_decaisse), commentaire: f.commentaire || null }), 'Exécution enregistrée.');
    onSaved();
  };
  return (
    <Modal open title="Exécution de l’activité" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
      <p className="mb-3 text-sm"><b>{ligne.activite}</b> — programmé : {cdf(ligne.cout)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Trimestre"><select className="input" value={f.trimestre} onChange={up('trimestre')}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}</select></Field>
        <Field label={`Exécution physique cumulée : ${f.taux_physique} %`}><input type="range" min="0" max="100" value={f.taux_physique} onChange={up('taux_physique')} className="w-full" /></Field>
        <Field label="Montant engagé cumulé (CDF)"><input type="number" min="0" className="input" value={f.montant_engage} onChange={up('montant_engage')} /></Field>
        <Field label="Montant décaissé cumulé (CDF)"><input type="number" min="0" className="input" value={f.montant_decaisse} onChange={up('montant_decaisse')} /></Field>
        <Field label="Commentaire" className="sm:col-span-2"><textarea className="input" rows={2} value={f.commentaire} onChange={up('commentaire')} /></Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">Joignez les preuves (rapports, PV, bons de livraison) dans les pièces justificatives du PTBA.</p>
    </Modal>
  );
}

export default function PtbaDetail() {
  const { id } = useParams();
  const state = useApi(`/ptba/${id}`, [id]);
  const ref = useApi('/planification/referentiel');
  const can = useAuth((s) => s.can);
  const [edition, setEdition] = useState(false);
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/ptba/${id}/${path}`, body), msg); setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(p) => {
        const a = p.actions;
        const groupes = [...p.objectifs.map((o) => ({ titre: o.libelle, lignes: p.lignes.filter((l) => l.objectif_id === o.id) })), { titre: null, lignes: p.lignes.filter((l) => !l.objectif_id) }].filter((g) => g.lignes.length);
        return (
          <>
            <PageHeader title={`PTBA ${p.annee} — ${p.service_sigle}`} subtitle={`${p.service_libelle} · ${p.reference}`} breadcrumb={[{ label: 'Planification', to: '/planification' }, { label: `PTBA ${p.service_sigle}` }]}
              actions={<>
                {can('exports.generer') && <button type="button" className="btn-secondary" onClick={() => download(`/ptba/${id}/export/xlsx`, `PTBA-${p.annee}-${p.service_sigle}.xlsx`).catch((e) => toast.error(errorMessage(e)))}><FileSpreadsheet size={16} /> Excel</button>}
                {can('exports.generer') && <button type="button" className="btn-secondary" onClick={() => download(`/ptba/${id}/export/pdf`).catch((e) => toast.error(errorMessage(e)))}><FileDown size={16} /> PDF</button>}
                {a.modifier && !edition && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} /> Modifier</button>}
                {a.soumettre && !edition && <button type="button" className="btn-primary" onClick={() => post('soumettre', {}, 'PTBA soumis au Chef du Bureau Programme.')}><Send size={16} /> Soumettre</button>}
                {a.verifier && <button type="button" className="btn-success" onClick={() => post('verifier', {}, 'PTBA vérifié.')}><CheckCircle2 size={16} /> Vérifié</button>}
                {a.consolider && <button type="button" className="btn-success" onClick={() => post('consolider', {}, 'PTBA consolidé : transmis au Directeur.')}><CheckCircle2 size={16} /> Consolider</button>}
                {a.valider && <button type="button" className="btn-success" onClick={() => post('valider', {}, 'PTBA validé.')}><CheckCircle2 size={16} /> Valider</button>}
                {a.retourner && <button type="button" className="btn-secondary" onClick={() => setModal('retour')}><Undo2 size={16} /> Retourner</button>}
              </>} />
            {p.statut === 'A_CORRIGER' && <div className="mb-3"><InfoAlert tone="warning"><b>À corriger</b> : {p.observations}</InfoAlert></div>}
            {edition && ref.data ? <Editeur p={p} referentiel={ref.data} onCancel={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} /> : (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="PTBA" className="lg:col-span-2">
                  <KeyValues items={[
                    ['Statut', <StatusBadge key="s" value={p.statut} />], ['Exercice', p.annee], ['Programme', p.programme_libelle || '—'], ['Coût total', cdf(p.execution.cout)],
                    p.valide_at && ['Validé le', fmtDateTime(p.valide_at)],
                  ]} />
                  {p.objectif_global && <p className="mt-3 text-sm"><b>Objectif global :</b> {p.objectif_global}</p>}
                </Card>
                <Card title="Coût programmé par trimestre">
                  <ul className="space-y-1 text-sm">{p.trimestres.map((t, i) => <li key={i} className="flex justify-between"><span>T{i + 1}</span><span className="tabular-nums">{cdf(t)}</span></li>)}</ul>
                  {p.statut === 'VALIDE' && <div className="mt-3 space-y-2 border-t pt-3 text-sm"><div>Exécution physique <Progress value={p.execution.tauxPhysique} /></div><div>Exécution financière ({cdf(p.execution.decaisse)}) <Progress value={Math.round(p.execution.tauxFinancier)} /></div></div>}
                </Card>
                <div className="space-y-4 lg:col-span-3">
                  {groupes.map((g, gi) => (
                    <Card key={gi} title={g.titre ? `Objectif spécifique ${gi + 1} : ${g.titre}` : 'Activités'} bodyClass="p-0">
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="px-3 py-2">Activité et tâches</th><th className="px-3 text-right">Coût</th><th className="px-3">Chronogramme</th><th className="px-3">Responsable</th><th className="px-3">Résultats et indicateur</th>{p.statut === 'VALIDE' && <th className="px-3">Exécution</th>}</tr></thead>
                          <tbody>
                            {g.lignes.map((l) => {
                              const d = l.suivi[l.suivi.length - 1];
                              return (
                                <tr key={l.id} className="border-b border-slate-100 align-top">
                                  <td className="max-w-md px-3 py-2"><div className="font-medium">{l.activite}</div>{l.taches && <div className="whitespace-pre-line text-xs text-slate-500">{l.taches}</div>}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cdf(l.cout)}</td>
                                  <td className="px-3 py-2"><Chronogramme mois={l.mois} /></td>
                                  <td className="px-3 py-2">{l.structure_responsable || '—'}<div className="text-xs text-slate-500">{l.source_financement}</div></td>
                                  <td className="max-w-xs px-3 py-2 text-xs">{l.resultats_attendus}<div className="text-slate-500">{l.indicateur}{l.source_verification ? ` — ${l.source_verification}` : ''}</div></td>
                                  {p.statut === 'VALIDE' && (
                                    <td className="w-48 px-3 py-2 text-xs">
                                      {d ? <><Progress value={d.taux_physique} /><div className="mt-1 text-slate-500">T{d.trimestre} · décaissé {cdf(d.montant_decaisse)}</div></> : <span className="text-slate-500">Non renseignée</span>}
                                      {a.suivre && <button type="button" className="mt-1 inline-flex items-center gap-1 text-dep-700 hover:underline" onClick={() => setModal({ suivi: l })}><Gauge size={12} /> Saisir</button>}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  ))}
                  {!groupes.length && <InfoAlert>Aucune activité : utilisez « Modifier » pour saisir le PTBA ou importez un classeur depuis la liste.</InfoAlert>}
                </div>
                <Card title="Pièces justificatives"><Attachments type="PTBA" id={id} canUpload={a.modifier || a.suivre} /></Card>
                <Card title="Historique" className="lg:col-span-2"><Timeline items={p.historique} /></Card>
              </div>
            )}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Corrections demandées" confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(t) => post('retourner', { motif: t }, 'PTBA retourné au Bureau Programme.')} />}
            {modal?.suivi && <SuiviModal ligne={modal.suivi} onClose={() => setModal(null)} onSaved={() => { setModal(null); state.reload(); }} />}
          </>
        );
      }}
    </Loadable>
  );
}
