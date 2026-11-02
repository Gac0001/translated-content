import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Clock, FilePen, Paperclip, X } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import {
  useApi, Loadable, PageHeader, Card, Button, IconButton, EmptyState, InfoAlert, SimpleTable, UnsavedChangesGuard, runAction, toast, useConfirm,
} from '../../components/ui';
import { FormulaireEtapes, PageControle } from '../../components/FormulaireEtapes';
import { aujourdhui, fmtDate } from '../../lib/format';
import { EtatPresence, StatutListe, StatutSemaine, MOTIFS, etatLigne, retard, jourOuvrable, resumeBilan } from './commun';

const champs = (l) => ({ agent_id: l.agent_id, heure_arrivee: l.heure_arrivee || '', heure_depart: l.heure_depart || '', motif: l.motif || '', piece_id: l.piece_id || null, observation: l.observation || '' });
const identique = (a, b) => ['heure_arrivee', 'heure_depart', 'motif', 'piece_id', 'observation'].every((k) => (a[k] || '') === (b[k] || ''));

/** Pièce justificative d’une absence : dépôt en un clic, téléchargement, retrait du lien. */
function Piece({ liste, ligne, pieces, editable, onChange, onDepot }) {
  const ref = useRef();
  const piece = pieces.find((p) => p.id === ligne.piece_id);
  const deposer = async (fichier) => {
    if (!fichier) return;
    const fd = new FormData();
    fd.append('fichiers', fichier);
    try {
      const r = await api.post(`/attachments/PRESENCE_LISTE/${liste.id}`, fd);
      onDepot();
      onChange(r.data.data[0].id);
      toast.success('Pièce jointe déposée.');
    } catch (e) { toast.error(errorMessage(e)); } finally { if (ref.current) ref.current.value = ''; }
  };
  if (piece) {
    return (
      <span className="inline-flex max-w-[11rem] items-center gap-1">
        <button type="button" className="link truncate text-xs" onClick={() => download(`/attachments/fichier/${piece.id}`, piece.original_name).catch((e) => toast.error(errorMessage(e)))}>{piece.original_name}</button>
        {editable && <IconButton label={`Retirer la pièce de ${ligne.nom_complet}`} icon={X} size={14} className="p-0.5 text-slate-500" onClick={() => onChange(null)} />}
      </span>
    );
  }
  if (!editable || !ligne.motif) return <span className="text-xs text-slate-500">—</span>;
  return (
    <>
      <input ref={ref} type="file" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => deposer(e.target.files?.[0])} />
      <IconButton label={`Joindre une pièce pour ${ligne.nom_complet}`} icon={Paperclip} size={15} className="p-1 text-dep-700" onClick={() => ref.current?.click()} />
    </>
  );
}

/** Grille d’une liste (Cadres ou Agents) au format de l’annexe 11 : regroupement par structure, H-A, H-D ou motif. */
function Grille({ liste, valeurs, editable, onChange, peutVoirPieces }) {
  const pieces = useApi(peutVoirPieces ? `/attachments/PRESENCE_LISTE/${liste.id}` : null, [liste.id, peutVoirPieces]);
  const rows = liste.lignes.map((l) => ({ ...l, ...(valeurs[l.agent_id] || {}) }));
  const maj = (agentId, patch) => onChange(agentId, patch);
  const premier = new Set(rows.filter((r, i) => i === 0 || rows[i - 1].structure_code !== r.structure_code).map((r) => r.agent_id));
  const nom = (r) => r.nom_complet;
  return (
    <SimpleTable label={`Liste des ${liste.categorie_libelle}`} dense rowKey="agent_id" rows={rows} empty="Aucun agent dans cette catégorie."
      rowClassName={(r) => (premier.has(r.agent_id) ? 'border-t-2 border-t-dep-200' : '')}
      columns={[
        { key: 'n', header: 'N°', render: (r, i) => i + 1, className: 'w-10 text-slate-600' },
        { key: 'nom', header: 'Nom, postnom et prénom', rowHeader: true, render: (r) => <span className="whitespace-nowrap font-medium">{r.nom_complet}{r.rectifiee && <span className="ml-1 text-xs text-orange-700" title={`Rectifié : ${r.rectifiee}`}>*</span>}</span> },
        { key: 'structure', header: 'Structure', render: (r) => (premier.has(r.agent_id) ? <span className="whitespace-nowrap text-xs"><b>{r.structure_code}</b> {r.structure_libelle}</span> : <span className="sr-only">{r.structure_code}</span>) },
        { key: 'grade', header: 'Grade', render: (r) => r.grade_code || '—' },
        {
          key: 'ha', header: 'H-A', render: (r) => (editable && !r.motif
            ? <input type="time" className="input w-[8rem] py-1" aria-label={`H-A, ${nom(r)}`} value={r.heure_arrivee || ''} onChange={(e) => maj(r.agent_id, { heure_arrivee: e.target.value })} />
            : <span className={r.retard_minutes > 0 && !r.motif ? 'font-semibold text-amber-800' : ''}>{r.motif ? '' : r.heure_arrivee || '—'}</span>),
        },
        {
          key: 'hd', header: 'H-D', render: (r) => (editable && !r.motif
            ? <input type="time" className="input w-[8rem] py-1" aria-label={`H-D, ${nom(r)}`} value={r.heure_depart || ''} onChange={(e) => maj(r.agent_id, { heure_depart: e.target.value })} />
            : <span>{r.motif ? '' : r.heure_depart || '—'}</span>),
        },
        {
          key: 'motif', header: 'Motif d’absence', render: (r) => (editable
            ? (
              <select className="input w-auto py-1" aria-label={`Motif d’absence, ${nom(r)}`} value={r.motif || ''}
                onChange={(e) => maj(r.agent_id, e.target.value ? { motif: e.target.value, heure_arrivee: '', heure_depart: '' } : { motif: '', piece_id: null })}>
                <option value="">Présent</option>
                {Object.entries(MOTIFS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            ) : <span>{r.motif ? MOTIFS[r.motif] : '—'}</span>),
        },
        { key: 'piece', header: 'Pièce', render: (r) => <Piece liste={liste} ligne={r} pieces={pieces.data?.data || []} editable={editable} onChange={(id) => maj(r.agent_id, { piece_id: id })} onDepot={pieces.reload} /> },
        {
          key: 'obs', header: 'Observation', render: (r) => (editable
            ? <input className="input min-w-[9rem] py-1" aria-label={`Observation, ${nom(r)}`} value={r.observation || ''} maxLength={500} onChange={(e) => maj(r.agent_id, { observation: e.target.value })} />
            : <span className="text-xs">{r.observation || ''}</span>),
        },
        { key: 'etat', header: 'État', render: (r) => <EtatPresence value={etatLigne(r)} /> },
      ]} />
  );
}

export default function PresenceJour() {
  const params = useParams();
  const date = params.date || aujourdhui();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const state = useApi(`/presences/jour/${date}`, [date]);
  const [valeurs, setValeurs] = useState({}); // { listeId: { agentId: champs } }
  const [rectif, setRectif] = useState(null); // id de la liste en cours de rectification
  const [etape, setEtape] = useState(0);
  const [enregistrement, setEnregistrement] = useState(false);

  const listes = useMemo(() => state.data?.listes || [], [state.data]);
  useEffect(() => {
    setValeurs(Object.fromEntries(listes.map((l) => [l.id, Object.fromEntries(l.lignes.map((x) => [x.agent_id, champs(x)]))])));
    setRectif(null);
  }, [listes]);

  const origine = (liste, agentId) => champs(liste.lignes.find((x) => x.agent_id === agentId));
  const modifiees = (liste) => Object.entries(valeurs[liste.id] || {}).filter(([agentId, v]) => !identique(v, origine(liste, Number(agentId)))).map(([, v]) => v);
  const dirty = listes.some((l) => modifiees(l).length > 0);
  const editable = (l) => l.actions.saisir || rectif === l.id;
  /** Lignes affichées : valeurs saisies, retard recalculé à la volée. */
  const affichage = (l) => ({
    ...l,
    lignes: l.lignes.map((x) => {
      const v = valeurs[l.id]?.[x.agent_id] || champs(x);
      return { ...x, ...v, retard_minutes: v.motif ? 0 : retard(v.heure_arrivee, l.heure_arrivee_ref, l.tolerance_minutes) };
    }),
  });
  const changer = (listeId) => (agentId, patch) => setValeurs((v) => ({ ...v, [listeId]: { ...v[listeId], [agentId]: { ...v[listeId][agentId], ...patch } } }));
  /** « Tous présents à l’heure » : complète les lignes vides aux horaires de référence. */
  const tousPresents = (l) => setValeurs((v) => ({
    ...v,
    [l.id]: Object.fromEntries(Object.entries(v[l.id]).map(([k, x]) => [k, x.motif ? x : { ...x, heure_arrivee: x.heure_arrivee || l.heure_arrivee_ref, heure_depart: x.heure_depart || l.heure_depart_ref }])),
  }));
  const departs = (l) => setValeurs((v) => ({
    ...v,
    [l.id]: Object.fromEntries(Object.entries(v[l.id]).map(([k, x]) => [k, !x.motif && x.heure_arrivee && !x.heure_depart ? { ...x, heure_depart: l.heure_depart_ref } : x])),
  }));
  const charge = (x) => ({ ...x, heure_arrivee: x.heure_arrivee || null, heure_depart: x.heure_depart || null, motif: x.motif || null, observation: x.observation || null });

  const enregistrer = async () => {
    setEnregistrement(true);
    try {
      for (const l of listes.filter((x) => x.actions.saisir)) {
        const lignes = modifiees(l);
        if (lignes.length) await runAction(() => api.put(`/presences/listes/${l.id}`, { lignes: lignes.map(charge) }));
      }
      toast.success('Présences enregistrées.');
      state.reload();
    } catch { /* message déjà affiché */ } finally { setEnregistrement(false); }
  };
  const proposerRectificatif = async (l) => {
    const lignes = modifiees(l);
    if (!lignes.length) { toast.error('Modifiez au moins une ligne avant de proposer le rectificatif.'); return; }
    const motif = await confirm({
      title: 'Proposer un rectificatif', confirmLabel: 'Proposer au Directeur',
      message: `${lignes.length} ligne(s) modifiée(s) sur la liste des ${l.categorie_libelle}. La liste originale reste intacte ; les nouvelles valeurs s’appliqueront après validation du Directeur.`,
      input: { label: 'Motif du rectificatif', required: true, min: 5 },
    });
    if (!motif) return;
    await runAction(() => api.post(`/presences/listes/${l.id}/rectificatifs`, { motif, lignes: lignes.map(charge) }), 'Rectificatif proposé au Directeur.');
    state.reload();
  };

  const aller = (d) => navigate(`/presences/jour/${d}`);
  const navigationDate = (
    <div className="flex items-center gap-1">
      <IconButton label="Jour ouvrable précédent" icon={ChevronLeft} onClick={() => aller(jourOuvrable(date, -1))} />
      <input type="date" className="input w-auto py-1" aria-label="Date des présences" value={date} max={aujourdhui()} onChange={(e) => e.target.value && aller(e.target.value)} />
      <IconButton label="Jour ouvrable suivant" icon={ChevronRight} disabled={date >= aujourdhui()} onClick={() => aller(jourOuvrable(date, 1))} />
    </div>
  );

  return (
    <Loadable state={state}>
      {(d) => {
        const vues = listes.map(affichage);
        const saisie = vues.some((l) => l.actions.saisir);
        const etapes = [
          ...vues.map((l, i) => ({ key: l.categorie, numero: i + 1, label: l.categorie_libelle, ok: l.lignes.filter((x) => ['PRESENT', 'RETARD', 'ABSENT'].includes(etatLigne(x))).length, total: l.lignes.length })),
          { key: 'controle', numero: vues.length + 1, label: 'Contrôle', ok: 0, total: 0 },
        ];
        const manquantes = vues.flatMap((l, i) => l.lignes.filter((x) => ['NON_RENSEIGNE', 'INCOMPLET'].includes(etatLigne(x)))
          .map((x) => ({ etape: i, label: `${l.categorie_libelle} : ${x.nom_complet} — ${etatLigne(x) === 'INCOMPLET' ? 'heure de départ à saisir' : 'présence à saisir'}` })));
        const incoherences = vues.flatMap((l) => [
          ...l.lignes.filter((x) => x.retard_minutes > 0 && !x.motif).map((x) => ({ bloquant: false, message: `${x.nom_complet} : retard de ${x.retard_minutes} min (arrivée ${x.heure_arrivee}).` })),
          ...l.lignes.filter((x) => ['MISSION', 'MALADIE', 'FORMATION'].includes(x.motif) && !x.piece_id).map((x) => ({ bloquant: false, message: `${x.nom_complet} : ${MOTIFS[x.motif]} sans pièce justificative jointe.` })),
          ...l.lignes.filter((x) => x.heure_arrivee && x.heure_depart && x.heure_depart < x.heure_arrivee).map((x) => ({ bloquant: true, message: `${x.nom_complet} : l’heure de départ précède l’heure d’arrivée.` })),
        ]);
        const courante = vues[etape];
        return (
          <>
            <PageHeader title={`Présences du ${d.jour ? `${d.jour.toLowerCase()} ` : ''}${fmtDate(date)}`}
              subtitle={d.semaine ? <span className="inline-flex flex-wrap items-center gap-2">{d.semaine.reference} <StatutSemaine value={d.semaine.statut} /></span> : 'Listes journalières des Cadres et des Agents (annexe 11)'}
              breadcrumb={[{ label: 'Présences', to: '/presences' }, { label: fmtDate(date) }]}
              actions={<>
                {navigationDate}
                {d.semaine && <Link className="btn-secondary" to={`/presences/semaines/${d.semaine.id}`}><CalendarDays size={16} aria-hidden /> Rapport de la semaine</Link>}
              </>} />
            <UnsavedChangesGuard when={dirty} />
            {!vues.length ? (
              <EmptyState icon={CalendarDays} title="Aucune liste pour ce jour">{d.raison || 'Aucune liste n’a été établie pour ce jour.'}</EmptyState>
            ) : (
              <FormulaireEtapes etapes={etapes} etape={Math.min(etape, etapes.length - 1)} onEtape={setEtape} navigation="Listes du jour"
                resume={<span>Horaires : {vues[0].heure_arrivee_ref} – {vues[0].heure_depart_ref}, tolérance {vues[0].tolerance_minutes} min</span>}
                onEnregistrer={saisie ? enregistrer : undefined} enregistrement={enregistrement} peutEnregistrer={dirty}
                aide={saisie ? 'Les listes se transmettent au Directeur avec le rapport hebdomadaire, une fois tous les jours de la semaine renseignés.' : null}>
                {courante ? (
                  <Card title={<span className="inline-flex items-center gap-2">Liste des {courante.categorie_libelle} <StatutListe value={courante.statut} /></span>}
                    actions={<span className="text-xs text-slate-600">{resumeBilan(courante.bilan)}</span>} bodyClass="p-0">
                    {courante.actions.saisir && (
                      <div className="flex flex-wrap gap-2 border-b p-3">
                        <Button icon={CheckCheck} onClick={() => tousPresents(courante)}>Tous présents à l’heure</Button>
                        <Button icon={Clock} onClick={() => departs(courante)}>Départ à l’heure pour les présents</Button>
                      </div>
                    )}
                    {courante.actions.rectifier && rectif !== courante.id && (
                      <div className="flex flex-wrap items-center gap-2 border-b p-3">
                        <p className="text-sm text-slate-700">Liste transmise : toute correction passe par un rectificatif validé par le Directeur.</p>
                        <Button icon={FilePen} className="sm:ml-auto" disabled={courante.rectificatifs.some((r) => r.statut === 'PROPOSE')} onClick={() => setRectif(courante.id)}>Établir un rectificatif</Button>
                      </div>
                    )}
                    {rectif === courante.id && (
                      <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 p-3">
                        <p className="text-sm text-amber-900">Rectificatif en cours : modifiez les lignes concernées, puis proposez-le au Directeur.</p>
                        <div className="flex gap-2 sm:ml-auto">
                          <Button variant="ghost" onClick={() => { setRectif(null); state.reload(); }}>Annuler</Button>
                          <Button variant="primary" icon={FilePen} onClick={() => proposerRectificatif(courante)}>Proposer le rectificatif</Button>
                        </div>
                      </div>
                    )}
                    {courante.rectificatifs.length > 0 && (
                      <div className="border-b p-3 text-xs text-slate-700">
                        Rectificatifs : {courante.rectificatifs.map((r) => `${r.reference} (${r.statut === 'PROPOSE' ? 'à valider' : r.statut === 'VALIDE' ? 'validé' : 'refusé'})`).join(' ; ')}
                        {courante.rectificatifs.some((r) => r.statut === 'VALIDE') && ' — * valeur rectifiée.'}
                      </div>
                    )}
                    <Grille liste={courante} valeurs={valeurs[courante.id] || {}} editable={editable(courante)} onChange={changer(courante.id)} peutVoirPieces={d.droits.global} />
                  </Card>
                ) : (
                  <Card title="Contrôle des listes du jour">
                    <PageControle etapes={etapes} manquantes={manquantes} incoherences={incoherences} onAller={setEtape} strict>
                      {dirty && <InfoAlert tone="warning">Des modifications ne sont pas encore enregistrées.</InfoAlert>}
                    </PageControle>
                  </Card>
                )}
              </FormulaireEtapes>
            )}
          </>
        );
      }}
    </Loadable>
  );
}
