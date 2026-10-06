import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, FilePlus2, Lock, Save, Send, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, StatusBadge, KeyValues, InfoAlert, Badge, runAction, useConfirm, Button, WorkflowPanel, UnsavedChangesGuard, ZoneDefilante } from '../../components/ui';
import { ExportButtons, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { JOURS, PRESENCES } from '../../lib/labels';
import { circuitPresence } from '../../lib/workflows';

export default function PresenceSheet() {
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useApi(`/presences/${id}`);
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (state.data) { setRows(state.data.entries.map((e) => ({ ...e }))); setDirty(false); } }, [state.data]);
  const set = (i, k, v) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x))); setDirty(true); };
  const save = async () => {
    const r = await runAction(() => api.put(`/presences/${id}/entries`, { entries: rows.map((e) => ({ agent_id: e.agent_id, ...Object.fromEntries(JOURS.map((j) => [j, e[j]])), observation: e.observation || null })) }), 'Présences enregistrées.');
    state.setData({ ...state.data, ...r.data, actions: state.data.actions });
    state.reload();
  };
  const step = async (path, msg, opts) => {
    if (opts && !(await confirm(opts))) return;
    await runAction(() => api.post(`/presences/${id}/${path}`), msg);
    state.reload();
  };
  const rectif = async () => {
    const motif = await confirm({ title: 'Créer un rectificatif', message: 'Un rectificatif lié à cette liste va être créé (copie modifiable). La liste originale reste inchangée.', input: { label: 'Motif de la rectification', required: true } });
    if (!motif) return;
    const r = await runAction(() => api.post(`/presences/${id}/rectificatif`, { motif }), 'Rectificatif créé.');
    navigate(`/presences/${r.data.id}`);
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Supprimer le brouillon', message: 'Supprimer définitivement ce brouillon ?', danger: true }))) return;
    await runAction(() => api.delete(`/presences/${id}`), 'Brouillon supprimé.');
    setDirty(false);
    navigate('/presences');
  };
  return (
    <Loadable state={state}>
      {(s) => {
        const edit = s.actions.modifier;
        return (
          <>
            <PageHeader title={`Liste de présence — Semaine ${s.numero_semaine}`} subtitle={`${s.reference} · du ${fmtDate(s.semaine_debut)} au ${fmtDate(s.semaine_fin)}`} breadcrumb={[{ label: 'Présences', to: '/presences' }, { label: s.reference }]}
              actions={<>
                <ExportButtons base={`/presences/${id}/export`} />
                {edit && <Button variant="primary" icon={Save} disabled={!dirty} onClick={save}>Enregistrer</Button>}
              </>} />
            <UnsavedChangesGuard when={dirty} />
            <WorkflowPanel circuit={circuitPresence(s)}
              attente={s.statut === 'VERROUILLEE' ? 'Liste réceptionnée et verrouillée.' : s.statut === 'SOUMISE' ? 'Liste soumise : en attente de réception par le Directeur.' : null}
              message={dirty
                ? <InfoAlert tone="warning">Modifications non enregistrées. Enregistrez avant de vérifier ou de soumettre.</InfoAlert>
                : ['SOUMISE', 'VERROUILLEE'].includes(s.statut) && <InfoAlert>Liste {s.statut === 'SOUMISE' ? 'soumise (verrouillée en écriture)' : 'verrouillée'} : toute correction doit passer par un rectificatif.</InfoAlert>}
              actions={[
                s.actions.verifier && <Button key="ve" icon={CheckCircle2} disabled={dirty} onClick={() => step('verifier', 'Liste vérifiée.')}>Vérifier</Button>,
                s.actions.soumettre && <Button key="so" variant="success" icon={Send} disabled={dirty} onClick={() => step('soumettre', 'Liste soumise au Directeur.', { title: 'Soumettre au Directeur', message: 'Après soumission, la liste sera verrouillée : aucune modification ne sera plus possible (seul un rectificatif le permettra).' })}>Soumettre au Directeur</Button>,
                s.actions.verrouiller && <Button key="vr" variant="primary" icon={Lock} onClick={() => step('verrouiller', 'Liste verrouillée.')}>Réceptionner et verrouiller</Button>,
                s.actions.rectifier && <Button key="rc" icon={FilePlus2} onClick={rectif}>Établir un rectificatif</Button>,
                s.actions.supprimer && <Button key="su" variant="ghost" icon={Trash2} className="text-red-700" onClick={remove}>Supprimer le brouillon</Button>,
              ]} />
            <div className="grid gap-4 lg:grid-cols-4">
              <Card title="Informations" className="lg:col-span-3">
                <KeyValues cols={3} items={[
                  ['Statut', <StatusBadge key="s" value={s.statut} />],
                  ['Structure', s.structure_type === 'DIRECTION' ? 'Direction (toutes structures)' : `${s.bureau_nom}${s.est_secretariat_direction ? ' — Bureau directement rattaché au Directeur' : s.division_nom ? ` — ${s.division_nom}` : ''}`],
                  ['Établie par', s.createur],
                  ['Vérifiée le', fmtDateTime(s.verified_at)], ['Soumise le', fmtDateTime(s.submitted_at)], ['Verrouillée le', fmtDateTime(s.locked_at)],
                  s.est_rectificatif && ['Rectificatif de', s.original && <Link key="o" className="link" to={`/presences/${s.original.id}`}>{s.original.reference}</Link>],
                  s.est_rectificatif && ['Motif', s.motif_rectification],
                  s.rectificatifs.length > 0 && ['Rectificatifs', <span key="r" className="flex flex-wrap gap-1">{s.rectificatifs.map((r) => <Link key={r.id} to={`/presences/${r.id}`}><Badge tone="orange">{r.reference}</Badge></Link>)}</span>],
                ]} />
              </Card>
              <Card title="Totaux (agent-jours)">
                <ul className="space-y-1 text-sm">{Object.entries(PRESENCES).map(([k, [l, c, cls]]) => <li key={k} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className={`inline-flex w-7 justify-center rounded text-xs font-semibold ${cls}`}>{c}</span>{l}</span><b className="tabular-nums">{s.totaux[k] || 0}</b></li>)}</ul>
              </Card>
            </div>
            <Card className="mt-4" bodyClass="p-0">
              <ZoneDefilante label="Grille des présences">
                <table className="min-w-full">
                  <thead><tr><th className="th">N°</th><th className="th">Agent</th>{JOURS.map((j) => <th key={j} className="th text-center capitalize">{j}</th>)}<th className="th">Observation</th></tr></thead>
                  <tbody>
                    {rows.map((e, i) => (
                      <tr key={e.id}>
                        <td className="td text-slate-500">{i + 1}</td>
                        <td className="td whitespace-nowrap"><div className="font-medium">{[e.nom, e.postnom, e.prenom].filter(Boolean).join(' ')}</div><div className="text-xs text-slate-500">{e.matricule} · {e.grade}</div></td>
                        {JOURS.map((j) => (
                          <td key={j} className="td text-center">
                            {edit ? (
                              <select aria-label={`${j} — ${e.nom}`} className={`rounded border-0 px-1 py-1 text-xs font-semibold ${PRESENCES[e[j]][2]}`} value={e[j]} onChange={(ev) => set(i, j, ev.target.value)}>
                                {Object.entries(PRESENCES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                              </select>
                            ) : <span className={`inline-flex min-w-[2rem] justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${PRESENCES[e[j]][2]}`} title={PRESENCES[e[j]][0]}>{PRESENCES[e[j]][1]}</span>}
                          </td>
                        ))}
                        <td className="td">{edit ? <input className="input py-1 text-xs" value={e.observation || ''} onChange={(ev) => set(i, 'observation', ev.target.value)} /> : <span className="text-xs">{e.observation}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ZoneDefilante>
              <p className="border-t px-3 py-2 text-xs text-slate-500">Légende : P = Présent · A = Absent · R = Retard · C = Congé · M = Mission · MA = Maladie</p>
            </Card>
            <Card title="Historique" className="mt-4 no-print"><Timeline items={s.historique} /></Card>
          </>
        );
      }}
    </Loadable>
  );
}
