import { Link, useParams } from 'react-router-dom';
import { useApi, Loadable, PageHeader, Card, Badge, RangBadge, KeyValues, DataTable } from '../../components/ui';
import { fmtDate } from '../../lib/format';

export default function Structure() {
  const { type, id } = useParams();
  const state = useApi(`/organisation/structures/${type}/${id}`);
  return (
    <Loadable state={state}>
      {(s) => {
        const st = s.structure;
        const rang = type === 'direction' ? 'DIRECTION' : type === 'division' ? 'DIVISION' : 'BUREAU';
        return (
          <>
            <PageHeader title={st.nom} breadcrumb={[{ label: 'Organisation' }, { label: 'Organigramme', to: '/organigramme' }, { label: st.nom }]}
              subtitle={<span className="flex flex-wrap items-center gap-2"><RangBadge rang={rang} />{st.badge && <Badge tone="ambre">{st.badge}</Badge>}</span>} />
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Identification" className="lg:col-span-2">
                <KeyValues items={[
                  ['Code', st.code], ['Rang organique', rang === 'BUREAU' ? 'Bureau' : rang === 'DIVISION' ? 'Division' : 'Direction'],
                  ['Rattachement hiérarchique', s.rattachement?.libelle],
                  type === 'bureau' && ['Division de rattachement', s.rattachement?.divisionRattachement],
                  type !== 'direction' && ['Supérieur direct', s.rattachement?.superieurDirect === 'DIRECTEUR' ? 'Directeur' : 'Chef de Division'],
                  ['Périmètre d’accès du responsable', rang === 'BUREAU' ? 'Bureau' : rang === 'DIVISION' ? 'Division' : 'Direction'],
                  ['Responsable', s.responsable ? <Link className="link" to={`/personnel/${s.responsable.agentId}`}>{s.responsable.nomComplet}</Link> : 'Poste vacant'],
                  ['Titre du responsable', st.responsable_titre],
                ]} />
                {st.missions && <div className="mt-4"><div className="text-xs font-medium uppercase text-slate-500">Missions</div><p className="mt-1 text-sm">{st.missions}</p></div>}
              </Card>
              <Card title={`Responsabilités du ${st.responsable_titre}`}>
                <ul className="list-disc space-y-1 pl-5 text-sm">{s.responsabilitesResponsable.map((r) => <li key={r.id}>{r.libelle}</li>)}</ul>
              </Card>
              <Card title="Missions et attributions" className="lg:col-span-2">
                {s.attributions.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{s.attributions.map((a) => <li key={a.id}>{a.libelle}</li>)}</ul> : <p className="text-sm text-slate-500">Aucune attribution enregistrée.</p>}
              </Card>
              <Card title="Postes organiques">
                <ul className="space-y-1 text-sm">{s.postes.map((p) => <li key={p.id}>{p.libelle}</li>)}</ul>
              </Card>
              {st.bureaux && (
                <Card title="Bureaux rattachés" className="lg:col-span-3">
                  <ul className="grid gap-2 sm:grid-cols-2">{st.bureaux.map((b) => <li key={b.id}><Link to={`/structures/bureau/${b.id}`} className="link">{b.nom}</Link></li>)}</ul>
                </Card>
              )}
            </div>
            {s.agents.length > 0 && (
              <div className="mt-4">
                <h2 className="mb-2 text-sm font-semibold uppercase text-dep-800">Agents affectés</h2>
                <DataTable rowKey="agentId" rows={s.agents} columns={[
                  { key: 'nomComplet', header: 'Nom', render: (a) => <Link className="link" to={`/personnel/${a.agentId}`}>{a.nomComplet}</Link> },
                  { key: 'matricule', header: 'Matricule' }, { key: 'grade', header: 'Grade' }, { key: 'poste', header: 'Poste organique' },
                  { key: 'dateAffectation', header: 'Affecté le', render: (a) => fmtDate(a.dateAffectation) },
                ]} />
              </div>
            )}
          </>
        );
      }}
    </Loadable>
  );
}
