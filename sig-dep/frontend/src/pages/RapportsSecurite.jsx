import { useState } from 'react';
import { FileDown, FilePlus2 } from 'lucide-react';
import api, { download, errorMessage } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useApi, Loadable, PageHeader, DataTable, Badge, Card, runAction, toast, InfoAlert } from '../components/ui';

/** Rapports mensuels de sécurité : Admin Système et Directeur. */
export default function RapportsSecurite() {
  const state = useApi('/supervision/rapports');
  const [periode, setPeriode] = useState('');
  const pdf = (p) => download(`/supervision/rapports/${p}/pdf`, `rapport-securite-${p}.pdf`).catch((e) => toast.error(errorMessage(e)));
  const generer = async () => {
    const r = await runAction(() => api.post('/supervision/rapports', { periode: periode || state.data.moisPrecedent }));
    toast.success(r.data.message);
    state.reload();
  };
  return (
    <>
      <PageHeader title="Rapports de sécurité" subtitle="Rapport mensuel produit automatiquement au début de chaque mois et adressé à l’Admin Système et au Directeur."
        breadcrumb={[{ label: 'Rapports de sécurité' }]} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            {d.peutGenerer && (
              <Card title="Produire un rapport">
                <div className="flex flex-wrap items-end gap-3">
                  <div><label className="label" htmlFor="periode">Mois</label><input id="periode" type="month" className="input" value={periode || d.moisPrecedent} onChange={(e) => setPeriode(e.target.value)} /></div>
                  <button type="button" className="btn-primary" onClick={generer}><FilePlus2 size={16} /> Générer</button>
                  <p className="text-xs text-slate-500">Un rapport déjà produit est recalculé et remplacé. Le mois en cours donne des données partielles.</p>
                </div>
              </Card>
            )}
            {!d.data.length && <InfoAlert>Aucun rapport pour le moment : le premier sera produit automatiquement au début du mois prochain.</InfoAlert>}
            <DataTable rows={d.data} rowKey="periode" searchable={false} empty="Aucun rapport."
              columns={[
                { key: 'libelle', header: 'Période', render: (r) => <span className="font-medium capitalize">{r.libelle}</span> },
                { key: 'critiques', header: 'Incidents critiques', render: (r) => <Badge className={r.resume.critiques ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-emerald-50 text-emerald-800 ring-emerald-200'}>{r.resume.critiques}</Badge> },
                { key: 'connexions', header: 'Connexions (réussies / échecs)', render: (r) => `${r.resume.reussies} / ${r.resume.echecs}` },
                { key: 'sauvegardes', header: 'Sauvegardes échouées', render: (r) => r.resume.sauvegardesEchouees },
                { key: 'audit', header: 'Journal d’audit', render: (r) => (r.resume.integre ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Intègre</Badge> : <Badge className="bg-red-50 text-red-800 ring-red-200">Altéré</Badge>) },
                { key: 'genere_at', header: 'Produit le', render: (r) => <span className="text-xs">{fmtDateTime(r.genere_at)} — {r.genere_par}</span> },
                { key: 'pdf', header: '', render: (r) => <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => pdf(r.periode)}><FileDown size={14} /> PDF</button> },
              ]} />
          </div>
        )}
      </Loadable>
    </>
  );
}
