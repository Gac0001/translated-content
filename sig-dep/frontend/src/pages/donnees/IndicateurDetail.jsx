import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useApi, Loadable, PageHeader, Card, KeyValues, EmptyState, KpiTile, SimpleTable } from '../../components/ui';
import { fmtNombre } from '../../lib/format';
import { Barres, Evolution, IndicateurModal, evolution, fmtVal } from './Indicateurs';

export default function IndicateurDetail() {
  const { id } = useParams();
  const state = useApi(`/donnees/indicateurs/${id}`, [id]);
  const ref = useApi('/donnees/referentiel');
  const [edition, setEdition] = useState(false);
  const [periode, setPeriode] = useState(null);
  return (
    <Loadable state={state}>
      {(i) => {
        const s = i.serie;
        const courante = s.find((x) => x.campagne_id === periode) || s[s.length - 1];
        const idx = s.indexOf(courante);
        const ev = idx > 0 ? evolution(courante.valeur, s[idx - 1].valeur) : null;
        const definition = {
          SOMME: `Somme de ${i.question}`, MOYENNE: `Moyenne de ${i.question}`, RATIO: `${i.question} / ${i.question_denominateur}${Number(i.facteur) !== 1 ? ` × ${Number(i.facteur).toLocaleString('fr-FR')}` : ''}`,
          NOMBRE: i.question ? `Répondants dont ${i.question} = ${i.valeur_choix || 'renseigné'}` : 'Nombre de répondants', PART: `Part des répondants dont ${i.question} = ${i.valeur_choix} (%)`,
        }[i.calcul];
        return (
          <>
            <PageHeader title={i.libelle} subtitle={`Indicateur ${i.code} · ${i.questionnaire_titre}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees?onglet=indicateurs' }, { label: i.code }]}
              actions={ref.data?.droits.questionnaires && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} aria-hidden /> Définition</button>} />
            {!s.length ? <div className="card"><EmptyState title="Pas encore de valeur">Aucune campagne validée pour ce questionnaire : l’indicateur sera calculé dès la première validation.</EmptyState></div> : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <KpiTile label={`Valeur ${courante.periode}`} valeur={fmtVal(courante.valeur, i.decimales)} unite={i.unite} aide={`${courante.n} répondant(s)`}
                    evolution={ev === null ? undefined : { valeur: ev, texte: `${ev >= 0 ? '+' : ''}${fmtNombre(ev, 1)} %`, favorable: null }} reference={idx > 0 ? `vs ${s[idx - 1].periode}` : undefined} />
                  <KpiTile label="Période précédente" tone="gris" valeur={idx > 0 ? fmtVal(s[idx - 1].valeur, i.decimales) : '—'} unite={idx > 0 ? i.unite : undefined} aide={idx > 0 ? s[idx - 1].periode : 'Première période disponible'} />
                  <KpiTile label="Périodes disponibles" tone="gris" valeur={s.length} aide={`de ${s[0].periode} à ${s[s.length - 1].periode}`} />
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card title="Évolution par période" bodyClass="p-0">
                    <SimpleTable label="Évolution par période" dense rowKey="campagne_id" rows={s.map((x, k) => ({ ...x, k }))} onRowClick={(x) => setPeriode(x.campagne_id)}
                      rowClassName={(x) => (x.campagne_id === courante.campagne_id ? 'bg-dep-50 font-semibold' : undefined)}
                      columns={[
                        { key: 'periode', header: 'Période', render: (x) => <>{x.periode}{x.campagne_id === courante.campagne_id && <span className="sr-only"> (affichée)</span>}</> },
                        { key: 'valeur', header: 'Valeur', align: 'right', render: (x) => fmtVal(x.valeur, i.decimales) },
                        { key: 'evol', header: 'Évolution', align: 'right', className: 'text-xs', render: (x) => <Evolution v={x.valeur} p={x.k ? s[x.k - 1].valeur : null} /> },
                      ]} />
                    <p className="px-3 py-2 text-xs text-slate-500">Choisissez une période pour afficher sa répartition.</p>
                  </Card>
                  <Card title={`Par province — ${courante.periode}`}><Barres rows={courante.zones} decimales={i.decimales} unite={i.unite} label="Valeur par province" /></Card>
                  <Card title={`Par catégorie d’acteurs — ${courante.periode}`}><Barres rows={courante.categories} decimales={i.decimales} unite={i.unite} label="Valeur par catégorie" /></Card>
                </div>
              </div>
            )}
            <Card title="Définition" className="mt-4">
              <KeyValues items={[['Calcul', definition], ['Unité', i.unite || '—'], ['Questionnaire', `${i.questionnaire_code} — ${i.questionnaire_titre}`], ['Source', 'Réponses contrôlées des campagnes validées']]} />
              {i.description && <p className="mt-2 whitespace-pre-line text-sm">{i.description}</p>}
            </Card>
            {edition && <IndicateurModal indicateur={i} calculs={i.calculs} onClose={() => setEdition(false)} onSaved={() => { setEdition(false); state.reload(); }} />}
          </>
        );
      }}
    </Loadable>
  );
}
