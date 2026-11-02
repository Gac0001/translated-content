import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Lock, Send, Undo2, X } from 'lucide-react';
import api from '../../lib/api';
import {
  useApi, Loadable, PageHeader, Card, Button, InfoAlert, Alert, SimpleTable, WorkflowPanel, Modal, Field, KeyValues, runAction, useConfirm,
} from '../../components/ui';
import { ExportButtons, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { circuitPresence } from '../../lib/workflows';
import { StatutSemaine, StatutListe, StatutRectificatif, MOTIFS, resumeBilan } from './commun';

const valeur = (x) => (x.motif ? MOTIFS[x.motif] : [x.heure_arrivee, x.heure_depart].filter(Boolean).join(' – ') || '—');

/** Détail d’un rectificatif : valeurs avant et après, décision du Directeur. */
function Rectificatif({ id, onClose, onDecision }) {
  const state = useApi(`/presences/rectificatifs/${id}`, [id]);
  const [commentaire, setCommentaire] = useState('');
  const decider = async (decision) => {
    await runAction(() => api.post(`/presences/rectificatifs/${id}/decision`, { decision, commentaire: commentaire || null }), decision === 'VALIDE' ? 'Rectificatif validé.' : 'Rectificatif refusé.');
    onDecision();
  };
  return (
    <Modal open title="Rectificatif de présence" onClose={onClose} size="lg"
      footer={state.data?.actions.decider ? <>
        <Button variant="ghost" onClick={onClose}>Fermer</Button>
        <Button variant="danger" icon={X} disabled={commentaire.trim().length < 3} onClick={() => decider('REFUSE')}>Refuser</Button>
        <Button variant="primary" icon={Check} onClick={() => decider('VALIDE')}>Valider</Button>
      </> : <Button variant="secondary" onClick={onClose}>Fermer</Button>}>
      <Loadable state={state}>
        {(r) => (
          <div className="space-y-3">
            <KeyValues items={[
              ['Référence', r.reference], ['Statut', <StatutRectificatif key="s" value={r.statut} />],
              ['Liste', `${r.liste.categorie === 'CADRES' ? 'Cadres' : 'Agents'} du ${fmtDate(r.liste.date)}`], ['Proposé le', fmtDateTime(r.cree_at)],
              ['Motif', r.motif], r.decide_at && ['Décision', `${fmtDateTime(r.decide_at)}${r.commentaire_decision ? ` — ${r.commentaire_decision}` : ''}`],
            ].filter(Boolean)} />
            <SimpleTable label="Lignes rectifiées" dense rowKey="agent_id" rows={r.lignes} columns={[
              { key: 'nom', header: 'Agent', render: (x) => x.nom_complet },
              { key: 'avant', header: 'Avant', render: (x) => valeur(x.avant) },
              { key: 'apres', header: 'Après', render: (x) => <b>{valeur(x)}</b> },
              { key: 'obs', header: 'Observation', render: (x) => x.observation || '—' },
            ]} />
            {r.actions.decider && (
              <Field label="Commentaire (obligatoire pour un refus)">
                <textarea className="input" rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </Loadable>
    </Modal>
  );
}

export default function PresenceSemaine() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const state = useApi(`/presences/semaines/${id}`, [id]);
  const [rectificatif, setRectificatif] = useState(null);
  const action = async (chemin, message, opts, cle = 'commentaire') => {
    const r = await confirm(opts);
    if (!r) return;
    const corps = typeof r === 'string' ? { [cle]: r } : {};
    const res = await runAction(() => api.post(`/presences/semaines/${id}/${chemin}`, corps), message);
    state.setData(res.data);
  };
  return (
    <Loadable state={state}>
      {(s) => (
        <>
          <PageHeader title={`Rapport de présence — semaine ${s.numero_semaine}`} subtitle={`${s.reference} · du ${fmtDate(s.semaine_debut)} au ${fmtDate(s.semaine_fin)}`}
            breadcrumb={[{ label: 'Présences', to: '/presences' }, { label: s.reference }]}
            actions={<>
              <StatutSemaine value={s.statut} />
              {s.actions.exporter && <ExportButtons base={`/presences/semaines/${id}/export`} print={false} />}
            </>} />
          <WorkflowPanel circuit={circuitPresence(s)}
            attente={s.statut === 'VERROUILLE' ? `Rapport verrouillé le ${fmtDateTime(s.verrouille_at)}.` : s.statut === 'TRANSMIS' ? `Transmis le ${fmtDateTime(s.transmis_at)} : en attente du Directeur.` : null}
            message={<>
              {s.statut === 'REJETE' && <Alert tone="danger" statique title="Rapport rejeté par le Directeur">{s.motif_rejet} — établissez les rectificatifs demandés depuis les listes du jour, puis retransmettez.</Alert>}
              {s.controle.length > 0 && (
                <InfoAlert tone="warning">
                  <p className="font-medium">Le rapport pourra être transmis une fois les listes complètes :</p>
                  <ul className="mt-1 list-disc pl-5">{s.controle.slice(0, 10).map((m) => <li key={m.message}>{m.message}</li>)}</ul>
                  {s.controle.length > 10 && <p>et {s.controle.length - 10} autre(s)…</p>}
                </InfoAlert>
              )}
              {s.commentaire_verrouillage && <InfoAlert>Commentaire du Directeur : {s.commentaire_verrouillage}</InfoAlert>}
            </>}
            actions={[
              s.actions.transmettre && <Button key="t" variant="primary" icon={Send} onClick={() => action('transmettre', 'Rapport transmis au Directeur.', { title: 'Transmettre au Directeur', message: 'Les listes de la semaine seront verrouillées : toute correction passera ensuite par un rectificatif validé par le Directeur.', confirmLabel: 'Transmettre' })}>Transmettre au Directeur</Button>,
              s.actions.retransmettre && <Button key="r" variant="primary" icon={Send} onClick={() => action('retransmettre', 'Rapport retransmis.', { title: 'Retransmettre au Directeur', message: 'Les rectificatifs établis depuis le rejet accompagnent le rapport.', confirmLabel: 'Retransmettre' })}>Retransmettre</Button>,
              s.actions.verrouiller && <Button key="v" variant="success" icon={Lock} onClick={() => action('verrouiller', 'Rapport verrouillé.', { title: 'Verrouiller le rapport', message: 'Le rapport et ses listes seront verrouillés définitivement.', confirmLabel: 'Verrouiller', input: { label: 'Commentaire (facultatif)' } })}>Verrouiller</Button>,
              s.actions.rejeter && <Button key="j" variant="danger" icon={Undo2} onClick={() => action('rejeter', 'Rapport rejeté.', { title: 'Rejeter le rapport', message: 'Le Secrétariat de Direction corrigera par rectificatif puis retransmettra.', confirmLabel: 'Rejeter', danger: true, input: { label: 'Motif du rejet', required: true, min: 5 } }, 'motif')}>Rejeter</Button>,
            ]} />
          <Card title="Listes de la semaine" bodyClass="p-0">
            <SimpleTable label="Listes de la semaine" rowKey="date" rows={s.jours} onRowClick={(j) => !j.ferie && navigate(`/presences/jour/${j.date}`)}
              columns={[
                { key: 'jour', header: 'Jour', render: (j) => <span className="font-medium">{j.jour} {fmtDate(j.date)}</span> },
                ...['CADRES', 'AGENTS'].map((c) => ({
                  key: c, header: c === 'CADRES' ? 'Cadres' : 'Agents', render: (j) => {
                    if (j.ferie) return <span className="text-sm text-slate-600">Férié — {j.ferie}</span>;
                    const l = j.listes.find((x) => x.categorie === c);
                    return l?.id ? <span className="flex flex-wrap items-center gap-2 text-sm"><StatutListe value={l.statut} />{resumeBilan(l.bilan)}</span> : <span className="text-sm text-slate-600">Non établie</span>;
                  },
                })),
                { key: 'ouvrir', header: '', render: (j) => (j.ferie ? null : <Link className="link text-sm" to={`/presences/jour/${j.date}`} onClick={(e) => e.stopPropagation()}>Ouvrir</Link>) },
              ]} />
          </Card>
          {s.rectificatifs.length > 0 && (
            <Card title="Rectificatifs" className="mt-4" bodyClass="p-0">
              <SimpleTable label="Rectificatifs" rows={s.rectificatifs} onRowClick={s.actions.voir_rectificatifs ? (r) => setRectificatif(r.id) : undefined} columns={[
                { key: 'reference', header: 'Référence', render: (r) => <span className="font-medium">{r.reference}</span> },
                { key: 'liste', header: 'Liste', render: (r) => `${r.categorie === 'CADRES' ? 'Cadres' : 'Agents'} du ${fmtDate(r.date)}` },
                { key: 'motif', header: 'Motif' },
                { key: 'nb', header: 'Lignes', align: 'right', render: (r) => r.nb_lignes },
                { key: 'statut', header: 'Statut', render: (r) => <StatutRectificatif value={r.statut} /> },
              ]} />
            </Card>
          )}
          {s.historique.length > 0 && <Card title="Historique" className="mt-4 no-print"><Timeline items={s.historique} /></Card>}
          {rectificatif && <Rectificatif id={rectificatif} onClose={() => setRectificatif(null)} onDecision={() => { setRectificatif(null); state.reload(); }} />}
        </>
      )}
    </Loadable>
  );
}
