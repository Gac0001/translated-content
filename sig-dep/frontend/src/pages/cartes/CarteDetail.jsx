import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Printer, Send, Undo2, HandHelping, PauseCircle, PlayCircle, XCircle, SearchX, ExternalLink } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, InfoAlert, Modal, Field, runAction, toast } from '../../components/ui';
import PdfApercu from '../../components/PdfApercu';
import { ETATS_CARTE, MOTIFS_EMISSION } from './libelles';

function Motif({ titre, texte, libelle, danger, onClose, onValider }) {
  const [motif, setMotif] = useState('');
  return (
    <Modal open title={titre} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
      <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} disabled={motif.trim().length < 5} onClick={async () => { await onValider(motif); onClose(); }}>{libelle}</button>
    </>}>
      <p className="mb-3 text-sm text-slate-700">{texte}</p>
      <Field label="Motif" required><textarea className="input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
    </Modal>
  );
}

export default function CarteDetail() {
  const { id } = useParams();
  const state = useApi(`/cartes/${id}`, [id]);
  const can = useAuth((s) => s.can);
  const [modal, setModal] = useState(null);
  const [version, setVersion] = useState(0);
  const recharger = () => { state.reload(); setVersion((v) => v + 1); };
  const agir = async (action, message, body = {}) => { await runAction(() => api.post(`/cartes/${id}/${action}`, body), message); recharger(); };
  const imprimer = async () => {
    try { await download(`/cartes/${id}/pdf`, 'carte.pdf'); toast.success('Carte générée : imprimez en recto-verso.'); recharger(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Loadable state={state}>
      {(c) => {
        const preparer = can('cartes.preparer');
        const valider = can('cartes.valider');
        const st = c.statut;
        const d = c.donnees || c.dossier;
        return (
          <>
            <PageHeader title={`Carte de service — ${c.titulaire}`} breadcrumb={[{ label: 'Cartes de service', to: '/cartes' }, { label: c.numero || `Préparation n° ${c.id}` }]}
              subtitle={<span className="flex flex-wrap items-center gap-2"><Badge className={ETATS_CARTE[st][1]}>{ETATS_CARTE[st][0]}</Badge><Badge>{MOTIFS_EMISSION[c.motif_emission]}</Badge></span>}
              actions={(
                <div className="flex flex-wrap gap-2">
                  {preparer && ['BROUILLON', 'A_COMPLETER'].includes(st) && <button type="button" className="btn-primary" disabled={st === 'A_COMPLETER'} onClick={() => agir('verifier', 'Carte vérifiée : transmise au Directeur.')}><Send size={16} /> Vérifiée, transmettre</button>}
                  {valider && st === 'VERIFIEE' && <button type="button" className="btn-secondary" onClick={() => setModal('retourner')}><Undo2 size={16} /> Retourner</button>}
                  {valider && st === 'VERIFIEE' && <button type="button" className="btn-primary" onClick={() => agir('valider', 'Carte validée : numéro et QR code attribués.')}><CheckCircle2 size={16} /> Valider</button>}
                  {preparer && ['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(st) && <button type="button" className="btn-primary" onClick={imprimer}><Printer size={16} /> {c.nb_impressions ? 'Réimprimer' : 'Imprimer'}</button>}
                  {preparer && st === 'IMPRIMEE' && <button type="button" className="btn-secondary" onClick={() => agir('remettre', 'Remise enregistrée : le titulaire est invité à en accuser réception.')}><HandHelping size={16} /> Remise au titulaire</button>}
                  {valider && ['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(st) && <button type="button" className="btn-secondary" onClick={() => setModal('suspendre')}><PauseCircle size={16} /> Suspendre</button>}
                  {valider && st === 'SUSPENDUE' && <button type="button" className="btn-secondary" onClick={() => agir('reactiver', 'Carte réactivée.')}><PlayCircle size={16} /> Réactiver</button>}
                  {preparer && ['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'].includes(st) && <button type="button" className="btn-secondary" onClick={() => setModal('perdue')}><SearchX size={16} /> Déclarer perdue</button>}
                  {valider && !['ANNULEE', 'EXPIREE', 'PERDUE', 'REMPLACEE'].includes(st) && <button type="button" className="btn-danger" onClick={() => setModal('annuler')}><XCircle size={16} /> Annuler</button>}
                </div>
              )} />
            {modal === 'retourner' && <Motif titre="Retourner pour correction" texte="Indiquez la correction attendue du Secrétariat." libelle="Retourner" onClose={() => setModal(null)} onValider={(m) => agir('retourner', 'Carte retournée au Secrétariat.', { commentaire: m })} />}
            {modal === 'suspendre' && <Motif titre="Suspendre la carte" texte="La vérification publique indiquera « Carte suspendue » jusqu’à sa réactivation." libelle="Suspendre" danger onClose={() => setModal(null)} onValider={(m) => agir('suspendre', 'Carte suspendue.', { motif: m })} />}
            {modal === 'perdue' && <Motif titre="Déclarer la carte perdue" texte="La carte sera signalée « perdue ou volée — à retenir » lors de toute vérification. Préparez ensuite un remplacement." libelle="Déclarer perdue" danger onClose={() => setModal(null)} onValider={(m) => agir('perdue', 'Perte enregistrée.', { motif: m })} />}
            {modal === 'annuler' && <Motif titre="Annuler la carte" texte="L’annulation est définitive." libelle="Annuler la carte" danger onClose={() => setModal(null)} onValider={(m) => agir('annuler', 'Carte annulée.', { motif: m })} />}

            {c.anomalies?.length > 0 && <InfoAlert tone="warning"><b>Dossier à compléter :</b> {c.anomalies.join(' ')} <Link className="underline" to={`/personnel/${c.agent_id}`}>Ouvrir la fiche de l’agent</Link></InfoAlert>}
            {c.commentaire && st === 'BROUILLON' && <InfoAlert tone="warning"><b>Correction demandée par le Directeur :</b> {c.commentaire}</InfoAlert>}
            {c.motif && <InfoAlert tone="warning"><b>Motif :</b> {c.motif}</InfoAlert>}
            {!c.numero && <InfoAlert>Le numéro de la carte, son QR code et sa date d’expiration sont attribués à la validation par le Directeur ; jusque-là, l’aperçu porte la mention « Spécimen — non valide ».</InfoAlert>}

            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-2">
                <Card title={c.numero ? 'Renseignements figés sur la carte' : 'Renseignements du dossier'}>
                  <KeyValues cols={1} items={[
                    ['Matricule', d.matricule], ['Nom complet', d.nomComplet], ['Grade', d.grade || '—'], ['Fonction', d.fonction || '—'], ['Affectation', d.affectation || '—'],
                  ]} />
                </Card>
                <Card title="Suivi">
                  <KeyValues cols={1} items={[
                    c.numero && ['N° de carte', <span key="n" className="font-mono">{c.numero}</span>],
                    c.date_delivrance && ['Validité', `du ${fmtDate(c.date_delivrance)} au ${fmtDate(c.date_expiration)}`],
                    ['Préparée par', `${c.prepare_par_username || '—'} le ${fmtDateTime(c.created_at)}`],
                    c.valide_at && ['Validée par', `${c.valide_par_username} le ${fmtDateTime(c.valide_at)}`],
                    c.imprime_at && ['Impression', `${fmtDateTime(c.imprime_at)} (${c.nb_impressions} fois)`],
                    c.remise_at && ['Remise', fmtDateTime(c.remise_at)],
                    c.remise_at && ['Accusé de réception', c.accuse_at ? fmtDateTime(c.accuse_at) : 'en attente du titulaire'],
                  ]} />
                  {c.urlVerification && <a href={c.urlVerification} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-dep-700 hover:underline"><ExternalLink size={14} /> Page de vérification de cette carte</a>}
                </Card>
                {c.historiqueAgent?.length > 0 && (
                  <Card title="Cartes précédentes de l’agent">
                    <ul className="space-y-1 text-sm">{c.historiqueAgent.map((h) => <li key={h.id}><Link className="text-dep-700 hover:underline" to={`/cartes/${h.id}`}>{h.numero}</Link> — {ETATS_CARTE[h.statut][0]} ({fmtDate(h.date_delivrance)} → {fmtDate(h.date_expiration)})</li>)}</ul>
                  </Card>
                )}
              </div>
              <Card title="Aperçu recto-verso" className="lg:col-span-3">
                <PdfApercu key={version} url={`/cartes/${id}/apercu`} titre="Aperçu de la carte" hauteur={560} />
              </Card>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
