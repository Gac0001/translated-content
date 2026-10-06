import { useState } from 'react';
import { CheckCircle2, SearchX } from 'lucide-react';
import api from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, InfoAlert, Modal, Field, runAction } from '../../components/ui';
import PdfApercu from '../../components/PdfApercu';
import { ETATS_CARTE } from './libelles';

/** Carte de service de l’agent connecté : état, accusé de réception, déclaration de perte. */
export default function MaCarte() {
  const state = useApi('/cartes/mienne');
  const [perte, setPerte] = useState(false);
  const [motif, setMotif] = useState('');
  return (
    <>
      <PageHeader title="Ma carte de service" breadcrumb={[{ label: 'Mon espace' }, { label: 'Ma carte de service' }]} />
      <Loadable state={state}>
        {(d) => {
          const c = d.data[0];
          if (!c) return <InfoAlert>Aucune carte de service ne vous a encore été délivrée. Elle est préparée par le Bureau Secrétariat de Direction et validée par le Directeur.</InfoAlert>;
          return (
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-2">
                <Card title="Ma carte">
                  <KeyValues cols={1} items={[
                    ['N°', <span key="n" className="font-mono">{c.numero}</span>],
                    ['État', <Badge key="e" className={ETATS_CARTE[c.statut][1]}>{ETATS_CARTE[c.statut][0]}</Badge>],
                    ['Validité', `du ${fmtDate(c.date_delivrance)} au ${fmtDate(c.date_expiration)}`],
                    c.remise_at && ['Remise', fmtDateTime(c.remise_at)],
                    c.remise_at && ['Accusé de réception', c.accuse_at ? fmtDateTime(c.accuse_at) : 'à confirmer'],
                  ]} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {c.statut === 'REMISE' && !c.accuse_at && <button type="button" className="btn-primary" onClick={async () => { await runAction(() => api.post('/cartes/mienne/accuser'), 'Réception confirmée.'); state.reload(); }}><CheckCircle2 size={16} /> J’ai reçu ma carte</button>}
                    {['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'].includes(c.statut) && <button type="button" className="btn-secondary text-red-700" onClick={() => setPerte(true)}><SearchX size={16} /> Déclarer la perte ou le vol</button>}
                  </div>
                </Card>
                <InfoAlert>Toute personne peut vérifier votre carte en scannant son QR code ou en saisissant votre matricule : elle voit votre photo, votre nom, votre grade, votre fonction et votre affectation.</InfoAlert>
              </div>
              <Card title="Aperçu" className="lg:col-span-3"><PdfApercu url={`/cartes/${c.id}/apercu`} hauteur={520} /></Card>
              {perte && (
                <Modal open title="Déclarer la perte ou le vol de ma carte" onClose={() => setPerte(false)} footer={<>
                  <button type="button" className="btn-secondary" onClick={() => setPerte(false)}>Annuler</button>
                  <button type="button" className="btn-danger" disabled={motif.trim().length < 5} onClick={async () => { await runAction(() => api.post(`/cartes/${c.id}/perdue`, { motif }), 'Perte déclarée : le Secrétariat préparera une nouvelle carte.'); setPerte(false); state.reload(); }}>Déclarer</button>
                </>}>
                  <p className="mb-3 text-sm">La carte sera immédiatement signalée « perdue ou volée — à retenir » lors de toute vérification.</p>
                  <Field label="Circonstances" required><textarea className="input" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
                </Modal>
              )}
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
