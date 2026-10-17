import { useState } from 'react';
import { Pencil } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, Card, Modal, Field, Badge, InfoAlert, runAction } from '../../components/ui';

const SITUATIONS = {
  CONFORME: ['Conforme', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  VACANCE: ['Vacance', 'bg-amber-50 text-amber-800 ring-amber-200'],
  SUREFFECTIF: ['Sureffectif', 'bg-red-50 text-red-800 ring-red-200'],
};

function ModifierReference({ ligne, source, onClose, onSaved }) {
  const [nombre, setNombre] = useState(ligne.prevu);
  const [src, setSrc] = useState(source || '');
  const enregistrer = async (e) => {
    e.preventDefault();
    await runAction(() => api.put(`/organisation/effectifs/${ligne.id}`, { nombre, source: src }), 'Effectif de référence mis à jour.');
    onSaved();
  };
  return (
    <Modal open title={`Effectif de référence — ${ligne.libelle}`} onClose={onClose}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="eff-form" className="btn-primary" disabled={src.trim().length < 5}>Enregistrer</button></>}>
      <form id="eff-form" onSubmit={enregistrer} className="space-y-3">
        <InfoAlert>La référence découle du cadre organique : ne la modifiez que sur la base d’un acte officiel. La modification est inscrite dans le journal d’audit.</InfoAlert>
        <Field label="Nombre de postes prévus" required><input type="number" min={0} max={500} className="input" value={nombre} onChange={(e) => setNombre(Number(e.target.value))} /></Field>
        <Field label="Acte ou décision de référence" required><input className="input" value={src} onChange={(e) => setSrc(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

/** Effectif organique de référence, effectif réel, écarts et postes de commandement vacants. */
export default function Effectif() {
  const state = useApi('/organisation/effectifs');
  const can = useAuth((s) => s.can);
  const [edit, setEdit] = useState(null);
  return (
    <Loadable state={state}>
      {(e) => (
        <div className="space-y-4">
          {edit && <ModifierReference ligne={edit} source={e.source} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} />}
          <InfoAlert>
            L’effectif organique de référence ({e.totaux.prevu} postes) sert de comparaison : il ne limite pas l’enregistrement des Agents réellement affectés.
            Plusieurs Agents peuvent occuper un même type de poste d’exécution. Effectif réel : Agents en activité, en congé ou suspendus ayant une affectation active, hors Secrétaire Général.
          </InfoAlert>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card><div className="text-xs text-slate-500">Effectif de référence</div><div className="text-2xl font-semibold">{e.totaux.prevu}</div></Card>
            <Card><div className="text-xs text-slate-500">Effectif réel</div><div className="text-2xl font-semibold">{e.totaux.reel}</div><div className="text-xs text-slate-500">dont {e.totaux.horsReference} hors cadre de référence</div></Card>
            <Card><div className="text-xs text-slate-500">Vacances</div><div className="text-2xl font-semibold text-amber-700">{e.totaux.vacances}</div></Card>
            <Card><div className="text-xs text-slate-500">Sureffectifs</div><div className="text-2xl font-semibold text-red-700">{e.totaux.sureffectifs}</div></Card>
          </div>
          <Card title="Comparaison par poste organique">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead><tr><th className="th">Poste organique</th><th className="th">Prévu</th><th className="th">Réel</th><th className="th">Écart</th><th className="th">Situation</th>{can('cadre.gerer') && <th className="th" />}</tr></thead>
                <tbody>
                  {e.lignes.map((l) => (
                    <tr key={l.id}>
                      <td className="td">{l.libelle}</td>
                      <td className="td">{l.prevu}</td>
                      <td className="td">{l.reel}</td>
                      <td className="td">{l.ecart > 0 ? `+${l.ecart}` : l.ecart}</td>
                      <td className="td"><Badge className={SITUATIONS[l.situation][1]}>{SITUATIONS[l.situation][0]}</Badge></td>
                      {can('cadre.gerer') && <td className="td"><button type="button" className="text-dep-700" aria-label={`Modifier la référence ${l.libelle}`} onClick={() => setEdit(l)}><Pencil size={14} /></button></td>}
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="td">Total de référence</td><td className="td">{e.totaux.prevu}</td><td className="td">{e.totaux.dansReference}</td><td className="td">{(e.totaux.dansReference - e.totaux.prevu) > 0 ? `+${e.totaux.dansReference - e.totaux.prevu}` : e.totaux.dansReference - e.totaux.prevu}</td><td className="td" />{can('cadre.gerer') && <td className="td" />}</tr>
                </tbody>
              </table>
            </div>
            {e.source && <p className="mt-2 text-xs text-slate-500">Source : {e.source}</p>}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Agents hors cadre de référence (par grade)">
              {e.horsReference.length ? (
                <ul className="space-y-1 text-sm">{e.horsReference.map((h) => <li key={h.grade} className="flex justify-between"><span>{h.grade}</span><span className="font-medium">{h.nombre}</span></li>)}</ul>
              ) : <p className="text-sm text-slate-500">Aucun.</p>}
            </Card>
            <Card title="Postes de commandement vacants">
              {e.postesVacants.length ? (
                <ul className="space-y-1 text-sm">{e.postesVacants.map((p) => <li key={p.posteId}>{p.codeOrganique && <span className="mr-2 font-mono text-xs text-slate-500">{p.codeOrganique}</span>}{p.poste}</li>)}</ul>
              ) : <p className="text-sm text-slate-500">Tous les postes de commandement ont un titulaire.</p>}
            </Card>
          </div>
        </div>
      )}
    </Loadable>
  );
}
