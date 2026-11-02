import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BellRing, CheckCircle2, Download, FileSpreadsheet, Lock, Mail, Pencil, PlayCircle, Trash2, Undo2, Upload } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import {
  useApi, Loadable, PageHeader, Card, Badge, Button, KeyValues, SimpleTable, KpiTile, Modal, Tabs, InfoAlert, StatusBadge, WorkflowPanel, EmptyState,
  useOnglet, runAction, useConfirm, toast,
} from '../../components/ui';
import { Timeline } from '../../components/shared';
import { fmtCdf, fmtDate, fmtDateTime } from '../../lib/format';
import { circuitCollecte } from '../../lib/workflows';
import CollecteForm from './CollecteForm';

const Anomalies = ({ liste }) => (
  <SimpleTable label="Rapport d’anomalies" dense rowKey="cle" rows={liste.map((a, i) => ({ ...a, cle: i }))} empty="Aucune anomalie : le fichier est conforme."
    columns={[
      { key: 'gravite', header: 'Gravité', render: (a) => <Badge tone={a.gravite === 'ERREUR' ? 'danger' : 'attention'}>{a.gravite === 'ERREUR' ? 'Erreur' : 'Alerte'}</Badge> },
      { key: 'cellule', header: 'Cellule', render: (a) => a.cellule || '—' },
      { key: 'message', header: 'Anomalie', render: (a) => <span className="block min-w-[16rem] whitespace-normal">{a.message}</span> },
    ]} />
);

const Controle = ({ r }) => (r ? (
  <span className="flex flex-wrap gap-1">
    {r.erreurs > 0 && <Badge tone="danger">{r.erreurs} erreur(s)</Badge>}
    {r.alertes > 0 && <Badge tone="attention">{r.alertes} alerte(s)</Badge>}
    {!r.erreurs && !r.alertes && <Badge tone="succes">Conforme</Badge>}
  </span>
) : <span className="text-xs text-slate-600">Aucun fichier</span>);

/** Fiche d’un service de la campagne : fichiers reçus (versions), rapport d’anomalies, décision. */
function FicheService({ c, s, onClose, onDone }) {
  const confirm = useConfirm();
  const [vue, setVue] = useState(s.derniere?.id || null);
  const rec = s.receptions.find((r) => r.id === vue);
  const integrer = async () => {
    if (!(await confirm({ title: `Intégrer la contribution de ${s.sigle}`, message: `La version ${s.derniere.version} sera intégrée au SIG-DEP (${c.objet_libelle}).`, confirmLabel: 'Intégrer' }))) return;
    const r = await runAction(() => api.post(`/collectes/${c.id}/services/${s.id}/integrer`));
    toast.success(`Contribution intégrée : ${r.data.integration.message}.`);
    onDone();
  };
  const rejeter = async () => {
    const motif = await confirm({ title: `Rejeter la contribution de ${s.sigle}`, message: 'Le service devra renvoyer un fichier corrigé.', input: { label: 'Motif du rejet', required: true, min: 5 }, confirmLabel: 'Rejeter', danger: true });
    if (!motif) return;
    await runAction(() => api.post(`/collectes/${c.id}/services/${s.id}/rejeter`, { motif }), 'Contribution rejetée.');
    onDone();
  };
  const peutIntegrer = c.droits.decider && ['RECU', 'CORRIGE'].includes(s.statut) && s.derniere && !s.derniere.erreurs;
  return (
    <Modal open size="lg" title={`${s.sigle} — ${s.libelle}`} onClose={onClose}
      footer={<>
        {c.droits.decider && ['RECU', 'CORRIGE'].includes(s.statut) && <Button icon={Undo2} variant="danger" onClick={rejeter}>Rejeter</Button>}
        {c.droits.decider && ['RECU', 'CORRIGE'].includes(s.statut) && <Button icon={CheckCircle2} variant="success" disabled={!peutIntegrer} onClick={integrer}>Intégrer</Button>}
        <Button onClick={onClose}>Fermer</Button>
      </>}>
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">Statut : <StatusBadge value={s.statut} /></p>
        {s.statut === 'REJETE' && <InfoAlert tone="warning"><b>Rejeté</b> : {s.motif_rejet}</InfoAlert>}
        {s.statut === 'INTEGRE' && s.integration && (
          <InfoAlert tone="succes">
            Intégré (version {s.integration.version}) : {s.integration.message}.
            {s.integration.ptba_id && <> <Link className="link" to={`/planification/ptba/${s.integration.ptba_id}`}>Ouvrir le PTBA</Link></>}
          </InfoAlert>
        )}
        {c.droits.decider && s.derniere?.erreurs > 0 && ['RECU', 'CORRIGE'].includes(s.statut) && <InfoAlert tone="warning">La dernière version comporte des erreurs : faites corriger le fichier par le service, ou rejetez-le avec un motif.</InfoAlert>}
        <SimpleTable label="Fichiers reçus" dense rows={s.receptions} empty="Aucun fichier reçu." onRowClick={(r) => setVue(r.id)}
          rowClassName={(r) => (r.id === vue ? 'bg-dep-50' : '')}
          columns={[
            { key: 'version', header: 'Version', render: (r) => `V${r.version}` },
            { key: 'fichier', header: 'Fichier d’origine', render: (r) => <button type="button" className="link text-left" onClick={(e) => { e.stopPropagation(); download(`/attachments/fichier/${r.attachment_id}`, r.fichier).catch((x) => toast.error(errorMessage(x))); }}>{r.fichier}</button> },
            { key: 'recu_at', header: 'Reçu', render: (r) => <span className="text-xs">{fmtDateTime(r.recu_at)}{r.recu_par_nom ? ` · ${r.recu_par_nom}` : ''}</span> },
            { key: 'lignes', header: 'Lignes', align: 'right' },
            { key: 'total', header: 'Total (CDF)', align: 'right', render: (r) => fmtCdf(r.total, { suffixe: false }) },
            { key: 'controle', header: 'Contrôle', render: (r) => <Controle r={r} /> },
          ]} />
        {rec && <section aria-label={`Rapport d’anomalies de la version ${rec.version}`}><h3 className="mb-1 text-sm font-semibold text-dep-800">Rapport d’anomalies — version {rec.version}</h3><Anomalies liste={rec.anomalies} /></section>}
      </div>
    </Modal>
  );
}

function Consolidation({ c }) {
  const state = useApi(`/collectes/${c.id}/consolidation`);
  const exporter = () => download(`/collectes/${c.id}/export`, `collecte-${c.objet.toLowerCase()}-${c.annee}.xlsx`).catch((x) => toast.error(errorMessage(x)));
  return (
    <Loadable state={state}>
      {(d) => (
        <Card title="Lignes reçues (dernière version de chaque service)" bodyClass="p-0"
          actions={<Button size="sm" icon={FileSpreadsheet} onClick={exporter}>Exporter (Excel)</Button>}>
          <SimpleTable label="Consolidation de la campagne" dense figee rowKey="cle" rows={d.lignes.map((l, i) => ({ ...l, cle: i }))} empty="Aucun fichier reçu."
            columns={[
              { key: 'service', header: 'Service', render: (l) => <span className="font-medium">{l.service}</span> },
              ...d.colonnes.filter((c) => !c.calc && c.k !== 'numero' && !/^m\d+$/.test(c.k)).map((c) => ({
                key: c.k, header: c.h.replace(' *', ''), align: c.n ? 'right' : undefined,
                render: (l) => (c.pct ? (l[c.k] === null || l[c.k] === undefined ? '—' : `${l[c.k]} %`) : c.n ? fmtCdf(l[c.k], { suffixe: false }) : <span className="block max-w-[18rem] whitespace-normal">{l[c.k] ?? '—'}</span>),
              })),
              { key: 'statut', header: 'Statut', render: (l) => <StatusBadge value={l.statut} /> },
            ]} />
        </Card>
      )}
    </Loadable>
  );
}

/** Lettres d’envoi et de relance : brouillons de correspondance, signés et numérotés par le Directeur. */
function Courriers({ c, onDone }) {
  const confirm = useConfirm();
  const sansRetour = c.services.filter((s) => ['ATTENDU', 'EN_RETARD'].includes(s.statut));
  const aRelancer = sansRetour.some((s) => s.statut === 'EN_RETARD') ? sansRetour.filter((s) => s.statut === 'EN_RETARD') : sansRetour;
  const preparer = async (type) => {
    const vises = type === 'ENVOI' ? c.services : aRelancer;
    const ok = await confirm({
      title: type === 'ENVOI' ? 'Préparer la lettre d’envoi des modèles' : 'Préparer une lettre de relance',
      message: `Un brouillon de lettre de transmission sera créé dans la correspondance, à faire signer par le Directeur (numérotée à la signature). Services visés : ${vises.map((s) => s.sigle).join(', ')}.`,
      confirmLabel: 'Préparer le brouillon',
    });
    if (!ok) return;
    try {
      const r = await runAction(() => api.post(`/collectes/${c.id}/lettres`, { type }));
      toast.success(`Brouillon ${r.data.reference} préparé : relisez-le puis transmettez-le pour signature.`);
      onDone();
    } catch { /* message affiché */ }
  };
  const envoiFait = c.lettres.some((l) => l.type === 'ENVOI');
  return (
    <Card title="Lettres de la campagne" bodyClass="p-0"
      actions={c.droits.lettres && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Mail} variant={envoiFait ? undefined : 'primary'} onClick={() => preparer('ENVOI')}>Préparer la lettre d’envoi</Button>
          {c.statut === 'OUVERTE' && aRelancer.length > 0 && <Button size="sm" icon={BellRing} variant={aRelancer.some((s) => s.statut === 'EN_RETARD') ? 'primary' : undefined} onClick={() => preparer('RELANCE')}>Préparer une relance ({aRelancer.length})</Button>}
        </div>
      )}>
      {c.lettres.length ? (
        <SimpleTable label="Lettres de la campagne" rows={c.lettres}
          columns={[
            { key: 'type', header: 'Lettre', render: (l) => <Badge tone={l.type === 'ENVOI' ? 'info' : 'attention'}>{l.type === 'ENVOI' ? 'Envoi des modèles' : 'Relance'}</Badge> },
            { key: 'titre', header: 'Document', render: (l) => <Link className="link" to={`/documents/${l.document_id}`}>{l.reference}</Link> },
            { key: 'numero_officiel', header: 'Numéro officiel', render: (l) => (l.numero_officiel ? <span className="font-medium">{l.numero_officiel}</span> : <span className="text-xs text-slate-600">Attribué à la signature du Directeur</span>) },
            { key: 'services', header: 'Services visés', render: (l) => <span className="block max-w-[16rem] whitespace-normal text-xs">{(l.services || []).map((id) => c.services.find((s) => s.id === id)?.sigle).filter(Boolean).join(', ')}</span> },
            { key: 'statut', header: 'État', render: (l) => <StatusBadge value={l.statut} /> },
            { key: 'created_at', header: 'Préparée', render: (l) => <span className="text-xs">{fmtDate(l.created_at)}{l.prepare_par ? ` · ${l.prepare_par}` : ''}</span> },
          ]} />
      ) : (
        <EmptyState title="Aucune lettre préparée">
          {c.droits.lettres ? 'Préparez la lettre d’envoi des modèles aux services ; elle sera signée et numérotée par le Directeur.' : 'Les lettres sont préparées par le Bureau organisateur de la campagne.'}
        </EmptyState>
      )}
    </Card>
  );
}

/** Campagne de collecte : services ciblés, modèles, fichiers retournés, décisions, consolidation. */
export default function CollecteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useApi(`/collectes/${id}`, [id]);
  const objets = useApi('/collectes');
  const confirm = useConfirm();
  const [onglet, choisir] = useOnglet('services', { valeurs: ['services', 'courriers', 'consolidation', 'historique'] });
  const [fiche, setFiche] = useState(null);
  const [edition, setEdition] = useState(false);
  const fichierRef = useRef(null);
  const [cible, setCible] = useState(null);
  const etape = async (chemin, message, opts) => {
    if (opts && !(await confirm(opts))) return;
    await runAction(() => api.post(`/collectes/${id}/${chemin}`), message).then(() => state.reload()).catch(() => {});
  };
  const choisirFichier = (s) => { setCible(s); fichierRef.current.value = ''; fichierRef.current.click(); };
  const importer = async (fichier) => {
    if (!fichier || !cible) return;
    const fd = new FormData(); fd.append('fichier', fichier);
    try {
      const r = await runAction(() => api.post(`/collectes/${id}/services/${cible.id}/import`, fd));
      const b = r.data;
      (b.erreurs ? toast.error : toast.success)(`${cible.sigle} — version ${b.version} : ${b.lignes} ligne(s), ${b.erreurs} erreur(s), ${b.alertes} alerte(s).`);
      await state.reload();
      setFiche(cible);
    } catch { /* message affiché */ }
  };
  return (
    <Loadable state={state}>
      {(c) => {
        const ficheCourante = fiche ? c.services.find((s) => s.id === fiche.id) || fiche : null;
        const supprimer = async () => {
          if (!(await confirm({ title: 'Supprimer la campagne', message: 'La campagne en préparation sera supprimée.', danger: true, confirmLabel: 'Supprimer' }))) return;
          await runAction(() => api.delete(`/collectes/${c.id}`), 'Campagne supprimée.');
          navigate('/collectes');
        };
        const modifier = async (corps) => { await runAction(() => api.put(`/collectes/${c.id}`, corps), 'Campagne modifiée.'); setEdition(false); state.reload(); };
        return (
          <>
            <input ref={fichierRef} type="file" className="hidden" accept=".xlsx" aria-label="Fichier retourné par le service" onChange={(e) => importer(e.target.files[0])} />
            <PageHeader title={c.titre} subtitle={<span className="flex flex-wrap items-center gap-2">{c.reference} · {c.objet_libelle} · exercice {c.annee}<StatusBadge value={c.statut} feminin /></span>}
              breadcrumb={[{ label: 'Collecte auprès des services', to: '/collectes' }, { label: c.reference }]}
              menu={[
                c.droits.modifier && { label: 'Modifier', icon: Pencil, onClick: () => setEdition(true) },
                c.droits.modifier && { label: 'Supprimer', icon: Trash2, danger: true, onClick: supprimer },
              ]} />
            <WorkflowPanel circuit={circuitCollecte(c)}
              attente={{ PREPARATION: 'En préparation au Bureau organisateur ; ouverture par le Chef de la Division Programme et Suivi.', OUVERTE: `Collecte ouverte jusqu’au ${fmtDate(c.echeance)} : transmettez les modèles aux services et importez leurs retours.`, CLOTUREE: `Campagne clôturée le ${fmtDate(c.cloturee_at)}.` }[c.statut]}
              actions={[
                c.droits.ouvrir && <Button key="ou" variant="primary" icon={PlayCircle} onClick={() => etape('ouvrir', 'Campagne ouverte.', { title: 'Ouvrir la campagne', message: 'Les modèles pourront être transmis aux services et leurs retours importés.', confirmLabel: 'Ouvrir' })}>Ouvrir la campagne</Button>,
                c.droits.cloturer && <Button key="cl" icon={Lock} onClick={() => etape('cloturer', 'Campagne clôturée.', { title: 'Clôturer la campagne', message: 'Plus aucun retour ne pourra être importé.', confirmLabel: 'Clôturer', danger: true })}>Clôturer</Button>,
              ]} />
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Taux de retour" valeur={`${c.resume.retour} %`} />
              <KpiTile label="Contributions intégrées" valeur={`${c.resume.integres} / ${c.resume.total}`} tone="vert" />
              <KpiTile label="À intégrer ou à corriger" valeur={String(c.resume.recus + c.resume.rejetes)} tone="jaune" />
              <KpiTile label="Services en retard" valeur={String(c.resume.en_retard)} tone={c.resume.en_retard ? 'rouge' : 'gris'} />
            </div>
            <Tabs label="Campagne" value={onglet} onChange={choisir} tabs={[{ value: 'services', label: 'Services' }, { value: 'courriers', label: 'Courriers', count: c.lettres.length || undefined }, { value: 'consolidation', label: 'Consolidation' }, { value: 'historique', label: 'Historique' }]} />
            {onglet === 'courriers' ? <Courriers c={c} onDone={() => state.reload()} /> : onglet === 'consolidation' ? <Consolidation c={c} /> : onglet === 'historique' ? (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Campagne" className="lg:col-span-1"><KeyValues cols={1} items={[['Objet', c.objet_libelle], ['Exercice', c.annee], ['Échéance', fmtDate(c.echeance)], ['Instructions', c.instructions]]} /></Card>
                <Card title="Historique" className="lg:col-span-2"><Timeline items={c.historique} /></Card>
              </div>
            ) : (
              <Card title={`Services ciblés (${c.services.length})`} bodyClass="p-0">
                <SimpleTable label="Services de la campagne" rows={c.services} onRowClick={(s) => setFiche(s)}
                  columns={[
                    { key: 'sigle', header: 'Service', render: (s) => <span><span className="font-medium">{s.sigle}</span><span className="block max-w-[20rem] whitespace-normal text-xs text-slate-600">{s.libelle}</span></span> },
                    { key: 'statut', header: 'Statut', render: (s) => <StatusBadge value={s.statut} /> },
                    { key: 'derniere', header: 'Dernier fichier', render: (s) => (s.derniere ? <span className="text-xs">V{s.derniere.version} · {fmtDateTime(s.derniere.recu_at)}</span> : '—') },
                    { key: 'suivi', header: 'Suivi', render: (s) => (s.jours_retard || s.relances ? (
                      <span className="block text-xs">
                        {s.jours_retard > 0 && <span className="block font-medium text-red-700">{s.jours_retard} jour(s) de retard</span>}
                        <span className="block text-slate-600">{s.relances ? `Relancé ${s.relances} fois, le ${fmtDate(s.derniere_relance)}` : 'Pas encore relancé'}</span>
                      </span>
                    ) : '—') },
                    { key: 'controle', header: 'Contrôle', render: (s) => <Controle r={s.derniere} /> },
                    { key: 'x', header: '', render: (s) => (
                      <span className="flex flex-wrap justify-end gap-1">
                        {c.droits.modeles && <Button size="sm" icon={FileSpreadsheet} onClick={(e) => { e.stopPropagation(); download(`/collectes/${c.id}/services/${s.id}/modele`, `${c.objet.toLowerCase()}-${c.annee}-${s.sigle}.xlsx`).catch((x) => toast.error(errorMessage(x))); }}>Modèle</Button>}
                        {c.droits.importer && s.statut !== 'INTEGRE' && <Button size="sm" icon={Upload} onClick={(e) => { e.stopPropagation(); choisirFichier(s); }}>Importer</Button>}
                      </span>
                    ) },
                  ]} />
                <p className="border-t px-3 py-2 text-xs text-slate-600">
                  <Download size={12} className="mr-1 inline" aria-hidden />Le modèle de chaque service est pré-rempli et protégé : seules les cellules de saisie sont modifiables. Le fichier retourné est contrôlé à l’import ; il est conservé avec chaque version. Cliquez sur un service pour voir ses fichiers et son rapport d’anomalies.
                </p>
              </Card>
            )}
            {ficheCourante && <FicheService c={c} s={ficheCourante} onClose={() => setFiche(null)} onDone={() => { setFiche(null); state.reload(); }} />}
            {edition && objets.data && (
              <CollecteForm objets={objets.data.objets} initial={{ id: c.id, objet: c.objet, annee: c.annee, titre: c.titre, echeance: c.echeance, instructions: c.instructions || '', services: c.services.map((s) => s.service_id) }}
                onClose={() => setEdition(false)} onSubmit={({ id: _i, objet: _o, ...corps }) => modifier(corps)} />
            )}
          </>
        );
      }}
    </Loadable>
  );
}
