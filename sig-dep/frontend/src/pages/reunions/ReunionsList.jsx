import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApi, Loadable, PageHeader, DataTable, StatusBadge, Badge, Tabs, useOnglet } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export const NIVEAUX_REUNION = { DIRECTION: 'Direction', DIVISION: 'Division', BUREAU: 'Bureau' };

/** Réunions auxquelles on prend part et réunions de son périmètre. */
export default function ReunionsList() {
  const [periode, setPeriode] = useOnglet('a_venir', { cle: 'periode', valeurs: ['a_venir', 'passees', 'toutes'] });
  const state = useApi(`/reunions?periode=${periode}`, [periode]);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Réunions" subtitle="Ordre du jour, convocations, présence, compte rendu et décisions."
        breadcrumb={[{ label: 'Activités' }, { label: 'Réunions' }]}
        actions={state.data?.droits?.organiser && <Link to="/reunions/nouvelle" className="btn-primary"><Plus size={16} aria-hidden /> Préparer une réunion</Link>} />
      <Tabs value={periode} onChange={setPeriode} tabs={[{ value: 'a_venir', label: 'À venir' }, { value: 'passees', label: 'Passées' }, { value: 'toutes', label: 'Toutes' }]} />
      <Loadable state={state}>
        {(d) => (
          <div>
            <DataTable rows={d.data} label="Réunions" onRowClick={(r) => navigate(`/reunions/${r.id}`)} empty="Aucune réunion."
              columns={[
                { key: 'debut', header: 'Date', sortable: true, render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.debut)}</span> },
                { key: 'objet', header: 'Objet', render: (r) => <div><div className="font-medium">{r.objet}</div><div className="text-xs text-slate-500">{r.reference}{r.lieu ? ` · ${r.lieu}` : ''}</div></div>, search: (r) => `${r.objet} ${r.reference}` },
                { key: 'niveau', header: 'Niveau', render: (r) => <Badge>{NIVEAUX_REUNION[r.niveau]}</Badge> },
                { key: 'president_nom', header: 'Président' },
                { key: 'statut', header: 'Statut', render: (r) => <StatusBadge value={r.statut} /> },
              ]} />
          </div>
        )}
      </Loadable>
    </>
  );
}
