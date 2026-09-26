import { useState } from 'react';
import { useApi, Loadable, PageHeader, Card, Field, RangBadge, Badge, InfoAlert } from '../components/ui';
import { ExportButtons } from '../components/shared';
import { fmtDate, fmtMontant } from '../lib/format';
import { PERIMETRES, PRESENCES, STATUTS } from '../lib/labels';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function Rapports() {
  const now = new Date();
  const [periode, setPeriode] = useState('MENSUEL');
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth() + 1);
  const [trimestre, setTrimestre] = useState(Math.floor(now.getMonth() / 3) + 1);
  const qs = `?periode=${periode}&annee=${annee}${periode === 'MENSUEL' ? `&mois=${mois}` : ''}${periode === 'TRIMESTRIEL' ? `&trimestre=${trimestre}` : ''}`;
  const state = useApi(`/rapports/activites${qs}`);
  return (
    <>
      <PageHeader title="Rapports et statistiques" subtitle="Rapports mensuels, trimestriels et annuels limités à votre périmètre." breadcrumb={[{ label: 'Rapports' }]} actions={<ExportButtons base="/rapports/activites/export" query={qs} />} />
      <Card className="mb-4 no-print">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Périodicité"><select className="input" value={periode} onChange={(e) => setPeriode(e.target.value)}><option value="MENSUEL">Mensuel</option><option value="TRIMESTRIEL">Trimestriel</option><option value="ANNUEL">Annuel</option></select></Field>
          <Field label="Année"><input type="number" className="input" value={annee} min="2020" max="2100" onChange={(e) => setAnnee(e.target.value)} /></Field>
          {periode === 'MENSUEL' && <Field label="Mois"><select className="input" value={mois} onChange={(e) => setMois(e.target.value)}>{MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>}
          {periode === 'TRIMESTRIEL' && <Field label="Trimestre"><select className="input" value={trimestre} onChange={(e) => setTrimestre(e.target.value)}>{[1, 2, 3, 4].map((t) => <option key={t} value={t}>{t === 1 ? '1er' : `${t}e`} trimestre</option>)}</select></Field>}
        </div>
      </Card>
      <Loadable state={state}>
        {(r) => (
          <div className="space-y-4">
            <InfoAlert>Période : <b>{r.periode.libelle}</b> (du {fmtDate(r.periode.du)} au {fmtDate(r.periode.au)}) · Périmètre : <b>{PERIMETRES[r.perimetre]}</b>. Les Divisions et le Bureau directement rattaché au Directeur sont présentés séparément.</InfoAlert>
            <Card title="Performance par structure" bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead><tr>{['Structure', 'Agents', 'Tâches', 'Terminées', 'En retard', 'Instructions', 'Exécutées', 'Documents', 'Validés', 'Taux d’exécution'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>
                    {r.lignes.map((l) => (
                      <tr key={`${l.rang}${l.id}`} className={l.rang === 'DIVISION' ? 'bg-indigo-50/40 font-medium' : ''}>
                        <td className={`td ${l.niveau === '— Bureau' ? 'pl-8' : ''}`}><span className="flex flex-wrap items-center gap-2">{l.structure}<RangBadge rang={l.rang} />{l.niveau === 'Bureau rattaché au Directeur' && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Rattaché au Directeur</Badge>}</span></td>
                        {['agents', 'taches', 'tachesTerminees', 'tachesEnRetard', 'instructions', 'instructionsExecutees', 'documents', 'documentsValides'].map((k) => <td key={k} className="td tabular-nums">{l[k]}</td>)}
                        <td className="td tabular-nums">{l.tauxExecution === null ? '—' : `${l.tauxExecution} %`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="grid gap-4 md:grid-cols-3">
              <Card title="Présences (agent-jours)">
                {Object.keys(r.presences).length ? <ul className="space-y-1 text-sm">{Object.entries(r.presences).map(([k, v]) => <li key={k} className="flex justify-between"><span>{PRESENCES[k]?.[0] || k}</span><b className="tabular-nums">{v}</b></li>)}</ul> : <p className="text-sm text-slate-500">Aucune liste soumise sur la période.</p>}
              </Card>
              <Card title="Courriers enregistrés">
                {Object.keys(r.courriers).length ? <ul className="space-y-1 text-sm">{Object.entries(r.courriers).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k === 'ENTRANT' ? 'Entrants' : 'Sortants'}</span><b>{v}</b></li>)}</ul> : <p className="text-sm text-slate-500">—</p>}
              </Card>
              <Card title="Projets PIP">
                {r.pip.length ? <ul className="space-y-1 text-sm">{r.pip.map((p) => <li key={p.statut} className="flex justify-between gap-2"><span>{STATUTS[p.statut]?.[0]} ({p.nombre})</span><b className="tabular-nums">{fmtMontant(p.cout)}</b></li>)}</ul> : <p className="text-sm text-slate-500">Aucune fiche sur la période.</p>}
              </Card>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}
