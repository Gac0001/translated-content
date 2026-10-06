import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, CheckCircle2, Rocket } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, Badge, Modal, Field, InfoAlert, runAction } from '../../components/ui';
import { Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { TextModal } from '../instructions/WorkflowActions';

const MODES = {
  TACHE: ['Attribuer comme tâche', 'Une tâche sera attribuée au responsable, Agent de votre Bureau.'],
  INSTRUCTION: ['Adresser une instruction', 'Une instruction sera adressée au responsable, votre subordonné direct.'],
  INSTRUCTION_EXCEPTIONNELLE: ['Adresser une instruction exceptionnelle', 'Le responsable ne relève pas directement de vous : une instruction exceptionnelle lui sera adressée, avec copie à son supérieur immédiat. La justification mentionne la décision.'],
};

function MiseEnOeuvre({ decision, onClose, onDone }) {
  const [f, setF] = useState({ priorite: 'NORMALE', echeance: decision.echeance && decision.echeance >= new Date().toISOString().slice(0, 10) ? decision.echeance : '', contenu: '' });
  const [titre, texte] = MODES[decision.actions.transformer];
  const go = async () => {
    const r = await runAction(() => api.post(`/decisions/${decision.id}/transformer`, { priorite: f.priorite, echeance: f.echeance || null, contenu: f.contenu || undefined }), 'Décision mise en œuvre.');
    onDone(r.data);
  };
  return (
    <Modal open title={titre} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={go}><Rocket size={16} /> Mettre en œuvre</button></>}>
      <p className="mb-3 text-sm text-slate-600">{texte}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Priorité"><select className="input" value={f.priorite} onChange={(e) => setF({ ...f, priorite: e.target.value })}><option value="BASSE">Basse</option><option value="NORMALE">Normale</option><option value="HAUTE">Haute</option><option value="URGENTE">Urgente</option></select></Field>
        <Field label="Échéance"><input type="date" className="input" min={new Date().toISOString().slice(0, 10)} value={f.echeance} onChange={(e) => setF({ ...f, echeance: e.target.value })} /></Field>
        <Field label="Consignes" className="sm:col-span-2" hint="Facultatif : par défaut, les précisions et le résultat attendu de la décision."><textarea className="input" rows={4} value={f.contenu} onChange={(e) => setF({ ...f, contenu: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function DecisionDetail() {
  const { id } = useParams();
  const state = useApi(`/decisions/${id}`, [id]);
  const navigate = useNavigate();
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/decisions/${id}/${path}`, body), msg); setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(d) => (
        <>
          <PageHeader title={d.libelle} subtitle={`${d.reference} · ${d.origine === 'REUNION' ? `réunion ${d.reunion_reference}` : 'décision du Directeur'}`} breadcrumb={[{ label: 'Décisions', to: '/decisions' }, { label: d.reference }]}
            actions={<>
              {d.actions.transformer && <button type="button" className="btn-primary" onClick={() => setModal('transformer')}><Rocket size={16} /> {MODES[d.actions.transformer][0]}</button>}
              {d.actions.rendreCompte && <button type="button" className="btn-success" onClick={() => setModal('cr')}><CheckCircle2 size={16} /> Déclarer exécutée</button>}
              {d.actions.abandonner && <button type="button" className="btn-secondary text-red-700" onClick={() => setModal('abandon')}><Ban size={16} /> Abandonner</button>}
            </>} />
          {d.en_retard && <div className="mb-3"><InfoAlert tone="warning">Échéance dépassée le {fmtDate(d.echeance)}.</InfoAlert></div>}
          {d.statut === 'ABANDONNEE' && <div className="mb-3"><InfoAlert tone="warning"><b>Décision abandonnée</b> : {d.motif_abandon}</InfoAlert></div>}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Décision" className="lg:col-span-2">
              <KeyValues items={[
                ['Statut', <span key="s" className="flex gap-1"><StatusBadge value={d.statut} />{d.en_retard && <Badge className="bg-red-50 text-red-800 ring-red-200">En retard</Badge>}</span>],
                ['Origine', d.origine === 'REUNION' ? <Link key="r" className="text-dep-700 hover:underline" to={`/reunions/${d.reunion_id}`}>Réunion {d.reunion_reference} — {d.reunion_objet}</Link> : 'Décision du Directeur'],
                ['Décideur', d.decideur_nom], ['Responsable', d.responsable_nom], ['Échéance', fmtDate(d.echeance)], ['Décidée le', fmtDateTime(d.decidee_at)],
                d.instruction_id && ['Instruction', <Link key="i" className="text-dep-700 hover:underline" to={`/instructions/${d.instruction_id}`}>{d.instruction_reference}</Link>],
                d.task_id && ['Tâche', <Link key="t" className="text-dep-700 hover:underline" to={`/taches/${d.task_id}`}>{d.task_reference}</Link>],
                d.executee_at && ['Exécutée le', fmtDateTime(d.executee_at)],
              ]} />
              {d.description && <p className="mt-4 whitespace-pre-line text-sm">{d.description}</p>}
              {d.resultat_attendu && <p className="mt-3 text-sm"><b>Résultat attendu :</b> {d.resultat_attendu}</p>}
            </Card>
            <Card title="Résultat">{d.resultat ? <p className="whitespace-pre-line text-sm">{d.resultat}</p> : <p className="text-sm text-slate-500">{d.instruction_id || d.task_id ? 'Suivi automatique : la décision sera déclarée exécutée à la validation de l’instruction ou de la tâche.' : 'En attente.'}</p>}</Card>
            <Card title="Historique" className="lg:col-span-3"><Timeline items={d.historique} /></Card>
          </div>
          {modal === 'transformer' && <MiseEnOeuvre decision={d} onClose={() => setModal(null)} onDone={(l) => navigate(l.type === 'TACHE' ? `/taches/${l.id}` : `/instructions/${l.id}`)} />}
          {modal === 'cr' && <TextModal title="Déclarer la décision exécutée" label="Résultat obtenu" confirmLabel="Enregistrer" onClose={() => setModal(null)} onSave={(t) => post('rendre-compte', { resultat: t }, 'Décision exécutée.')} />}
          {modal === 'abandon' && <TextModal title="Abandonner la décision" label="Motif" confirmLabel="Abandonner" danger onClose={() => setModal(null)} onSave={(t) => post('abandonner', { motif: t }, 'Décision abandonnée.')} />}
        </>
      )}
    </Loadable>
  );
}
