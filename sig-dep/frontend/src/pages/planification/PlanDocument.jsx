import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileDown, Pencil, Save, Send, Undo2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Field, runAction, toast } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { EditeurCbmt, VueCbmt } from './Cadrage';
import { fmtDateTime } from '../../lib/format';
import { TextModal } from '../instructions/WorkflowActions';

/** Parties rédigées de chaque document, dans l’ordre du modèle du ministère. */
const PARTIES = {
  PAP: [['missions', 'Missions du Ministère'], ['organisation', 'Organisation du Ministère'], ['performances_anterieures', 'Performances antérieures'], ['perspectives', 'Perspectives']],
  RAP: [['synthese', 'Synthèse'], ['difficultes', 'Difficultés rencontrées'], ['perspectives', 'Perspectives']],
  CDMT: [],
  CBMT: [],
};
const PARTIES_PROGRAMME = { PAP: [['perimetre', 'Périmètre du programme'], ['strategie', 'Stratégie du programme']], RAP: [['analyse', 'Analyse des résultats du programme']], CDMT: [], CBMT: [] };

function Editeur({ doc, programmes, onSaved, onCancel }) {
  const [c, setC] = useState({ programmes: {}, ...doc.contenu });
  const up = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const upProg = (id, k) => (e) => setC({ ...c, programmes: { ...c.programmes, [id]: { ...(c.programmes[id] || {}), [k]: e.target.value } } });
  const enregistrer = async () => { await runAction(() => api.put(`/programmation/documents/${doc.id}`, { contenu: c }), 'Document enregistré.'); onSaved(); };
  return (
    <div className="space-y-4">
      <Card title="Page de garde">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ministère"><input className="input" value={c.ministere || ''} placeholder="ÉCONOMIE NUMÉRIQUE" onChange={up('ministere')} /></Field>
          <Field label="Section budgétaire"><input className="input" value={c.section || ''} onChange={up('section')} /></Field>
          <Field label="Responsable"><input className="input" value={c.responsable || ''} onChange={up('responsable')} /></Field>
        </div>
      </Card>
      {PARTIES[doc.type].length > 0 && (
        <Card title="Parties rédigées">
          <div className="grid gap-3">{PARTIES[doc.type].map(([k, l]) => <Field key={k} label={l}><textarea className="input" rows={5} value={c[k] || ''} onChange={up(k)} /></Field>)}</div>
        </Card>
      )}
      {PARTIES_PROGRAMME[doc.type].length > 0 && programmes.map((p) => (
        <Card key={p.id} title={`Programme ${p.code} : ${p.libelle}`}>
          <div className="grid gap-3">{PARTIES_PROGRAMME[doc.type].map(([k, l]) => <Field key={k} label={l}><textarea className="input" rows={4} value={c.programmes[p.id]?.[k] || ''} onChange={upProg(p.id, k)} /></Field>)}</div>
        </Card>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={enregistrer}><Save size={16} /> Enregistrer</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

const Texte = ({ t }) => (t ? <p className="whitespace-pre-line text-sm">{t}</p> : <p className="text-sm italic text-slate-400">Non rédigé.</p>);

export default function PlanDocument() {
  const { id } = useParams();
  const state = useApi(`/programmation/documents/${id}`, [id]);
  const ref = useApi('/planification/referentiel');
  const can = useAuth((s) => s.can);
  const [edition, setEdition] = useState(false);
  const [retour, setRetour] = useState(false);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/programmation/documents/${id}/${path}`, body), msg); setRetour(false); state.reload(); };
  return (
    <Loadable state={state}>
      {(d) => {
        const a = d.actions;
        const c = d.contenu || {};
        const programmes = ref.data?.programmes.filter((p) => p.actif !== false) || [];
        return (
          <>
            <PageHeader title={d.type === 'CBMT' ? `CBMT ${d.annee}-${d.annee + 2}` : `${d.type} ${d.annee}`} subtitle={`${d.libelle} · ${d.reference}`} breadcrumb={[{ label: 'Planification', to: '/planification' }, { label: d.type === 'CBMT' ? `CBMT ${d.annee}-${d.annee + 2}` : `${d.type} ${d.annee}` }]}
              actions={<>
                {can('exports.generer') && <button type="button" className="btn-secondary" onClick={() => download(`/programmation/documents/${id}/export`, `${d.type}-${d.annee}`).catch((e) => toast.error(errorMessage(e)))}><FileDown size={16} /> {['CDMT', 'CBMT'].includes(d.type) ? 'Excel' : 'Word'}</button>}
                {a.modifier && !edition && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} /> Rédiger</button>}
                {a.soumettre && !edition && <button type="button" className="btn-primary" onClick={() => post('soumettre', {}, 'Document soumis au Chef du Bureau Programme.')}><Send size={16} /> Soumettre</button>}
                {a.verifier && <button type="button" className="btn-success" onClick={() => post('verifier', {}, 'Document vérifié.')}><CheckCircle2 size={16} /> Vérifié</button>}
                {a.consolider && <button type="button" className="btn-success" onClick={() => post('consolider', {}, 'Document consolidé : transmis au Directeur.')}><CheckCircle2 size={16} /> Consolider</button>}
                {a.valider && <button type="button" className="btn-success" onClick={() => post('valider', {}, 'Document validé.')}><CheckCircle2 size={16} /> Valider</button>}
                {a.retourner && <button type="button" className="btn-secondary" onClick={() => setRetour(true)}><Undo2 size={16} /> Retourner</button>}
              </>} />
            {d.statut === 'A_CORRIGER' && <div className="mb-3"><InfoAlert tone="warning"><b>À corriger</b> : {d.observations}</InfoAlert></div>}
            {edition && ref.data && d.type === 'CBMT' && <EditeurCbmt doc={d} programmes={programmes} onCancel={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} />}
            {!edition && d.type === 'CBMT' && (
              <div className="space-y-4">
                <VueCbmt doc={d} programmes={programmes} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title="Pièces (document du Ministère du Budget, lettre de cadrage)"><Attachments type="PLAN_DOCUMENT" id={d.id} canUpload={a.modifier} /></Card>
                  <Card title="Historique"><Timeline items={d.historique} /></Card>
                </div>
              </div>
            )}
            {d.type !== 'CBMT' && (edition && ref.data ? <Editeur doc={d} programmes={programmes} onCancel={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} /> : (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Document" className="lg:col-span-2">
                  <KeyValues items={[
                    ['Statut', <StatusBadge key="s" value={d.statut} />], ['Exercice', d.annee], ['Ministère', c.ministere || 'ÉCONOMIE NUMÉRIQUE'], ['Section', c.section || '—'],
                    ['Responsable', c.responsable || '—'], d.valide_at && ['Validé le', fmtDateTime(d.valide_at)],
                  ]} />
                  <p className="mt-3 text-xs text-slate-500">
                    {d.type === 'CDMT'
                      ? `Le classeur reprend, par programme et rubrique, les crédits votés ${d.annee - 1}, la prévision ${d.annee} et les projections ${d.annee + 1} à ${d.annee + 3} saisis dans l’onglet Crédits.`
                      : 'Les tableaux (cadre de performance, crédits par programme, rubrique, titre et action) sont générés à partir des onglets Performance et Crédits au moment de l’export.'}
                  </p>
                </Card>
                <Card title="Historique"><Timeline items={d.historique} /></Card>
                {PARTIES[d.type].map(([k, l]) => <Card key={k} title={l} className="lg:col-span-3"><Texte t={c[k]} /></Card>)}
                {PARTIES_PROGRAMME[d.type].length > 0 && programmes.map((p) => (
                  <Card key={p.id} title={`Programme ${p.code} : ${p.libelle}`} className="lg:col-span-3">
                    <div className="space-y-3">{PARTIES_PROGRAMME[d.type].map(([k, l]) => <div key={k}><div className="mb-1 text-xs font-semibold uppercase text-slate-500">{l}</div><Texte t={c.programmes?.[p.id]?.[k]} /></div>)}</div>
                  </Card>
                ))}
                <Card title="Pièces jointes" className="lg:col-span-3"><Attachments type="PLAN_DOCUMENT" id={d.id} canUpload={a.modifier} /></Card>
              </div>
            ))}
            {retour && <TextModal title="Retourner pour correction" label="Corrections demandées" confirmLabel="Retourner" onClose={() => setRetour(false)} onSave={(t) => post('retourner', { motif: t }, 'Document retourné au Bureau Programme.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
