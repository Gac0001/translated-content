import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Download, FileSpreadsheet, Lock, Pencil, PlayCircle, Trash2, Undo2, Upload } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import {
  useApi, Loadable, PageHeader, Card, Badge, Button, KeyValues, SimpleTable, KpiTile, Modal, Tabs, InfoAlert, StatusBadge, WorkflowPanel,
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

function Consolidation({ id }) {
  const state = useApi(`/collectes/${id}/consolidation`);
  return (
    <Loadable state={state}>
      {(d) => (
        <Card title="Lignes reçues (dernière version de chaque service)" bodyClass="p-0">
          <SimpleTable label="Consolidation de la campagne" dense figee rowKey="cle" rows={d.lignes.map((l, i) => ({ ...l, cle: i }))} empty="Aucun fichier reçu."
            columns={[
              { key: 'service', header: 'Service', render: (l) => <span className="font-medium">{l.service}</span> },
              ...d.colonnes.filter((c) => !c.calc && c.k !== 'numero' && !/^m\d+$/.test(c.k)).map((c) => ({
                key: c.k, header: c.h.replace(' *', ''), align: c.n ? 'right' : undefined,
                render: (l) => (c.n ? fmtCdf(l[c.k], { suffixe: false }) : <span className="block max-w-[18rem] whitespace-normal">{l[c.k] ?? '—'}</span>),
              })),
              { key: 'statut', header: 'Statut', render: (l) => <StatusBadge value={l.statut} /> },
            ]} />
        </Card>
      )}
    </Loadable>
  );
}

/** Campagne de collecte : services ciblés, modèles, fichiers retournés, décisions, consolidation. */
export default function CollecteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const state = useApi(`/collectes/${id}`, [id]);
  const objets = useApi('/collectes');
  const confirm = useConfirm();
  const [onglet, choisir] = useOnglet('services', { valeurs: ['services', 'consolidation', 'historique'] });
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
            <Tabs label="Campagne" value={onglet} onChange={choisir} tabs={[{ value: 'services', label: 'Services' }, { value: 'consolidation', label: 'Consolidation' }, { value: 'historique', label: 'Historique' }]} />
            {onglet === 'consolidation' ? <Consolidation id={c.id} /> : onglet === 'historique' ? (
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
