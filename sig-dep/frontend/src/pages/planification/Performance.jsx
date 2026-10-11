import { useState } from 'react';
import { Plus } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { fmtNombre } from '../../lib/format';
import { useApi, Loadable, Card, FormModal, FormSection, Field, InfoAlert, EmptyState, NumberInput, SimpleTable, toast } from '../../components/ui';

/**
 * Valeur d’un indicateur (cible ou réalisation), enregistrée en quittant le champ.
 * En cas d’échec, la valeur enregistrée est rétablie.
 */
function Valeur({ indicateur, annee, type, editable, onSaved, libelle }) {
  const actuelle = indicateur.valeurs[`${type}:${annee}`]?.valeur ?? null;
  const [v, setV] = useState(actuelle === null ? null : Number(actuelle));
  const [cle, setCle] = useState(0);
  const enregistrer = async () => {
    if ((v ?? null) === (actuelle === null ? null : Number(actuelle))) return;
    try {
      await api.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee, type, valeur: v });
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e, 'Enregistrement impossible.'));
      setV(actuelle === null ? null : Number(actuelle)); setCle((k) => k + 1);
    }
  };
  if (!editable) return <span className="tabular-nums">{fmtNombre(actuelle, 2)}</span>;
  return <NumberInput key={cle} value={v} onChange={setV} onBlur={enregistrer} decimales={2} className="w-24 px-2 py-1" aria-label={`${libelle} — ${type === 'CIBLE' ? 'cible' : 'réalisation'} ${annee}${type === 'REALISATION_S1' ? ' (premier semestre)' : ''}`} />;
}

function TableauObjectifs({ objectifs, A, droits, reload, onIndicateur }) {
  const real = [A - 4, A - 3, A - 2];
  const cibles = [A, A + 1, A + 2];
  if (!objectifs.length) return <EmptyState compact title="Aucun objectif">Ajoutez un objectif, puis ses indicateurs : unité, sens, source, réalisations et cibles.</EmptyState>;
  const cellule = (annee, type, editable) => (i) => <Valeur indicateur={i} annee={annee} type={type} editable={editable} onSaved={reload} libelle={i.libelle} />;
  const columns = [
    { key: 'libelle', header: 'Indicateur', className: 'min-w-[16rem] max-w-sm', render: (i) => (
      <>{droits.saisir ? <button type="button" className="link text-left no-underline hover:underline" onClick={() => onIndicateur(i)}>{i.libelle}</button> : i.libelle}
        {i.source && <div className="text-xs font-normal text-slate-500">Source : {i.source}</div>}</>
    ) },
    { key: 'unite', header: 'Unité' },
    ...real.map((a, k) => ({ key: `r${a}`, header: String(a), align: 'right', debutGroupe: k === 0, render: cellule(a, 'REALISATION', droits.suivre) })),
    { key: 's1', header: `${A - 1} (S1)`, align: 'right', debutGroupe: true, render: cellule(A - 1, 'REALISATION_S1', droits.suivre) },
    ...cibles.map((a, k) => ({ key: `c${a}`, header: String(a), align: 'right', debutGroupe: k === 0, render: cellule(a, 'CIBLE', droits.saisir) })),
  ];
  return (
    <div className="divide-y divide-[#e9edf2]">
      {objectifs.map((o, oi) => (
        <section key={o.id} aria-label={`Objectif ${oi + 1}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-dep-800">Objectif {oi + 1} : {o.libelle}</h3>
            {droits.saisir && <button type="button" className="btn-ghost btn-sm" onClick={() => onIndicateur({ objectif_id: o.id, libelle: '', unite: '%', mode_calcul: '', source: '', commentaire: '', sens: 'HAUSSE' })}><Plus size={14} aria-hidden /> Indicateur</button>}
          </div>
          <SimpleTable label={`Indicateurs de l’objectif ${oi + 1}`} dense columns={columns} rows={o.indicateurs} empty="Aucun indicateur pour cet objectif."
            groupes={[{ label: '', colSpan: 2 }, { label: 'Réalisations', colSpan: 3 }, { label: 'En cours' }, { label: 'Cibles', colSpan: 3 }]} />
        </section>
      ))}
    </div>
  );
}

/** Cadre de performance : objectifs du Ministère et des programmes, indicateurs, réalisations et cibles. */
export default function Performance({ annee }) {
  const state = useApi(`/programmation/cadre?annee=${annee}`, [annee]);
  const [edition, setEdition] = useState(null);
  const [initial, setInitial] = useState(null);
  const ouvrir = (e) => { setEdition(e); setInitial(e); };
  const enregistrer = async () => {
    const { kind, id, ...b } = edition;
    if (!b.libelle?.trim()) throw new Error('Le libellé est obligatoire.');
    const url = kind === 'objectif' ? '/programmation/objectifs' : '/programmation/indicateurs';
    await (id ? api.put(`${url}/${id}`, b) : api.post(url, b));
    toast.success('Cadre de performance mis à jour.');
    setEdition(null); state.reload();
  };
  const champ = (k, label, props = {}) => <Field label={label} {...props}><input className="input" value={edition[k] ?? ''} onChange={(e) => setEdition({ ...edition, [k]: e.target.value })} /></Field>;
  const objectif = (programme_id) => ({ kind: 'objectif', programme_id, libelle: '' });
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>Les cibles sont fixées par le Bureau Programme et la Division Programme et Suivi ; les réalisations sont saisies par le Bureau Suivi-Évaluation et enregistrées en quittant la cellule. Colonnes du PAP {annee} : réalisations {annee - 4} à {annee - 2}, exercice en cours {annee - 1}, cibles {annee} à {annee + 2}.</InfoAlert>
          <Card title="Objectifs les plus représentatifs du Ministère" bodyClass="p-0" actions={d.droits.saisir && <button type="button" className="btn-secondary" onClick={() => ouvrir(objectif(null))}><Plus size={16} aria-hidden /> Objectif</button>}>
            <TableauObjectifs objectifs={d.objectifsMinistere} A={annee} droits={d.droits} reload={state.reload} onIndicateur={(i) => ouvrir({ kind: 'indicateur', ...i })} />
          </Card>
          {d.programmes.map((p) => (
            <Card key={p.id} title={`Programme ${p.code} : ${p.libelle}`} bodyClass="p-0" actions={d.droits.saisir && <button type="button" className="btn-secondary" onClick={() => ouvrir(objectif(p.id))}><Plus size={16} aria-hidden /> Objectif</button>}>
              <TableauObjectifs objectifs={p.objectifs} A={annee} droits={d.droits} reload={state.reload} onIndicateur={(i) => ouvrir({ kind: 'indicateur', ...i })} />
            </Card>
          ))}
          <FormModal open={!!edition} title={edition?.kind === 'objectif' ? (edition.id ? 'Objectif' : 'Nouvel objectif') : (edition?.id ? 'Indicateur' : 'Nouvel indicateur')}
            dirty={JSON.stringify(edition) !== JSON.stringify(initial)} onClose={() => setEdition(null)} onSubmit={enregistrer}>
            {edition?.kind === 'objectif' ? <FormSection cols={1}>{champ('libelle', 'Libellé', { required: true })}</FormSection> : edition && (
              <>
                <FormSection title="Définition" cols={2}>
                  {champ('libelle', 'Indicateur', { required: true, className: 'sm:col-span-2' })}
                  {champ('unite', 'Unité de mesure')}
                  <Field label="Sens"><select className="input" value={edition.sens} onChange={(e) => setEdition({ ...edition, sens: e.target.value })}><option value="HAUSSE">À la hausse</option><option value="BAISSE">À la baisse</option></select></Field>
                </FormSection>
                <FormSection title="Mesure" cols={2}>
                  {champ('mode_calcul', 'Mode de calcul')}{champ('source', 'Source')}
                  <Field label="Commentaires" className="sm:col-span-2"><textarea className="input" rows={3} value={edition.commentaire || ''} onChange={(e) => setEdition({ ...edition, commentaire: e.target.value })} /></Field>
                </FormSection>
              </>
            )}
          </FormModal>
        </div>
      )}
    </Loadable>
  );
}

export { Valeur };
