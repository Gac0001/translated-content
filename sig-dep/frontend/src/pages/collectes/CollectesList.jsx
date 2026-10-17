import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Badge, Button, SimpleTable, EmptyState, StatusBadge, runAction } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import CollecteForm from './CollecteForm';

/** Campagnes de collecte auprès des services du Secrétariat Général (cahier, § 36). */
export default function CollectesList() {
  const navigate = useNavigate();
  const state = useApi('/collectes');
  const [form, setForm] = useState(false);
  const creer = async (corps) => {
    const r = await runAction(() => api.post('/collectes', corps), 'Campagne préparée : elle sera ouverte par le Chef de la Division Programme et Suivi.');
    navigate(`/collectes/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title="Collecte auprès des services" subtitle="Campagnes adressées aux services du Secrétariat Général : modèles Excel pré-remplis et protégés, retours contrôlés, contributions intégrées au SIG-DEP."
        breadcrumb={[{ label: 'Planification et données' }, { label: 'Collecte auprès des services' }]}
        actions={state.data?.droits.creer.length > 0 && <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>Nouvelle campagne</Button>} />
      <Loadable state={state}>
        {(d) => (!d.data.length ? (
          <EmptyState title="Aucune campagne de collecte">{d.droits.creer.length ? 'Préparez une campagne : objet, exercice, services ciblés et échéance.' : 'Les campagnes sont préparées par le Bureau Programme et le Bureau Suivi-Évaluation.'}</EmptyState>
        ) : (
          <Card bodyClass="p-0">
            <SimpleTable label="Campagnes de collecte" rows={d.data} onRowClick={(c) => navigate(`/collectes/${c.id}`)}
              columns={[
                { key: 'titre', header: 'Campagne', render: (c) => <span><Link className="link font-medium" to={`/collectes/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.titre}</Link><span className="block text-xs text-slate-600">{c.reference} · {c.objet_libelle} · exercice {c.annee}</span></span> },
                { key: 'echeance', header: 'Échéance', render: (c) => fmtDate(c.echeance) },
                { key: 'retours', header: 'Retours', align: 'right', render: (c) => `${c.retours} / ${c.services}` },
                { key: 'integres', header: 'Intégrés', align: 'right' },
                { key: 'en_retard', header: 'En retard', render: (c) => (c.en_retard ? <Badge tone="danger">{c.en_retard}</Badge> : '—') },
                { key: 'statut', header: 'Statut', render: (c) => <StatusBadge value={c.statut} feminin /> },
              ]} />
          </Card>
        ))}
      </Loadable>
      {form && <CollecteForm objets={state.data.objets.filter((o) => state.data.droits.creer.includes(o.code))} onClose={() => setForm(false)} onSubmit={creer} />}
    </>
  );
}
