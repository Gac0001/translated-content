import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useApi, Loadable, PageHeader, Card, KeyValues, Empty, Stat } from '../../components/ui';
import { Barres, Evolution, IndicateurModal, fmtVal } from './Indicateurs';

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
        const definition = {
          SOMME: `Somme de ${i.question}`, MOYENNE: `Moyenne de ${i.question}`, RATIO: `${i.question} / ${i.question_denominateur}${Number(i.facteur) !== 1 ? ` × ${Number(i.facteur).toLocaleString('fr-FR')}` : ''}`,
          NOMBRE: i.question ? `Répondants dont ${i.question} = ${i.valeur_choix || 'renseigné'}` : 'Nombre de répondants', PART: `Part des répondants dont ${i.question} = ${i.valeur_choix} (%)`,
        }[i.calcul];
        return (
          <>
            <PageHeader title={i.libelle} subtitle={`Indicateur ${i.code} · ${i.questionnaire_titre}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees' }, { label: i.code }]}
              actions={ref.data?.droits.questionnaires && <button type="button" className="btn-secondary" onClick={() => setEdition(true)}><Pencil size={16} /> Définition</button>} />
            {!s.length ? <Empty message="Aucune campagne validée pour ce questionnaire : l’indicateur sera calculé dès la première validation." /> : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label={`Valeur ${courante.periode}`} value={fmtVal(courante.valeur, i.decimales, i.unite)} hint={`${courante.n} répondant(s)`} />
                  <Stat label="Période précédente" value={idx > 0 ? fmtVal(s[idx - 1].valeur, i.decimales, i.unite) : '—'} hint={idx > 0 ? s[idx - 1].periode : null} tone="gris" />
                  <div className="card flex flex-col justify-center p-4"><div className="text-2xl font-semibold"><Evolution v={courante.valeur} p={idx > 0 ? s[idx - 1].valeur : null} /></div><div className="text-xs font-medium uppercase tracking-wide text-slate-600">Évolution</div></div>
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card title="Évolution par période" bodyClass="p-0">
                    <table className="min-w-full text-sm">
                      <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="px-3 py-2">Période</th><th className="px-3 text-right">Valeur</th><th className="px-3 text-right">Évolution</th></tr></thead>
                      <tbody>{s.map((x, k) => (
                        <tr key={x.campagne_id} className={`cursor-pointer border-b border-slate-100 ${x === courante ? 'bg-dep-50 font-semibold' : 'hover:bg-slate-50'}`} onClick={() => setPeriode(x.campagne_id)}>
                          <td className="px-3 py-1.5">{x.periode}</td><td className="px-3 text-right tabular-nums">{fmtVal(x.valeur, i.decimales)}</td><td className="px-3 text-right text-xs"><Evolution v={x.valeur} p={k ? s[k - 1].valeur : null} /></td>
                        </tr>
                      ))}</tbody>
                    </table>
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
