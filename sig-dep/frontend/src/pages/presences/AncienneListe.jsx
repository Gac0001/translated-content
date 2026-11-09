import { useParams } from 'react-router-dom';
import { useApi, Loadable, PageHeader, Card, StatusBadge, KeyValues, InfoAlert, SimpleTable } from '../../components/ui';
import { ExportButtons, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { JOURS, PRESENCES } from '../../lib/labels';

/** Ancienne liste hebdomadaire par Bureau (avant la version 1.38) : consultation et export seulement. */
export default function AncienneListe() {
  const { id } = useParams();
  const state = useApi(`/presences/anciennes/${id}`, [id]);
  return (
    <Loadable state={state}>
      {(s) => (
        <>
          <PageHeader title={`Ancienne liste de présence — semaine ${s.numero_semaine}`} subtitle={`${s.reference} · du ${fmtDate(s.semaine_debut)} au ${fmtDate(s.semaine_fin)}`}
            breadcrumb={[{ label: 'Présences', to: '/presences?onglet=anciennes' }, { label: s.reference }]}
            actions={<ExportButtons base={`/presences/anciennes/${id}/export`} />} />
          <InfoAlert>Liste tenue selon l’ancien format hebdomadaire par Bureau, conservée en lecture seule.</InfoAlert>
          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <Card title="Informations" className="lg:col-span-3">
              <KeyValues cols={3} items={[
                ['Statut', <StatusBadge key="s" value={s.statut} />],
                ['Structure', s.structure_type === 'DIRECTION' ? 'Direction (toutes structures)' : `${s.bureau_nom}${s.division_nom ? ` — ${s.division_nom}` : ''}`],
                ['Établie par', s.createur], ['Soumise le', fmtDateTime(s.submitted_at)], ['Verrouillée le', fmtDateTime(s.locked_at)],
              ]} />
            </Card>
            <Card title="Totaux (agent-jours)">
              <ul className="space-y-1 text-sm">{Object.entries(PRESENCES).map(([k, [l]]) => <li key={k} className="flex justify-between"><span>{l}</span><b className="tabular-nums">{s.totaux[k] || 0}</b></li>)}</ul>
            </Card>
          </div>
          <Card className="mt-4" bodyClass="p-0">
            <SimpleTable label="Grille des présences" rows={s.entries} columns={[
              { key: 'agent', header: 'Agent', render: (e) => <span className="whitespace-nowrap font-medium">{[e.nom, e.postnom, e.prenom].filter(Boolean).join(' ')}</span> },
              { key: 'grade', header: 'Grade', render: (e) => e.grade || '—' },
              ...JOURS.map((j) => ({ key: j, header: j.charAt(0).toUpperCase() + j.slice(1), align: 'center', render: (e) => PRESENCES[e[j]]?.[1] || '—' })),
              { key: 'observation', header: 'Observation', render: (e) => e.observation || '' },
            ]} />
            <p className="border-t px-3 py-2 text-xs text-slate-600">Légende : P = Présent · A = Absent · R = Retard · C = Congé · M = Mission · MA = Maladie</p>
          </Card>
          <Card title="Historique" className="mt-4 no-print"><Timeline items={s.historique} /></Card>
        </>
      )}
    </Loadable>
  );
}
