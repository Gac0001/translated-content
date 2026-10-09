import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Printer, Send, Undo2, HandHelping, PauseCircle, PlayCircle, XCircle, SearchX, ExternalLink } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, InfoAlert, Button, WorkflowPanel, runAction, toast, useConfirm } from '../../components/ui';
import PdfApercu from '../../components/PdfApercu';
import { circuitCarte } from '../../lib/workflows';
import { ETATS_CARTE, MOTIFS_EMISSION } from './libelles';

export default function CarteDetail() {
  const { id } = useParams();
  const state = useApi(`/cartes/${id}`, [id]);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const recharger = () => { state.reload(); setVersion((v) => v + 1); };
  const agir = async (action, message, body = {}) => { await runAction(() => api.post(`/cartes/${id}/${action}`, body), message).catch(() => null); recharger(); };
  /** Action motivée : motif obligatoire (5 caractères au moins), transmis sous la clé attendue par l’API. */
  const motive = async (titre, texte, libelle, action, message, cle = 'motif', danger = true) => {
    const t = await confirm({ title: titre, message: texte, confirmLabel: libelle, danger, input: { label: cle === 'commentaire' ? 'Correction attendue' : 'Motif', required: true, min: 5 } });
    if (t) agir(action, message, { [cle]: t });
  };
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
              menu={[
                valider && ['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(st) && { label: 'Suspendre la carte', icon: PauseCircle, onClick: () => motive('Suspendre la carte', 'La vérification publique indiquera « Carte suspendue » jusqu’à sa réactivation.', 'Suspendre', 'suspendre', 'Carte suspendue.') },
                preparer && ['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'].includes(st) && { label: 'Déclarer perdue ou volée', icon: SearchX, danger: true, onClick: () => motive('Déclarer la carte perdue', 'La carte sera signalée « perdue ou volée — à retenir » lors de toute vérification. Préparez ensuite un remplacement.', 'Déclarer perdue', 'perdue', 'Perte enregistrée.') },
                valider && !['ANNULEE', 'EXPIREE', 'PERDUE', 'REMPLACEE'].includes(st) && { label: 'Annuler la carte', icon: XCircle, danger: true, onClick: () => motive('Annuler la carte', 'L’annulation est définitive.', 'Annuler la carte', 'annuler', 'Carte annulée.') },
              ]} />
            <WorkflowPanel circuit={circuitCarte(c)}
              attente={{
                BROUILLON: 'En préparation au Bureau Secrétariat de Direction : vérifiez le dossier puis transmettez au Directeur.', A_COMPLETER: 'Dossier à compléter avant transmission.',
                VERIFIEE: 'En attente de la validation du Directeur.', VALIDEE: 'Carte validée : à imprimer en recto-verso.', IMPRIMEE: 'Carte imprimée : à remettre au titulaire.',
                REMISE: c.accuse_at ? 'Carte en circulation ; réception confirmée par le titulaire.' : 'Carte remise : le titulaire est invité à en accuser réception.',
                SUSPENDUE: 'Carte suspendue : la vérification publique l’indique jusqu’à sa réactivation.', PERDUE: 'Carte signalée perdue ou volée : préparez un remplacement.',
                ANNULEE: 'Carte annulée.', EXPIREE: 'Validité échue : préparez un renouvellement.', REMPLACEE: 'Carte remplacée par une nouvelle carte.',
              }[st]}
              message={(c.anomalies?.length > 0 || (c.commentaire && st === 'BROUILLON') || c.motif || !c.numero) && (
                <div className="space-y-2">
                  {c.anomalies?.length > 0 && <InfoAlert tone="warning"><b>Dossier à compléter :</b> {c.anomalies.join(' ')} <Link className="underline" to={`/personnel/${c.agent_id}`}>Ouvrir la fiche de l’agent</Link></InfoAlert>}
                  {c.commentaire && st === 'BROUILLON' && <InfoAlert tone="warning"><b>Correction demandée par le Directeur :</b> {c.commentaire}</InfoAlert>}
                  {c.motif && <InfoAlert tone="warning"><b>Motif :</b> {c.motif}</InfoAlert>}
                  {!c.numero && <InfoAlert>Le numéro de la carte, son QR code et sa date d’expiration sont attribués à la validation par le Directeur ; jusque-là, l’aperçu porte la mention « Spécimen — non valide ».</InfoAlert>}
                </div>
              )}
              actions={[
                preparer && ['BROUILLON', 'A_COMPLETER'].includes(st) && <Button key="ve" variant="primary" icon={Send} disabled={st === 'A_COMPLETER'} title={st === 'A_COMPLETER' ? 'Complétez d’abord le dossier de l’agent' : undefined} onClick={() => agir('verifier', 'Carte vérifiée : transmise au Directeur.')}>Vérifiée, transmettre</Button>,
                valider && st === 'VERIFIEE' && <Button key="va" variant="success" icon={CheckCircle2} onClick={async () => { if (await confirm({ title: 'Valider la carte', message: 'Le numéro, le QR code et la date d’expiration seront attribués ; les renseignements imprimés seront figés.', confirmLabel: 'Valider' })) agir('valider', 'Carte validée : numéro et QR code attribués.'); }}>Valider</Button>,
                valider && st === 'VERIFIEE' && <Button key="re" icon={Undo2} onClick={() => motive('Retourner pour correction', 'Indiquez la correction attendue du Secrétariat.', 'Retourner', 'retourner', 'Carte retournée au Secrétariat.', 'commentaire', false)}>Retourner</Button>,
                preparer && ['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(st) && <Button key="im" variant={st === 'VALIDEE' ? 'primary' : 'secondary'} icon={Printer} onClick={imprimer}>{c.nb_impressions ? 'Réimprimer' : 'Imprimer'}</Button>,
                preparer && st === 'IMPRIMEE' && <Button key="rm" variant="primary" icon={HandHelping} onClick={() => agir('remettre', 'Remise enregistrée : le titulaire est invité à en accuser réception.')}>Remise au titulaire</Button>,
                valider && st === 'SUSPENDUE' && <Button key="ra" variant="primary" icon={PlayCircle} onClick={() => agir('reactiver', 'Carte réactivée.')}>Réactiver</Button>,
              ]} />

            <div className="grid gap-4 lg:grid-cols-5">
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
                  {c.urlVerification && <a href={c.urlVerification} target="_blank" rel="noreferrer" className="link mt-3 inline-flex items-center gap-1 text-sm"><ExternalLink size={14} aria-hidden /> Page de vérification de cette carte<span className="sr-only"> (nouvel onglet)</span></a>}
                </Card>
                {c.historiqueAgent?.length > 0 && (
                  <Card title="Cartes précédentes de l’agent">
                    <ul className="space-y-1 text-sm">{c.historiqueAgent.map((h) => <li key={h.id}><Link className="link" to={`/cartes/${h.id}`}>{h.numero}</Link> — {ETATS_CARTE[h.statut][0]} ({fmtDate(h.date_delivrance)} → {fmtDate(h.date_expiration)})</li>)}</ul>
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
