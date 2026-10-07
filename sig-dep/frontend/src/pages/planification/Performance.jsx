import { useState } from 'react';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, Card, Modal, Field, InfoAlert, Empty, runAction, toast } from '../../components/ui';

const fmt = (v) => (v === undefined || v === null ? '' : String(v).replace('.', ','));

/** Cellule éditable d’une valeur d’indicateur (cible ou réalisation). */
function Valeur({ indicateur, annee, type, editable, onSaved }) {
  const actuelle = indicateur.valeurs[`${type}:${annee}`]?.valeur;
  const [v, setV] = useState(fmt(actuelle));
  const enregistrer = async () => {
    const brut = v.trim().replace(/\s/g, '').replace(',', '.');
    const valeur = brut === '' ? null : Number(brut);
    if (brut !== '' && !Number.isFinite(valeur)) { toast.error('Valeur numérique attendue.'); setV(fmt(actuelle)); return; }
    if ((valeur ?? null) === (actuelle ?? null)) return;
    try { await api.put(`/programmation/indicateurs/${indicateur.id}/valeurs`, { annee, type, valeur }); onSaved(); } catch (e) { toast.error(e.response?.data?.error?.message || 'Enregistrement impossible.'); setV(fmt(actuelle)); }
  };
  if (!editable) return <span className="tabular-nums">{fmt(actuelle) || '—'}</span>;
  return <input className="input w-20 px-1 py-0.5 text-right tabular-nums" value={v} onChange={(e) => setV(e.target.value)} onBlur={enregistrer} aria-label={`${type === 'CIBLE' ? 'Cible' : 'Réalisation'} ${annee}`} />;
}

function TableauObjectifs({ objectifs, A, droits, reload, onIndicateur }) {
  const real = [A - 4, A - 3, A - 2];
  const cibles = [A, A + 1, A + 2];
  if (!objectifs.length) return <Empty message="Aucun objectif." />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase text-slate-500"><th className="py-2 pr-2 text-left">Indicateur</th><th className="pr-2 text-left">Unité</th><th colSpan={3} className="text-center">Réalisations</th><th className="text-center">En cours</th><th colSpan={3} className="text-center">Cibles</th></tr>
          <tr className="border-b text-xs text-slate-500"><th /><th />{real.map((a) => <th key={a} className="px-1">{a}</th>)}<th className="px-1">{A - 1} (S1)</th>{cibles.map((a) => <th key={a} className="px-1">{a}</th>)}</tr>
        </thead>
        <tbody>
          {objectifs.map((o, oi) => [
            <tr key={`o${o.id}`} className="bg-slate-50"><td colSpan={9} className="px-2 py-1.5 font-semibold text-dep-800">Objectif {oi + 1} : {o.libelle}{droits.saisir && <button type="button" className="ml-3 text-xs font-normal text-dep-700 hover:underline" onClick={() => onIndicateur({ objectif_id: o.id, libelle: '', unite: '%', mode_calcul: '', source: '', commentaire: '', sens: 'HAUSSE' })}>+ indicateur</button>}</td></tr>,
            ...o.indicateurs.map((i) => (
              <tr key={i.id} className="border-b border-slate-100">
                <td className="max-w-sm py-1.5 pr-2"><button type="button" disabled={!droits.saisir} className="text-left" onClick={() => onIndicateur(i)}>{i.libelle}</button>{i.source && <div className="text-xs text-slate-500">Source : {i.source}</div>}</td>
                <td className="pr-2">{i.unite}</td>
                {real.map((a) => <td key={a} className="px-1 text-right"><Valeur indicateur={i} annee={a} type="REALISATION" editable={droits.suivre} onSaved={reload} /></td>)}
                <td className="px-1 text-right"><Valeur indicateur={i} annee={A - 1} type="REALISATION_S1" editable={droits.suivre} onSaved={reload} /></td>
                {cibles.map((a) => <td key={a} className="px-1 text-right"><Valeur indicateur={i} annee={a} type="CIBLE" editable={droits.saisir} onSaved={reload} /></td>)}
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

/** Cadre de performance : objectifs du Ministère et des programmes, indicateurs, réalisations et cibles. */
export default function Performance({ annee }) {
  const state = useApi(`/programmation/cadre?annee=${annee}`, [annee]);
  const [edition, setEdition] = useState(null);
  const enregistrer = async () => {
    const { kind, id, ...b } = edition;
    const url = kind === 'objectif' ? '/programmation/objectifs' : '/programmation/indicateurs';
    await runAction(() => (id ? api.put(`${url}/${id}`, b) : api.post(url, b)), 'Cadre de performance mis à jour.');
    setEdition(null); state.reload();
  };
  const champ = (k, label) => <Field label={label}><input className="input" value={edition[k] ?? ''} onChange={(e) => setEdition({ ...edition, [k]: e.target.value })} /></Field>;
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>Les cibles sont fixées par le Bureau Programme et la Division Programme et Suivi ; les réalisations sont saisies par le Bureau Suivi-Évaluation. Colonnes du PAP {annee} : réalisations {annee - 4} à {annee - 2}, exercice en cours {annee - 1}, cibles {annee} à {annee + 2}.</InfoAlert>
          <Card title="Objectifs les plus représentatifs du Ministère" actions={d.droits.saisir && <button type="button" className="btn-secondary" onClick={() => setEdition({ kind: 'objectif', programme_id: null, libelle: '' })}><Plus size={14} /> Objectif</button>}>
            <TableauObjectifs objectifs={d.objectifsMinistere} A={annee} droits={d.droits} reload={state.reload} onIndicateur={(i) => setEdition({ kind: 'indicateur', ...i })} />
          </Card>
          {d.programmes.map((p) => (
            <Card key={p.id} title={`Programme ${p.code} : ${p.libelle}`} actions={d.droits.saisir && <button type="button" className="btn-secondary" onClick={() => setEdition({ kind: 'objectif', programme_id: p.id, libelle: '' })}><Plus size={14} /> Objectif</button>}>
              <TableauObjectifs objectifs={p.objectifs} A={annee} droits={d.droits} reload={state.reload} onIndicateur={(i) => setEdition({ kind: 'indicateur', ...i })} />
            </Card>
          ))}
          {edition && (
            <Modal open title={edition.kind === 'objectif' ? 'Objectif' : 'Indicateur'} onClose={() => setEdition(null)} footer={<><button type="button" className="btn-secondary" onClick={() => setEdition(null)}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}>Enregistrer</button></>}>
              <div className="grid gap-3">
                {edition.kind === 'objectif' ? champ('libelle', 'Libellé') : (
                  <>
                    {champ('libelle', 'Indicateur')}
                    <div className="grid grid-cols-2 gap-3">{champ('unite', 'Unité de mesure')}<Field label="Sens"><select className="input" value={edition.sens} onChange={(e) => setEdition({ ...edition, sens: e.target.value })}><option value="HAUSSE">À la hausse</option><option value="BAISSE">À la baisse</option></select></Field></div>
                    {champ('mode_calcul', 'Mode de calcul')}{champ('source', 'Source')}
                    <Field label="Commentaires"><textarea className="input" rows={3} value={edition.commentaire || ''} onChange={(e) => setEdition({ ...edition, commentaire: e.target.value })} /></Field>
                  </>
                )}
              </div>
            </Modal>
          )}
        </div>
      )}
    </Loadable>
  );
}

export { Valeur };
