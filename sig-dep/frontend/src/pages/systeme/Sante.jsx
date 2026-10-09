import { useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle, RefreshCw, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, runAction, Badge, KeyValues } from '../../components/ui';

/** Présentation des états de santé (icône + texte : jamais la couleur seule). */
export const ETATS = {
  OK: { label: 'Opérationnel', icon: CheckCircle2, cls: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200', bar: 'bg-emerald-500' },
  ATTENTION: { label: 'À surveiller', icon: AlertTriangle, cls: 'text-amber-600', badge: 'bg-amber-50 text-amber-800 ring-amber-200', bar: 'bg-amber-400' },
  PANNE: { label: 'En panne', icon: XCircle, cls: 'text-red-700', badge: 'bg-red-50 text-red-800 ring-red-200', bar: 'bg-red-600' },
  INACTIF: { label: 'Inactif', icon: MinusCircle, cls: 'text-slate-400', badge: 'bg-slate-100 text-slate-600 ring-slate-200', bar: 'bg-slate-300' },
};

export function EtatBadge({ statut }) {
  const e = ETATS[statut] || ETATS.INACTIF;
  return <Badge className={e.badge}><e.icon size={12} /> {e.label}</Badge>;
}

const ORDRE = ['api', 'postgresql', 'stockage', 'sauvegarde', 'courriels', 'documents'];

export default function Sante() {
  const state = useApi('/supervision/sante');
  const [busy, setBusy] = useState(false);
  const verifier = async () => {
    setBusy(true);
    try { await runAction(() => api.post('/supervision/sante/verifier'), 'Contrôle terminé.'); state.reload(); } catch { /* affiché */ } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Santé du système" subtitle="Contrôle automatique toutes les 15 minutes ; une alerte est émise à chaque panne et à chaque rétablissement."
        breadcrumb={[{ label: 'Sécurité et système' }, { label: 'Santé du système' }]}
        actions={<button type="button" className="btn-primary" disabled={busy} onClick={verifier}><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> {busy ? 'Vérification…' : 'Vérifier maintenant'}</button>} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            {!d.dernier ? <Card><p className="text-sm text-slate-600">Aucun contrôle encore réalisé : cliquez sur « Vérifier maintenant ».</p></Card> : (
              <>
                <div className={`flex flex-wrap items-center gap-3 rounded-md border p-4 ${ETATS[d.dernier.global].badge}`}>
                  {(() => { const E = ETATS[d.dernier.global]; return <E.icon size={26} />; })()}
                  <div className="flex-1">
                    <div className="text-lg font-semibold">{d.dernier.global === 'OK' ? 'Tous les services sont opérationnels' : d.dernier.global === 'PANNE' ? 'Au moins un service est en panne' : 'Au moins un service est à surveiller'}</div>
                    <div className="text-sm">Dernière vérification : {fmtDateTime(d.dernier.verifieAt)} ({d.dernier.origine === 'AUTO' ? 'automatique' : 'manuelle'}, {d.dernier.dureeMs} ms)</div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {ORDRE.map((k) => {
                    const c = d.dernier.composants[k]; if (!c) return null;
                    const E = ETATS[c.statut] || ETATS.INACTIF;
                    return (
                      <div key={k} className="card p-4">
                        <div className="flex items-center gap-2"><E.icon size={20} className={E.cls} /><span className="font-semibold">{c.libelle}</span><span className="ml-auto"><EtatBadge statut={c.statut} /></span></div>
                        <p className="mt-2 text-sm text-slate-600">{c.detail}</p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <Card title="Historique des 48 dernières heures" bodyClass="p-4">
              {d.historique.length ? (
                <div className="space-y-2" role="table" aria-label="Historique des contrôles de santé">
                  {ORDRE.map((k) => (
                    <div key={k} className="flex items-center gap-3" role="row">
                      <span className="w-24 shrink-0 text-xs text-slate-600" role="rowheader">{d.libelles[k]}</span>
                      <div className="flex h-5 flex-1 flex-row-reverse gap-px overflow-hidden rounded">
                        {d.historique.map((h) => {
                          const st = h.statuts[k] || 'INACTIF';
                          return <span key={h.id} role="cell" className={`min-w-[3px] flex-1 ${ETATS[st].bar}`} title={`${fmtDateTime(h.date)} — ${ETATS[st].label}`} aria-label={`${fmtDateTime(h.date)} : ${ETATS[st].label}`} />;
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between pl-28 text-[11px] text-slate-400"><span>{fmtDateTime(d.historique[d.historique.length - 1].date)}</span><span>maintenant</span></div>
                  <div className="flex flex-wrap gap-3 pl-28 text-xs text-slate-600">{Object.entries(ETATS).map(([k, e]) => <span key={k} className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${e.bar}`} /> {e.label}</span>)}</div>
                </div>
              ) : <p className="text-sm text-slate-500">Aucun contrôle sur la période.</p>}
            </Card>
            <Card title="Version de l’application">
              <KeyValues cols={3} items={[['Version', d.version.version], ['Révision', d.version.commit], ['Node.js', d.version.node], ['Environnement', d.version.environnement]]} />
            </Card>
          </div>
        )}
      </Loadable>
    </>
  );
}
