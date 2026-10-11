import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, CheckCircle2, ClipboardCheck, FileDown, Pencil, Plus, Send, Trash2, Undo2, Users } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, Badge, InfoAlert, Field, Button, WorkflowPanel, ActionBar, EmptyState, runAction, toast, useConfirm, ConfidBadge } from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { circuitReunion } from '../../lib/workflows';
import { NIVEAUX_REUNION } from './ReunionsList';

const PRESENCES = { PRESENT: 'Présent', ABSENT: 'Absent', EXCUSE: 'Excusé', REPRESENTE: 'Représenté' };
const nomParticipant = (p) => p.nom || `${p.nom_externe}${p.qualite_externe ? ` — ${p.qualite_externe}` : ''}`;

function Presences({ reunion, onSaved }) {
  const [lignes, setLignes] = useState(reunion.participants.map((p) => ({ id: p.id, presence: p.presence || 'PRESENT', represente_par: p.represente_par || '' })));
  const [enCours, setEnCours] = useState(false);
  const enregistrer = async () => {
    setEnCours(true);
    try { await runAction(() => api.put(`/reunions/${reunion.id}/presences`, { presences: lignes }), 'Présence enregistrée.'); onSaved(); } catch { /* erreur déjà signalée */ } finally { setEnCours(false); }
  };
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {reunion.participants.map((p, i) => (
          <li key={p.id} className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center">
            <span className="flex-1">{nomParticipant(p)}</span>
            <select className="input sm:w-40" value={lignes[i].presence} onChange={(e) => setLignes(lignes.map((x, j) => (j === i ? { ...x, presence: e.target.value } : x)))} aria-label={`Présence de ${nomParticipant(p)}`}>
              {Object.entries(PRESENCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {lignes[i].presence === 'REPRESENTE' && <input className="input sm:w-48" placeholder="Représenté par" aria-label={`Représentant de ${nomParticipant(p)}`} value={lignes[i].represente_par} onChange={(e) => setLignes(lignes.map((x, j) => (j === i ? { ...x, represente_par: e.target.value } : x)))} />}
          </li>
        ))}
      </ul>
      <button type="button" className="btn-secondary mt-3" disabled={enCours} onClick={enregistrer}><ClipboardCheck size={16} aria-hidden /> {enCours ? 'Enregistrement…' : 'Enregistrer la présence'}</button>
    </div>
  );
}

/** Rédaction du compte rendu et des décisions (projets jusqu’à la validation par le président). */
function CompteRendu({ reunion, onSaved }) {
  const invitables = useApi('/reunions/invitables');
  const initial = useMemo(() => ({
    texte: reunion.compte_rendu || '',
    decisions: reunion.decisions.filter((d) => d.statut === 'PROJET').map((d) => ({ libelle: d.libelle, responsable_user_id: String(d.responsable_user_id), echeance: d.echeance || '', resultat_attendu: d.resultat_attendu || '' })),
  }), [reunion.compte_rendu, reunion.decisions]);
  const [texte, setTexte] = useState(initial.texte);
  const [decisions, setDecisions] = useState(initial.decisions);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { setTexte(initial.texte); setDecisions(initial.decisions); }, [initial]);
  const modifie = JSON.stringify({ texte, decisions }) !== JSON.stringify(initial);
  const maj = (i, k, v) => setDecisions(decisions.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const enregistrer = async () => {
    if (decisions.some((d) => d.libelle.trim() && !d.responsable_user_id)) throw new Error('Chaque décision doit avoir un responsable.');
    setEnCours(true);
    try {
      await runAction(() => api.put(`/reunions/${reunion.id}/compte-rendu`, {
      compte_rendu: texte,
      decisions: decisions.filter((d) => d.libelle.trim() && d.responsable_user_id).map((d) => ({ libelle: d.libelle.trim(), responsable_user_id: Number(d.responsable_user_id), echeance: d.echeance || null, resultat_attendu: d.resultat_attendu.trim() || null })),
      }), 'Compte rendu enregistré.');
    } finally { setEnCours(false); }
    onSaved();
  };
  return (
    <div className="space-y-4">
      <Field label="Compte rendu" hint="Déroulement, échanges et conclusions, point par point de l’ordre du jour."><textarea className="input" rows={10} value={texte} onChange={(e) => setTexte(e.target.value)} /></Field>
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Décisions</span><button type="button" className="btn-secondary" onClick={() => setDecisions([...decisions, { libelle: '', responsable_user_id: '', echeance: '', resultat_attendu: '' }])}><Plus size={16} aria-hidden /> Décision</button></div>
        {!decisions.length && <p className="text-sm text-slate-500">Aucune décision.</p>}
        <div className="space-y-3">
          {decisions.map((d, i) => (
            <fieldset key={i} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-6">
              <legend className="sr-only">Décision {i + 1}</legend>
              <input className="input sm:col-span-6" placeholder="Décision" aria-label={`Décision ${i + 1}`} value={d.libelle} onChange={(e) => maj(i, 'libelle', e.target.value)} />
              <select className="input sm:col-span-3" value={d.responsable_user_id} onChange={(e) => maj(i, 'responsable_user_id', e.target.value)} aria-label="Responsable">
                <option value="">— Responsable —</option>
                {(invitables.data?.data || []).map((n) => <option key={n.userId} value={n.userId}>{n.nomComplet} — {n.roleLibelle}</option>)}
              </select>
              <input type="date" className="input sm:col-span-2" value={d.echeance} onChange={(e) => maj(i, 'echeance', e.target.value)} aria-label="Échéance" />
              <button type="button" className="rounded p-2 text-red-600 hover:bg-red-50" aria-label="Retirer la décision" onClick={() => setDecisions(decisions.filter((_, j) => j !== i))}><Trash2 size={16} aria-hidden /></button>
              <input className="input sm:col-span-6" placeholder="Résultat attendu (facultatif)" aria-label="Résultat attendu" value={d.resultat_attendu} onChange={(e) => maj(i, 'resultat_attendu', e.target.value)} />
            </fieldset>
          ))}
        </div>
      </div>
      <ActionBar dirty={modifie} saving={enCours} onSave={enregistrer} saveLabel="Enregistrer le compte rendu" />
    </div>
  );
}

export default function ReunionDetail() {
  const { id } = useParams();
  const state = useApi(`/reunions/${id}`, [id]);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const post = async (path, body, msg) => { await runAction(() => api.post(`/reunions/${id}/${path}`, body), msg).catch(() => null); state.reload(); };
  const avecMotif = async (opts, path, cle, msg) => { const t = await confirm({ ...opts, input: { label: opts.label, required: true } }); if (t) post(path, { [cle]: t }, msg); };
  return (
    <Loadable state={state}>
      {(r) => {
        const a = r.actions;
        const attente = {
          BROUILLON: 'En préparation : vérifiez l’ordre du jour et les participants, puis envoyez les convocations.',
          CONVOQUEE: 'Convocations envoyées : après la séance, déclarez la réunion tenue pour en rédiger le compte rendu.',
          TENUE: `Compte rendu en rédaction${r.redacteur_nom ? ` par ${r.redacteur_nom}` : ''}.`,
          CR_A_VALIDER: `Compte rendu soumis à ${r.president_nom}.`,
          CLOTUREE: 'Réunion clôturée : compte rendu verrouillé, décisions inscrites au registre.',
          ANNULEE: 'Réunion annulée.',
        }[r.statut];
        return (
          <>
            <PageHeader title={r.objet} subtitle={`${r.reference} · ${fmtDateTime(r.debut)}${r.lieu ? ` · ${r.lieu}` : ''}`} breadcrumb={[{ label: 'Réunions', to: '/reunions' }, { label: r.reference }]}
              actions={a.modifier && <Link to={`/reunions/${id}/modifier`} className="btn-secondary"><Pencil size={16} aria-hidden /> {r.statut === 'CONVOQUEE' ? 'Modifier ou reporter' : 'Modifier'}</Link>}
              menu={[
                can('exports.generer') && r.statut !== 'BROUILLON' && { label: r.statut === 'CLOTUREE' ? 'Compte rendu PDF' : 'Convocation PDF', icon: FileDown, onClick: () => download(`/reunions/${id}/pdf`).catch((e) => toast.error(errorMessage(e))) },
                a.annuler && { label: 'Annuler la réunion', icon: Ban, danger: true, onClick: () => avecMotif({ title: 'Annuler la réunion', message: 'Les participants seront prévenus ; l’agenda du Directeur suit.', label: 'Motif de l’annulation (communiqué aux participants)', confirmLabel: 'Annuler la réunion', danger: true }, 'annuler', 'motif', 'Réunion annulée.') },
              ]} />
            <WorkflowPanel circuit={circuitReunion(r)} attente={attente}
              message={(r.statut === 'ANNULEE' && <InfoAlert tone="warning"><b>Réunion annulée</b> : {r.motif_annulation}</InfoAlert>)
                || (r.statut === 'TENUE' && r.observations_president && <InfoAlert tone="warning"><b>Observations du président</b> : {r.observations_president}</InfoAlert>)
                || (r.statut === 'CR_A_VALIDER' && a.president && <InfoAlert>Le compte rendu vous est soumis : validez-le pour inscrire ses décisions au registre, ou retournez-le avec vos observations.</InfoAlert>)}
              actions={[
                a.convoquer && <Button key="co" variant="primary" icon={Send} onClick={() => post('convoquer', {}, 'Convocations envoyées.')}>Convoquer</Button>,
                a.tenue && <Button key="te" variant="primary" icon={Users} onClick={() => post('tenue', {}, 'Réunion tenue : rédigez le compte rendu.')}>Réunion tenue</Button>,
                a.soumettre && <Button key="so" variant="primary" icon={Send} onClick={() => post('soumettre-cr', {}, 'Compte rendu soumis au président.')}>Soumettre au président</Button>,
                a.validerCr && <Button key="va" variant="success" icon={CheckCircle2} onClick={async () => { if (await confirm({ title: 'Valider le compte rendu', message: `Le compte rendu sera verrouillé et ses ${r.decisions.length} décision(s) inscrite(s) au registre, notifiées à leurs responsables.`, confirmLabel: 'Valider' })) post('valider-cr', {}, 'Compte rendu validé : décisions inscrites au registre.'); }}>Valider le compte rendu</Button>,
                a.retournerCr && <Button key="re" icon={Undo2} onClick={() => avecMotif({ title: 'Retourner le compte rendu', message: 'Le compte rendu sera renvoyé à son rédacteur.', label: 'Observations pour le rédacteur', confirmLabel: 'Retourner', danger: true }, 'retourner-cr', 'observations', 'Compte rendu retourné au rédacteur.')}>Retourner</Button>,
              ]} />
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Réunion" className="lg:col-span-2">
                <KeyValues items={[
                  ['Statut', <StatusBadge key="s" value={r.statut} />], ['Niveau', <Badge key="n">{NIVEAUX_REUNION[r.niveau]}</Badge>],
                  ['Début', fmtDateTime(r.debut)], ['Fin', fmtDateTime(r.fin)], ['Lieu', r.lieu || '—'], ['Confidentialité', <ConfidBadge key="c" value={r.confidentialite} />],
                  ['Président', r.president_nom], ['Organisateur', r.organisateur_nom], ['Rédacteur du compte rendu', r.redacteur_nom || '—'],
                  r.cr_valide_at && ['Compte rendu validé le', fmtDateTime(r.cr_valide_at)],
                ]} />
                <div className="mt-4 text-xs font-medium uppercase text-slate-500">Ordre du jour</div>
                {r.ordre_du_jour.length ? <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{r.ordre_du_jour.map((p, i) => <li key={i}>{p.titre}{p.rapporteur && <span className="text-slate-500"> — {p.rapporteur}</span>}</li>)}</ol> : <p className="mt-1 text-sm text-slate-500">Ordre du jour non renseigné.</p>}
              </Card>
              <Card title={`Participants (${r.participants.length})`}>
                {a.presences ? <Presences reunion={r} onSaved={state.reload} /> : (
                  <ul className="space-y-1 text-sm">{r.participants.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{nomParticipant(p)}</span>{p.presence && <span className="text-xs text-slate-500">{PRESENCES[p.presence]}{p.represente_par ? ` (${p.represente_par})` : ''}</span>}</li>)}</ul>
                )}
              </Card>
              <Card title="Compte rendu et décisions" className="lg:col-span-2">
                {a.compteRendu ? <CompteRendu reunion={r} onSaved={state.reload} /> : (
                  <>
                    {r.compte_rendu ? <p className="whitespace-pre-line text-sm">{r.compte_rendu}</p> : <EmptyState compact title="Pas encore de compte rendu">{['BROUILLON', 'CONVOQUEE'].includes(r.statut) ? 'Le compte rendu et les décisions se rédigent après la tenue de la réunion.' : 'Aucun compte rendu n’a été rédigé.'}</EmptyState>}
                    {r.decisions.length > 0 && (
                      <ul className="mt-4 space-y-2 border-t pt-3 text-sm">
                        {r.decisions.map((d) => (
                          <li key={d.id} className="flex flex-wrap items-center gap-2">
                            {d.statut === 'PROJET' ? <span className="font-medium">{d.libelle}</span> : <Link to={`/decisions/${d.id}`} className="link font-medium">{d.reference} — {d.libelle}</Link>}
                            <span className="text-xs text-slate-500">→ {d.responsable_nom}{d.echeance ? `, échéance ${fmtDate(d.echeance)}` : ''}</span>
                            <StatusBadge value={d.statut} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Card>
              <Card title="Annexes"><Attachments type="REUNION" id={id} canUpload={a.rediger && r.statut !== 'CLOTUREE' && r.statut !== 'ANNULEE'} /></Card>
              <Card title="Historique" className="lg:col-span-3"><Timeline items={r.historique} /></Card>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
