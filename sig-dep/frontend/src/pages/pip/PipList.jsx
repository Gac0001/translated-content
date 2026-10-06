import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate, fmtMontant } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

export default function PipList() {
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const liste = useListParams({ statut: '' });
  const query = queryString({ statut: liste.valeurs.statut });
  const state = useApi(`/pip${query}`);
  return (
    <ListPage title="Projets PIP" subtitle="Fiches de projets du Programme d’Investissements Publics — modèle du Ministère du Plan." breadcrumb={[{ label: 'Projets PIP' }]}
      liste={liste} state={state} onRowClick={(p) => navigate(`/pip/${p.id}`)}
      actions={<>
        <ExportButtons base="/pip/export" formats={['xlsx']} print={false} query={query} />
        {can('pip.rediger') && <Link to="/pip/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Nouvelle fiche PIP</Link>}
      </>}
      filtres={[{ key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: [['BROUILLON', 'Brouillon'], ['EN_VERIFICATION', 'En vérification'], ['A_CORRIGER', 'À corriger'], ['VERIFIE', 'Vérifiée'], ['VALIDE', 'Validée'], ['ARCHIVE', 'Archivée']] }]}
      columns={[
        { key: 'code', header: 'Code', sortable: true, render: (p) => <span className="whitespace-nowrap font-medium">{p.code}</span> },
        { key: 'intitule', header: 'Intitulé du projet', primary: true, sortable: true, render: (p) => <span>{p.intitule}<span className="block text-xs font-normal text-slate-500">{p.secteur}</span></span> },
        { key: 'cout_total', header: 'Coût total', sortValue: (p) => (p.cout_total === null ? null : Number(p.cout_total)), render: (p) => <span className="whitespace-nowrap tabular-nums">{fmtMontant(p.cout_total, p.devise)}</span> },
        { key: 'duree', header: 'Durée', sortValue: (p) => (p.duree_mois ? Number(p.duree_mois) : null), render: (p) => (p.duree_mois ? `${p.duree_mois} mois` : '—') },
        { key: 'date_debut', header: 'Démarrage', sortable: true, render: (p) => fmtDate(p.date_debut) },
        { key: 'auteur_nom', header: 'Élaborée par', sortable: true, render: (p) => <span>{p.auteur_nom}<span className="block text-xs text-slate-500">{p.bureau_nom || p.division_nom || 'Direction'}</span></span> },
        { key: 'statut', header: 'Statut', sortValue: (p) => STATUTS[p.statut]?.[0], render: (p) => <StatusBadge value={p.statut} /> },
      ]} />
  );
}
