import { CheckCircle2, IdCard, SearchX } from 'lucide-react';
import api from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, KeyValues, Badge, InfoAlert, EmptyState, runAction, useConfirm } from '../../components/ui';
import PdfApercu from '../../components/PdfApercu';
import { ETATS_CARTE } from './libelles';

/** Carte de service de l’agent connecté : état, accusé de réception, déclaration de perte. */
export default function MaCarte() {
  const state = useApi('/cartes/mienne');
  const confirm = useConfirm();
  return (
    <>
      <PageHeader title="Ma carte de service" breadcrumb={[{ label: 'Mon espace' }, { label: 'Ma carte de service' }]} />
      <Loadable state={state}>
        {(d) => {
          const c = d.data[0];
          if (!c) return <div className="card"><EmptyState icon={IdCard} title="Aucune carte délivrée">Votre carte de service est préparée par le Bureau Secrétariat de Direction et validée par le Directeur ; elle apparaîtra ici dès sa validation.</EmptyState></div>;
          const declarerPerte = async () => {
            const motif = await confirm({ title: 'Déclarer la perte ou le vol de ma carte', message: 'La carte sera immédiatement signalée « perdue ou volée — à retenir » lors de toute vérification.', input: { label: 'Circonstances', required: true, min: 5 }, confirmLabel: 'Déclarer', danger: true });
            if (!motif) return;
            await runAction(() => api.post(`/cartes/${c.id}/perdue`, { motif }), 'Perte déclarée : le Secrétariat préparera une nouvelle carte.').catch(() => null);
            state.reload();
          };
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
                    {c.statut === 'REMISE' && !c.accuse_at && <button type="button" className="btn-primary" onClick={async () => { await runAction(() => api.post('/cartes/mienne/accuser'), 'Réception confirmée.').catch(() => null); state.reload(); }}><CheckCircle2 size={16} aria-hidden /> J’ai reçu ma carte</button>}
                    {['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'].includes(c.statut) && <button type="button" className="btn-secondary text-red-700" onClick={declarerPerte}><SearchX size={16} aria-hidden /> Déclarer la perte ou le vol</button>}
                  </div>
                </Card>
                <InfoAlert>Toute personne peut vérifier votre carte en scannant son QR code ou en saisissant votre matricule : elle voit votre photo, votre nom, votre grade, votre fonction et votre affectation.</InfoAlert>
              </div>
              <Card title="Aperçu" className="lg:col-span-3"><PdfApercu url={`/cartes/${c.id}/apercu`} hauteur={520} /></Card>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
