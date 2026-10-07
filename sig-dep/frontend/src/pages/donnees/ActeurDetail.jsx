import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, Empty } from '../../components/ui';
import { Timeline } from '../../components/shared';
import { ActeurModal } from './Donnees';

export default function ActeurDetail() {
  const { id } = useParams();
  const state = useApi(`/donnees/acteurs/${id}`, [id]);
  const ref = useApi('/donnees/referentiel');
  const [edition, setEdition] = useState(false);
  return (
    <Loadable state={state}>
      {(a) => (
        <>
          <PageHeader title={a.raison_sociale} subtitle={`${a.reference}${a.sigle ? ` · ${a.sigle}` : ''} · ${a.categorie}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees' }, { label: a.sigle || a.raison_sociale }]}
            actions={a.droits.annuaire && ref.data && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} /> Modifier</button>} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Identification" className="lg:col-span-2">
              <KeyValues items={[
                ['Statut', <StatusBadge key="s" value={a.statut} />], ['Catégorie', a.categorie], ['Forme juridique', a.forme_juridique || '—'], ['RCCM', a.rccm || '—'],
                ['Identification nationale', a.id_nat || '—'], ['N° impôt', a.numero_impot || '—'], ['Année de création', a.annee_creation || '—'], ['Effectif', a.effectif ?? '—'],
              ]} />
            </Card>
            <Card title="Coordonnées">
              <KeyValues cols={1} items={[
                ['Province', a.zone], ['Ville', a.ville || '—'], ['Adresse', a.adresse || '—'], ['Téléphone', a.telephone || '—'], ['Courriel', a.email || '—'],
                ['Site web', a.site_web || '—'], ['Responsable', a.responsable || '—'],
              ]} />
            </Card>
            {a.observations && <Card title="Observations" className="lg:col-span-3"><p className="whitespace-pre-line text-sm">{a.observations}</p></Card>}
            <Card title="Participation aux campagnes" className="lg:col-span-2">
              {a.participations.length ? (
                <ul className="divide-y text-sm">{a.participations.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link className="text-dep-700 hover:underline" to={`/donnees/campagnes/${p.id}`}>{p.titre} <span className="text-xs text-slate-500">({p.periode})</span></Link>
                    <span className="flex gap-1"><StatusBadge value={p.statut} />{p.reponse ? <StatusBadge value={p.reponse} /> : <span className="text-xs text-slate-500">réponse non reçue</span>}</span>
                  </li>
                ))}</ul>
              ) : <Empty compact message="Aucune campagne." />}
            </Card>
            <Card title="Historique de la fiche"><Timeline items={a.historique} /></Card>
          </div>
          {edition && <ActeurModal acteur={a} referentiel={ref.data} onClose={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} />}
        </>
      )}
    </Loadable>
  );
}
