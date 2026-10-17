import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Badge, Button, SimpleTable, EmptyState, runAction } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import GroupeForm from './GroupeForm';

/** Groupes de travail rattachés à la Direction (cahier, § 14). */
export default function GroupesList() {
  const navigate = useNavigate();
  const state = useApi('/groupes');
  const [form, setForm] = useState(false);
  const creer = async (corps) => {
    const r = await runAction(() => api.post('/groupes', corps), 'Groupe de travail créé : ajoutez ses membres.');
    navigate(`/groupes/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title="Groupes de travail" subtitle="Cellules et commissions rattachées à la Direction : objet, acte de création, membres et dossiers. L’appartenance ne modifie ni l’affectation, ni le grade, ni le rôle."
        breadcrumb={[{ label: 'Organisation' }, { label: 'Groupes de travail' }]}
        actions={state.data?.droits.creer && <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>Nouveau groupe</Button>} />
      <Loadable state={state}>
        {(d) => (!d.data.length ? (
          <EmptyState title="Aucun groupe de travail">{d.droits.creer ? 'Créez un groupe à partir de l’acte ou de la décision du Directeur.' : 'Vous n’êtes membre d’aucun groupe de travail.'}</EmptyState>
        ) : (
          <Card bodyClass="p-0">
            <SimpleTable label="Groupes de travail" rows={d.data} onRowClick={(g) => navigate(`/groupes/${g.id}`)}
              columns={[
                { key: 'nom', header: 'Groupe', render: (g) => <span><span className="font-medium">{g.nom}</span><span className="block text-xs text-slate-600">{g.code}</span></span> },
                { key: 'coordonnateur', header: 'Coordonnateur', render: (g) => g.coordonnateur || '—' },
                { key: 'membres', header: 'Membres', align: 'right', render: (g) => `${g.membres}${g.participants ? ` + ${g.participants} ext.` : ''}` },
                { key: 'periode', header: 'Période', render: (g) => `depuis le ${fmtDate(g.date_debut)}${g.date_fin ? ` jusqu’au ${fmtDate(g.date_fin)}` : ''}` },
                { key: 'statut', header: 'Statut', render: (g) => <Badge tone={g.statut === 'ACTIF' ? 'succes' : 'neutre'}>{g.statut === 'ACTIF' ? 'Actif' : 'Clos'}</Badge> },
              ]} />
          </Card>
        ))}
      </Loadable>
      {form && <GroupeForm onClose={() => setForm(false)} onSubmit={creer} />}
    </>
  );
}
