import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Button, SimpleTable, EmptyState, StatusBadge, runAction } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import EvaluationForm from './EvaluationForm';

/** Dossiers annuels d’évaluation des politiques sectorielles et budgétaires (cahier, §§ 34 et 51). */
export default function EvaluationsList() {
  const navigate = useNavigate();
  const state = useApi('/evaluations');
  const [form, setForm] = useState(false);
  const ouvrir = async (corps) => {
    const r = await runAction(() => api.post('/evaluations', corps), 'Dossier ouvert : annexes reprises des données du SIG-DEP.');
    navigate(`/evaluations/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title="Évaluation des politiques" subtitle="Dossier annuel du Ministère, à la demande du Ministère du Budget : note de présentation, annexes I à V reprises du SIG-DEP et contrôlées, lettre de transmission au Secrétaire Général."
        breadcrumb={[{ label: 'Planification et données' }, { label: 'Évaluation des politiques' }]}
        actions={state.data?.droits.ouvrir && <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>Ouvrir un dossier</Button>} />
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
      {form && <EvaluationForm onClose={() => setForm(false)} onSubmit={ouvrir} />}
    </>
  );
}
