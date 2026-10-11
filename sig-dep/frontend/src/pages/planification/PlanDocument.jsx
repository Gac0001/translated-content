import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, FileDown, Pencil, Send, Undo2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Field, Button, WorkflowPanel, ActionBar, runAction, toast, useConfirm } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { EditeurCbmt, VueCbmt } from './Cadrage';
import { fmtDateTime } from '../../lib/format';
import { circuitProgrammation } from '../../lib/workflows';

/** Parties rédigées de chaque document, dans l’ordre du modèle du ministère. */
const PARTIES = {
  PAP: [['missions', 'Missions du Ministère'], ['organisation', 'Organisation du Ministère'], ['performances_anterieures', 'Performances antérieures'], ['perspectives', 'Perspectives']],
  RAP: [['synthese', 'Synthèse'], ['difficultes', 'Difficultés rencontrées'], ['perspectives', 'Perspectives']],
  CDMT: [],
  CBMT: [],
};
const PARTIES_PROGRAMME = { PAP: [['perimetre', 'Périmètre du programme'], ['strategie', 'Stratégie du programme']], RAP: [['analyse', 'Analyse des résultats du programme']], CDMT: [], CBMT: [] };

function Editeur({ doc, programmes, onSaved, onCancel }) {
  const [initial] = useState(() => ({ programmes: {}, ...doc.contenu }));
  const [c, setC] = useState(initial);
  const [enCours, setEnCours] = useState(false);
  const up = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const upProg = (id, k) => (e) => setC({ ...c, programmes: { ...c.programmes, [id]: { ...(c.programmes[id] || {}), [k]: e.target.value } } });
  const enregistrer = async () => {
    setEnCours(true);
    try { await runAction(() => api.put(`/programmation/documents/${doc.id}`, { contenu: c }), 'Document enregistré.'); } finally { setEnCours(false); }
    onSaved();
  };
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
      <ActionBar dirty={JSON.stringify(c) !== JSON.stringify(initial)} saving={enCours} onSave={enregistrer} onCancel={onCancel} saveLabel="Enregistrer le document" />
    </div>
  );
}

const Texte = ({ t }) => (t ? <p className="whitespace-pre-line text-sm">{t}</p> : <p className="text-sm italic text-slate-500">Non rédigé.</p>);

function attente(d) {
  if (d.statut === 'VALIDE') return 'Document validé : il est intangible.';
  return {
    BROUILLON: 'En préparation au Bureau Programme.', A_CORRIGER: 'Retourné au Bureau Programme pour correction.',
    SOUMIS: 'En attente de vérification par le Chef du Bureau Programme.', VERIFIE: 'En attente de consolidation par le Chef de la Division Programme et Suivi.',
    CONSOLIDE: 'En attente de validation par le Directeur.',
  }[d.statut];
}

export default function PlanDocument() {
  const { id } = useParams();
  const state = useApi(`/programmation/documents/${id}`, [id]);
  const ref = useApi('/planification/referentiel');
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [edition, setEdition] = useState(false);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/programmation/documents/${id}/${path}`, body), msg); state.reload(); };
  const etape = async (path, msg, opts) => {
    let body = {};
    if (opts) {
      const r = await confirm(opts);
      if (!r) return;
      if (typeof r === 'string') body = { motif: r };
    }
    await post(path, body, msg).catch(() => {});
  };
  return (
    <Loadable state={state}>
      {(d) => {
        const a = d.actions;
        const c = d.contenu || {};
        const programmes = ref.data?.programmes.filter((p) => p.actif !== false) || [];
        const titre = d.type === 'CBMT' ? `CBMT ${d.annee}-${d.annee + 2}` : `${d.type} ${d.annee}`;
        return (
          <>
            <PageHeader title={titre} subtitle={`${d.libelle} · ${d.reference}`} breadcrumb={[{ label: 'Planification', to: `/planification?onglet=documents` }, { label: titre }]}
              actions={a.modifier && !edition && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} aria-hidden /> Rédiger</button>}
              menu={can('exports.generer') ? [{ label: ['CDMT', 'CBMT'].includes(d.type) ? 'Excel' : 'Word', icon: FileDown, onClick: () => download(`/programmation/documents/${id}/export`, `${d.type}-${d.annee}`).catch((e) => toast.error(errorMessage(e))) }] : []} />
            {!edition && (
              <WorkflowPanel circuit={circuitProgrammation(d)} attente={attente(d)}
                message={d.statut === 'A_CORRIGER' && <InfoAlert tone="warning"><b>À corriger</b> : {d.observations}</InfoAlert>}
                actions={[
                  a.soumettre && <Button key="so" variant="primary" icon={Send} onClick={() => etape('soumettre', 'Document soumis au Chef du Bureau Programme.')}>Soumettre</Button>,
                  a.verifier && <Button key="ve" variant="success" icon={CheckCircle2} onClick={() => etape('verifier', 'Document vérifié.')}>Vérifié</Button>,
                  a.consolider && <Button key="co" variant="success" icon={CheckCircle2} onClick={() => etape('consolider', 'Document consolidé : transmis au Directeur.')}>Consolider</Button>,
                  a.valider && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => etape('valider', 'Document validé.', { title: `Valider : ${titre}`, message: 'Une fois validé, le document devient intangible.', confirmLabel: 'Valider' })}>Valider</Button>,
                  a.retourner && <Button key="re" icon={Undo2} onClick={() => etape('retourner', 'Document retourné au Bureau Programme.', { title: 'Retourner pour correction', message: 'Le document sera renvoyé au Bureau Programme.', input: { label: 'Corrections demandées', required: true }, confirmLabel: 'Retourner', danger: true })}>Retourner</Button>,
                ]} />
            )}
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
          </>
        );
      }}
    </Loadable>
  );
}
