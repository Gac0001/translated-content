import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileDown, FileSpreadsheet, Gauge, Pencil, Plus, Send, Trash2, Undo2, X } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import {
  useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Field, Progress, Button, WorkflowPanel, SimpleTable,
  FormModal, FormSection, MoneyInput, ActionBar, EmptyState, runAction, toast, useConfirm,
} from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDateTime } from '../../lib/format';
import { circuitProgrammation } from '../../lib/workflows';
import { cdf } from './Planification';

const MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const LIGNE_VIDE = { activite: '', taches: '', cout: 0, mois: [], structure_responsable: '', resultats_attendus: '', indicateur: '', source_verification: '', source_financement: 'Trésor Public' };

function Chronogramme({ mois, onToggle }) {
  return (
    <div className="flex">
      {MOIS.map((m, k) => {
        const on = mois.includes(k + 1);
        const cls = `h-6 w-5 border-y border-r border-slate-300 text-center text-[10px] leading-6 first:border-l ${on ? 'bg-yellow-300 font-semibold text-slate-900' : 'bg-white text-slate-500'} ${k % 3 === 0 ? 'border-l-slate-500' : ''}`;
        return onToggle
          ? <button key={k} type="button" className={cls} aria-pressed={on} aria-label={`Mois ${k + 1}`} onClick={() => onToggle(k + 1)}>{m}</button>
          : <span key={k} className={cls}>{m}</span>;
      })}
    </div>
  );
}

/** Éditeur du PTBA : objectifs spécifiques et lignes (activité, tâches, coût, chronogramme…). */
function Editeur({ p, referentiel, onSaved, onCancel }) {
  const [initial] = useState(() => {
    const g = p.objectifs.map((o) => ({ libelle: o.libelle, lignes: p.lignes.filter((l) => l.objectif_id === o.id) }));
    const libres = p.lignes.filter((l) => !l.objectif_id);
    if (libres.length || !g.length) g.push({ libelle: '', lignes: libres.length ? libres : [{ ...LIGNE_VIDE }] });
    return { entete: { programme_id: p.programme_id ? String(p.programme_id) : '', objectif_global: p.objectif_global || '' }, objectifs: g };
  });
  const [entete, setEntete] = useState(initial.entete);
  const [objectifs, setObjectifs] = useState(initial.objectifs);
  const [enCours, setEnCours] = useState(false);
  const modifie = JSON.stringify({ entete, objectifs }) !== JSON.stringify(initial);
  const total = objectifs.reduce((t, o) => t + o.lignes.reduce((u, l) => u + (Number(l.cout) || 0), 0), 0);
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
    setEnCours(true);
    try { await runAction(() => api.put(`/ptba/${p.id}`, corps), 'PTBA enregistré.'); } finally { setEnCours(false); }
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
        <Card key={oi} title={`Objectif spécifique ${oi + 1}`} actions={<button type="button" className="btn-ghost px-2 text-red-700" aria-label={`Retirer l’objectif spécifique ${oi + 1}`} onClick={() => setObjectifs(objectifs.filter((_, i) => i !== oi))}><Trash2 size={15} aria-hidden /></button>}>
          <input className="input mb-3" placeholder="Libellé de l’objectif spécifique" aria-label={`Libellé de l’objectif spécifique ${oi + 1}`} value={o.libelle} onChange={(e) => setObjectifs(objectifs.map((x, i) => (i === oi ? { ...x, libelle: e.target.value } : x)))} />
          <div className="space-y-3">
            {o.lignes.map((l, li) => (
              <fieldset key={li} className="grid gap-2 rounded-md border border-slate-200 p-3 lg:grid-cols-12">
                <legend className="sr-only">Activité {li + 1} de l’objectif {oi + 1}</legend>
                <input className="input lg:col-span-5" placeholder="Activité principale" aria-label="Activité principale" value={l.activite} onChange={(e) => majLigne(oi, li, 'activite', e.target.value)} />
                <div className="lg:col-span-2"><MoneyInput value={l.cout === '' ? null : Number(l.cout)} onChange={(v) => majLigne(oi, li, 'cout', v ?? 0)} aria-label="Coût en CDF" placeholder="Coût" /></div>
                <div className="flex items-center overflow-x-auto lg:col-span-4"><Chronogramme mois={l.mois} onToggle={(m) => toggle(oi, li, m)} /></div>
                <button type="button" className="btn-ghost justify-self-end px-2 text-red-700 lg:col-span-1" aria-label="Retirer la ligne" onClick={() => setObjectifs(objectifs.map((x, i) => (i === oi ? { ...x, lignes: x.lignes.filter((_, j) => j !== li) } : x)))}><X size={15} aria-hidden /></button>
                <textarea className="input lg:col-span-6" rows={2} placeholder="Tâches" value={l.taches || ''} onChange={(e) => majLigne(oi, li, 'taches', e.target.value)} />
                <textarea className="input lg:col-span-6" rows={2} placeholder="Résultats attendus" value={l.resultats_attendus || ''} onChange={(e) => majLigne(oi, li, 'resultats_attendus', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Structure responsable" value={l.structure_responsable || ''} onChange={(e) => majLigne(oi, li, 'structure_responsable', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Indicateur de réalisation" value={l.indicateur || ''} onChange={(e) => majLigne(oi, li, 'indicateur', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Source / moyen de vérification" value={l.source_verification || ''} onChange={(e) => majLigne(oi, li, 'source_verification', e.target.value)} />
                <input className="input lg:col-span-3" placeholder="Source de financement" value={l.source_financement || ''} onChange={(e) => majLigne(oi, li, 'source_financement', e.target.value)} />
              </fieldset>
            ))}
          </div>
          <button type="button" className="btn-secondary mt-3" onClick={() => setObjectifs(objectifs.map((x, i) => (i === oi ? { ...x, lignes: [...x.lignes, { ...LIGNE_VIDE }] } : x)))}><Plus size={16} aria-hidden /> Activité</button>
        </Card>
      ))}
      <button type="button" className="btn-secondary" onClick={() => setObjectifs([...objectifs, { libelle: '', lignes: [{ ...LIGNE_VIDE }] }])}><Plus size={16} aria-hidden /> Objectif spécifique</button>
      <ActionBar dirty={modifie} saving={enCours} onSave={enregistrer} onCancel={onCancel} saveLabel="Enregistrer le PTBA">
        <span className="hidden text-sm tabular-nums text-slate-600 sm:inline">Coût total : <b>{cdf(total)}</b></span>
      </ActionBar>
    </div>
  );
}

function SuiviModal({ ligne, onClose, onSaved }) {
  const dernier = ligne.suivi[ligne.suivi.length - 1];
  const [initial] = useState(() => ({ trimestre: String(Math.min(4, Math.floor(new Date().getMonth() / 3) + 1)), taux_physique: dernier?.taux_physique ?? 0, montant_engage: Number(dernier?.montant_engage ?? 0), montant_decaisse: Number(dernier?.montant_decaisse ?? 0), commentaire: '' }));
  const [f, setF] = useState(initial);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enregistrer = async () => {
    if ((f.montant_decaisse ?? 0) > (f.montant_engage ?? 0)) throw new Error('Le montant décaissé ne peut pas dépasser le montant engagé.');
    await api.put(`/ptba/lignes/${ligne.id}/suivi/${f.trimestre}`, { taux_physique: Number(f.taux_physique), montant_engage: f.montant_engage ?? 0, montant_decaisse: f.montant_decaisse ?? 0, commentaire: f.commentaire || null });
    toast.success('Exécution enregistrée.');
    onSaved();
  };
  return (
    <FormModal open title="Exécution de l’activité" onClose={onClose} onSubmit={enregistrer} dirty={JSON.stringify(f) !== JSON.stringify(initial)}>
      <p className="text-sm"><b>{ligne.activite}</b> — programmé : {cdf(ligne.cout)}</p>
      <FormSection>
        <Field label="Trimestre"><select className="input" value={f.trimestre} onChange={up('trimestre')}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>T{t}</option>)}</select></Field>
        <Field label={`Exécution physique cumulée : ${f.taux_physique} %`}><input type="range" min="0" max="100" step="5" value={f.taux_physique} onChange={up('taux_physique')} className="w-full accent-dep-700" /></Field>
        <Field label="Montant engagé cumulé"><MoneyInput value={f.montant_engage} onChange={(v) => setF({ ...f, montant_engage: v })} /></Field>
        <Field label="Montant décaissé cumulé"><MoneyInput value={f.montant_decaisse} onChange={(v) => setF({ ...f, montant_decaisse: v })} /></Field>
        <Field label="Commentaire" className="sm:col-span-2"><textarea className="input" rows={2} value={f.commentaire} onChange={up('commentaire')} /></Field>
      </FormSection>
      <p className="text-xs text-slate-500">Joignez les preuves (rapports, PV, bons de livraison) dans les pièces justificatives du PTBA.</p>
    </FormModal>
  );
}

function attente(p) {
  if (p.statut === 'VALIDE') return 'PTBA validé : il est intangible ; l’exécution trimestrielle se saisit ligne par ligne.';
  return {
    BROUILLON: 'En préparation au Bureau Programme.', A_CORRIGER: 'Retourné au Bureau Programme pour correction.',
    SOUMIS: 'En attente de vérification par le Chef du Bureau Programme.', VERIFIE: 'En attente de consolidation par le Chef de la Division Programme et Suivi.',
    CONSOLIDE: 'En attente de validation par le Directeur.',
  }[p.statut];
}

export default function PtbaDetail() {
  const { id } = useParams();
  const state = useApi(`/ptba/${id}`, [id]);
  const ref = useApi('/planification/referentiel');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [edition, setEdition] = useState(false);
  const [suivi, setSuivi] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/ptba/${id}/${path}`, body), msg); state.reload(); };
  const etape = async (path, msg, opts) => {
    if (opts) {
      const r = await confirm(opts);
      if (!r) return;
      if (typeof r === 'string') { await post(path, { motif: r }, msg).catch(() => {}); return; }
    }
    await post(path, {}, msg).catch(() => {});
  };
  return (
    <Loadable state={state}>
      {(p) => {
        const a = p.actions;
        const groupes = [...p.objectifs.map((o) => ({ titre: o.libelle, lignes: p.lignes.filter((l) => l.objectif_id === o.id) })), { titre: null, lignes: p.lignes.filter((l) => !l.objectif_id) }].filter((g) => g.lignes.length);
        const exporter = (format, nom) => download(`/ptba/${id}/export/${format}`, nom).catch((e) => toast.error(errorMessage(e)));
        const sauf = (f) => (l) => (l.pied ? '' : f(l)); // ligne de sous-total : cellules descriptives vides
        const colonnes = [
          { key: 'activite', header: 'Activité et tâches', className: 'min-w-[16rem] max-w-md', render: (l) => <><div className="font-medium text-slate-900">{l.activite}</div>{l.taches && <div className="whitespace-pre-line text-xs text-slate-500">{l.taches}</div>}</> },
          { key: 'cout', header: 'Coût', align: 'right', className: 'whitespace-nowrap', render: (l) => cdf(l.cout) },
          { key: 'mois', header: 'Chronogramme', render: sauf((l) => <Chronogramme mois={l.mois} />) },
          { key: 'responsable', header: 'Responsable', render: sauf((l) => <>{l.structure_responsable || '—'}<div className="text-xs text-slate-500">{l.source_financement}</div></>) },
          { key: 'resultats', header: 'Résultats et indicateur', className: 'max-w-xs text-xs', render: sauf((l) => <>{l.resultats_attendus}<div className="text-slate-500">{l.indicateur}{l.source_verification ? ` — ${l.source_verification}` : ''}</div></>) },
          p.statut === 'VALIDE' && { key: 'execution', header: 'Exécution', className: 'w-48 text-xs', render: sauf((l) => {
            const d = l.suivi[l.suivi.length - 1];
            return <>
              {d ? <><Progress value={d.taux_physique} label={`Exécution physique : ${l.activite}`} /><div className="mt-1 text-slate-500">T{d.trimestre} · décaissé {cdf(d.montant_decaisse)}</div></> : <span className="text-slate-500">Non renseignée</span>}
              {a.suivre && <button type="button" className="link mt-1 inline-flex items-center gap-1" onClick={() => setSuivi(l)}><Gauge size={12} aria-hidden /> Saisir</button>}
            </>;
          }) },
        ].filter(Boolean);
        return (
          <>
            <PageHeader title={`PTBA ${p.annee} — ${p.service_sigle}`} subtitle={`${p.service_libelle} · ${p.reference}`} breadcrumb={[{ label: 'Planification', to: '/planification' }, { label: `PTBA ${p.service_sigle}` }]}
              actions={a.modifier && !edition && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} aria-hidden /> Modifier</button>}
              menu={can('exports.generer') ? [
                { label: 'Excel', icon: FileSpreadsheet, onClick: () => exporter('xlsx', `PTBA-${p.annee}-${p.service_sigle}.xlsx`) },
                { label: 'PDF', icon: FileDown, onClick: () => exporter('pdf') },
              ] : []} />
            {!edition && (
              <WorkflowPanel circuit={circuitProgrammation(p)} attente={attente(p)}
                message={p.statut === 'A_CORRIGER' && <InfoAlert tone="warning"><b>À corriger</b> : {p.observations}</InfoAlert>}
                actions={[
                  a.soumettre && <Button key="so" variant="primary" icon={Send} onClick={() => etape('soumettre', 'PTBA soumis au Chef du Bureau Programme.')}>Soumettre</Button>,
                  a.verifier && <Button key="ve" variant="success" icon={CheckCircle2} onClick={() => etape('verifier', 'PTBA vérifié.')}>Vérifié</Button>,
                  a.consolider && <Button key="co" variant="success" icon={CheckCircle2} onClick={() => etape('consolider', 'PTBA consolidé : transmis au Directeur.')}>Consolider</Button>,
                  a.valider && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => etape('valider', 'PTBA validé.', { title: 'Valider le PTBA', message: 'Une fois validé, le PTBA devient intangible : seule l’exécution pourra être saisie.', confirmLabel: 'Valider' })}>Valider</Button>,
                  a.retourner && <Button key="re" icon={Undo2} onClick={() => etape('retourner', 'PTBA retourné au Bureau Programme.', { title: 'Retourner pour correction', message: 'Le PTBA sera renvoyé au Bureau Programme.', input: { label: 'Corrections demandées', required: true }, confirmLabel: 'Retourner', danger: true })}>Retourner</Button>,
                ]} />
            )}
            {edition && ref.data ? <Editeur p={p} referentiel={ref.data} onCancel={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} /> : (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="PTBA" className="lg:col-span-2">
                  <KeyValues items={[
                    ['Statut', <StatusBadge key="s" value={p.statut} />], ['Exercice', p.annee], ['Programme', p.programme_libelle || '—'], ['Coût total', cdf(p.execution.cout)],
                    p.valide_at && ['Validé le', fmtDateTime(p.valide_at)],
                  ]} />
                  {p.objectif_global && <p className="mt-3 text-sm"><b>Objectif global :</b> {p.objectif_global}</p>}
                </Card>
                <Card title="Coût programmé par trimestre" bodyClass="p-0">
                  <SimpleTable label="Coût programmé par trimestre" dense rowKey="t" columns={[{ key: 't', header: 'Trimestre' }, { key: 'v', header: 'Coût', align: 'right', render: (r) => cdf(r.v) }]}
                    rows={p.trimestres.map((v, i) => ({ t: `T${i + 1}`, v }))} footer={[{ t: 'Total', v: p.execution.cout }]} />
                  {p.statut === 'VALIDE' && <div className="space-y-2 p-4 text-sm"><div>Exécution physique <Progress value={p.execution.tauxPhysique} label="Exécution physique du PTBA" /></div><div>Exécution financière ({cdf(p.execution.decaisse)}) <Progress value={Math.round(p.execution.tauxFinancier)} label="Exécution financière du PTBA" /></div></div>}
                </Card>
                <div className="space-y-4 lg:col-span-3">
                  {groupes.map((g, gi) => (
                    <Card key={gi} title={g.titre ? `Objectif spécifique ${gi + 1} : ${g.titre}` : 'Activités'} bodyClass="p-0">
                      <SimpleTable label={g.titre || 'Activités'} columns={colonnes} rows={g.lignes}
                        footer={[{ id: 'total', pied: true, activite: 'Sous-total', cout: g.lignes.reduce((t, l) => t + (Number(l.cout) || 0), 0) }]} />
                    </Card>
                  ))}
                  {!groupes.length && <div className="card"><EmptyState title="Aucune activité">{a.modifier ? 'Utilisez « Modifier » pour saisir le PTBA, ou importez un classeur au format du Ministère depuis la liste.' : 'Le PTBA n’a pas encore été saisi par le Bureau Programme.'}</EmptyState></div>}
                </div>
                <Card title="Pièces justificatives"><Attachments type="PTBA" id={id} canUpload={a.modifier || a.suivre} /></Card>
                <Card title="Historique" className="lg:col-span-2"><Timeline items={p.historique} /></Card>
              </div>
            )}
            {suivi && <SuiviModal ligne={suivi} onClose={() => setSuivi(null)} onSaved={() => { setSuivi(null); state.reload(); }} />}
          </>
        );
      }}
    </Loadable>
  );
}
