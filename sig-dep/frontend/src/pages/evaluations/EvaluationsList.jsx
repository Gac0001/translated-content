import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Button, SimpleTable, EmptyState, StatusBadge, Tabs, useOnglet, runAction } from '../../components/ui';
import { fmtCdf, fmtDate } from '../../lib/format';
import EvaluationForm from './EvaluationForm';

/**
 * Cadre de Dépenses Sectorielles à Moyen Terme : projections sur trois ans reportées depuis l’annexe II
 * des dossiers d’évaluation transmis (la plus récente l’emporte pour une même action et une même année).
 */
function Cdsmt() {
  const state = useApi('/evaluations/cdsmt');
  return (
    <Loadable state={state}>
      {(c) => (!c.lignes.length ? (
        <EmptyState title="Aucune projection reportée">Les projections de l’annexe II sont reportées dans le CDS-MT à la transmission du dossier d’évaluation au Secrétaire Général.</EmptyState>
      ) : (
        <Card title="Projections reportées (CDF)" bodyClass="p-0">
          <SimpleTable label="Projections du CDS-MT" rowKey="cle" dense figee rows={c.lignes}
            footer={[{ cle: 'total', action: 'Total', montants: c.totaux }]}
            columns={[
              { key: 'action', header: 'Action', render: (l) => <span className="block min-w-[14rem] whitespace-normal font-medium">{l.action}</span> },
              ...c.annees.map((a) => ({ key: String(a), header: String(a), align: 'right', render: (l) => fmtCdf(l.montants[a], { suffixe: false }) })),
              { key: 'objectif_pag', header: 'Objectif visé (PAG)', render: (l) => (l.cle === 'total' ? null : <span className="block min-w-[12rem] whitespace-normal text-xs">{l.objectif_pag || '—'}</span>) },
              { key: 'source', header: 'Source', render: (l) => (l.cle === 'total' ? null : <span className="whitespace-nowrap text-xs">Évaluation {l.exercice}</span>) },
            ]} />
          <p className="border-t px-3 py-2 text-xs text-slate-600">Ces projections alimentent la programmation à moyen terme ; elles ne se modifient pas : un nouveau dossier d’évaluation transmis les met à jour.</p>
        </Card>
      ))}
    </Loadable>
  );
}

/** Dossiers annuels d’évaluation des politiques sectorielles et budgétaires (cahier, §§ 34 et 51). */
export default function EvaluationsList() {
  const navigate = useNavigate();
  const state = useApi('/evaluations');
  const [form, setForm] = useState(false);
  const [onglet, choisir] = useOnglet('dossiers', { valeurs: ['dossiers', 'cdsmt'] });
  const ouvrir = async (corps) => {
    const r = await runAction(() => api.post('/evaluations', corps), 'Dossier ouvert : annexes reprises des données du SIG-DEP.');
    navigate(`/evaluations/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title="Évaluation des politiques" subtitle="Dossier annuel du Ministère, à la demande du Ministère du Budget : note de présentation, annexes I à V reprises du SIG-DEP et contrôlées, lettre de transmission au Secrétaire Général."
        breadcrumb={[{ label: 'Planification et données' }, { label: 'Évaluation des politiques' }]}
        actions={state.data?.droits.ouvrir && <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>Ouvrir un dossier</Button>} />
      <Tabs label="Évaluation des politiques" value={onglet} onChange={choisir} tabs={[{ value: 'dossiers', label: 'Dossiers' }, { value: 'cdsmt', label: 'Projections CDS-MT' }]} />
      {onglet === 'cdsmt' ? <Cdsmt /> : (
      <Loadable state={state}>
        {(d) => (!d.data.length ? (
          <EmptyState title="Aucun dossier d’évaluation">{d.droits.ouvrir ? 'Ouvrez le dossier de l’exercice à réception de la convocation du Ministère du Budget.' : 'Le Bureau Suivi-Évaluation ouvre le dossier à réception de la convocation du Ministère du Budget.'}</EmptyState>
        ) : (
          <Card bodyClass="p-0">
            <SimpleTable label="Dossiers d’évaluation" rows={d.data} onRowClick={(e) => navigate(`/evaluations/${e.id}`)}
              columns={[
                { key: 'annee', header: 'Exercice', render: (e) => <span><Link className="link font-medium" to={`/evaluations/${e.id}`} onClick={(ev) => ev.stopPropagation()}>Évaluation {e.annee}</Link><span className="block text-xs text-slate-600">{e.reference}</span></span> },
                { key: 'convocation', header: 'Convocation', render: (e) => <span className="text-sm">{e.convocation_reference}<span className="block text-xs text-slate-600">du {fmtDate(e.convocation_date)}</span></span> },
                { key: 'date_limite', header: 'Échéance', render: (e) => fmtDate(e.date_limite) },
                { key: 'projection', header: 'Projection', render: (e) => `${e.annee_projection}-${e.annee_projection + 2}` },
                { key: 'lignes', header: 'Lignes', align: 'right' },
                { key: 'statut', header: 'Statut', render: (e) => <StatusBadge value={e.statut} /> },
              ]} />
          </Card>
        ))}
      </Loadable>
      )}
      {form && <EvaluationForm onClose={() => setForm(false)} onSubmit={ouvrir} />}
    </>
  );
}
