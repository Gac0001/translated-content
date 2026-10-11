import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, FileSpreadsheet, Lock, Pencil, Play, Plus, RotateCcw, Undo2, UserMinus } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Modal, Badge, Progress, KpiTile, DataTable, Button, WorkflowPanel, runAction, toast, useConfirm } from '../../components/ui';
import { Timeline } from '../../components/shared';
import { fmtDate } from '../../lib/format';
import { circuitCampagne } from '../../lib/workflows';
import { CampagneModal } from './Donnees';

function AjoutCibles({ campagne, onClose, onDone }) {
  const state = useApi('/donnees/acteurs?statut=ACTIF');
  const [choix, setChoix] = useState([]);
  const [enCours, setEnCours] = useState(false);
  const deja = new Set(campagne.cibles.map((c) => c.id));
  const ajouter = async () => {
    setEnCours(true);
    try { await runAction(() => api.post(`/donnees/campagnes/${campagne.id}/cibles`, { acteurs: choix }), `${choix.length} acteur(s) ajouté(s).`); onDone(); } catch { /* erreur déjà signalée */ } finally { setEnCours(false); }
  };
  return (
    <Modal open size="lg" title="Ajouter des acteurs au ciblage" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!choix.length || enCours} onClick={ajouter}>{enCours ? 'Ajout…' : `Ajouter ${choix.length || ''}`}</button></>}>
      <Loadable state={state}>
        {(r) => (
          <DataTable rows={r.data.filter((a) => !deja.has(a.id))} encadre={false} pageSize={10} empty="Tous les acteurs actifs sont déjà ciblés."
            columns={[
              { key: 'choix', header: '', render: (a) => <input type="checkbox" aria-label={`Cibler ${a.raison_sociale}`} checked={choix.includes(a.id)} onChange={(e) => setChoix(e.target.checked ? [...choix, a.id] : choix.filter((x) => x !== a.id))} /> },
              { key: 'raison_sociale', header: 'Acteur', search: (a) => `${a.raison_sociale} ${a.sigle || ''} ${a.reference}` },
              { key: 'categorie', header: 'Catégorie' }, { key: 'zone', header: 'Province' },
            ]} />
        )}
      </Loadable>
    </Modal>
  );
}

export default function CampagneDetail() {
  const { id } = useParams();
  const state = useApi(`/donnees/campagnes/${id}`, [id]);
  const ref = useApi('/donnees/referentiel');
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/donnees/campagnes/${id}/${path}`, body), msg).catch(() => null); setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(c) => {
        const a = c.actions;
        const recues = c.cibles.filter((k) => k.reponse_statut);
        const compte = (s) => c.cibles.filter((k) => k.reponse_statut === s).length;
        const valider = async () => {
          const taux = c.cibles.length ? Math.round((recues.length / c.cibles.length) * 100) : 0;
          if (taux < 100 && !(await confirm({ title: 'Valider la campagne', message: `${recues.length} acteur(s) sur ${c.cibles.length} ont répondu (${taux} % de couverture). Les données seront figées et exploitées en l’état. Confirmez-vous la validation ?`, confirmLabel: 'Valider' }))) return;
          post('valider', {}, 'Campagne validée : données figées.');
        };
        const retourner = async () => {
          const motif = await confirm({ title: 'Retourner la campagne', message: 'La campagne sera rouverte et renvoyée à son responsable.', input: { label: 'Compléments demandés', required: true }, confirmLabel: 'Retourner', danger: true });
          if (motif) post('retourner', { motif }, 'Campagne retournée au responsable.');
        };
        const cloturer = async () => {
          if (!(await confirm({ title: 'Clôturer la collecte', message: `${recues.length} réponse(s) reçue(s) sur ${c.cibles.length}. La saisie sera fermée et la campagne transmise au Chef de Division pour validation.`, confirmLabel: 'Clôturer' }))) return;
          post('cloturer', {}, 'Campagne clôturée : transmise pour validation.');
        };
        const couverture = c.cibles.length ? Math.round((recues.length / c.cibles.length) * 100) : 0;
        const attente = { BROUILLON: 'Campagne en préparation : complétez le ciblage puis ouvrez la collecte.', OUVERTE: 'Collecte en cours : les réponses se saisissent acteur par acteur, puis sont contrôlées par une autre personne.', CLOTUREE: 'En attente de validation par le Chef de la Division Études, Documentation et Information.', VALIDEE: 'Campagne validée : les réponses sont figées et exploitées dans les indicateurs, tableaux et bulletins.' }[c.statut];
        const retirer = async (k) => {
          if (!(await confirm({ title: 'Retirer du ciblage', message: `Retirer ${k.raison_sociale} de la campagne ?`, confirmLabel: 'Retirer', danger: true }))) return;
          await runAction(() => api.del(`/donnees/campagnes/${id}/cibles/${k.id}`), 'Acteur retiré.');
          state.reload();
        };
        return (
          <>
            <PageHeader title={c.titre} subtitle={`${c.reference} · ${c.version.questionnaire_code} v${c.version.version} · période ${c.periode}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees?onglet=campagnes' }, { label: c.reference }]}
              actions={a.modifier && ref.data && <button type="button" className="btn-secondary" onClick={() => setModal('modifier')}><Pencil size={16} aria-hidden /> Modifier</button>}
              menu={c.droits.exporter ? [{ label: 'Excel', icon: FileSpreadsheet, onClick: () => download(`/donnees/campagnes/${id}/export`, 'Campagne.xlsx').catch((e) => toast.error(errorMessage(e))) }] : []} />
            <WorkflowPanel circuit={circuitCampagne(c)} attente={attente}
              message={c.observations && c.statut === 'OUVERTE' && <InfoAlert tone="warning"><b>Retournée</b> : {c.observations}</InfoAlert>}
              actions={[
                a.ouvrir && <Button key="ou" variant="primary" icon={Play} onClick={() => post('ouvrir', {}, 'Campagne ouverte : la saisie peut commencer.')}>Ouvrir la collecte</Button>,
                a.cloturer && <Button key="cl" icon={Lock} onClick={cloturer}>Clôturer</Button>,
                a.rouvrir && <Button key="ro" icon={RotateCcw} onClick={() => post('rouvrir', {}, 'Campagne rouverte.')}>Rouvrir</Button>,
                a.valider && <Button key="va" variant="success" icon={CheckCircle2} onClick={valider}>Valider</Button>,
                a.retourner && <Button key="re" icon={Undo2} onClick={retourner}>Retourner</Button>,
              ]} />
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Acteurs ciblés" valeur={c.cibles.length} />
              <KpiTile label="Réponses reçues" valeur={recues.length} progression={c.cibles.length ? couverture : null} aide={c.cibles.length ? `${couverture} % de couverture des acteurs ciblés` : null} />
              <KpiTile label="Contrôlées" valeur={compte('CONTROLEE')} tone="vert" progression={recues.length ? Math.round((compte('CONTROLEE') / recues.length) * 100) : null} aide={recues.length ? `${Math.round((compte('CONTROLEE') / recues.length) * 100)} % des réponses reçues` : null} />
              <KpiTile label="À corriger ou en cours" valeur={compte('A_CORRIGER') + compte('BROUILLON') + compte('SAISIE')} tone={compte('A_CORRIGER') ? 'jaune' : 'gris'} aide={compte('A_CORRIGER') ? `dont ${compte('A_CORRIGER')} à corriger` : null} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Réponses par acteur" className="lg:col-span-2" bodyClass="p-0"
                actions={a.cibler && <button type="button" className="btn-secondary" onClick={() => setModal('cibles')}><Plus size={16} aria-hidden /> Acteurs</button>}>
                <DataTable rows={c.cibles} encadre={false} label="Réponses par acteur" onRowClick={c.statut !== 'BROUILLON' ? (k) => navigate(`/donnees/campagnes/${id}/reponses/${k.id}`) : undefined} empty="Aucun acteur ciblé."
                  columns={[
                    { key: 'raison_sociale', header: 'Acteur', render: (k) => <div><div className="font-medium">{k.raison_sociale}</div><div className="text-xs text-slate-500">{k.categorie} · {k.zone}</div></div>, search: (k) => `${k.raison_sociale} ${k.sigle || ''} ${k.categorie} ${k.zone}` },
                    { key: 'reponse_statut', header: 'Réponse', render: (k) => (k.reponse_statut ? <StatusBadge value={k.reponse_statut} /> : <span className="text-xs text-slate-500">Non reçue</span>) },
                    { key: 'erreurs', header: 'Qualité', render: (k) => (!k.reponse_statut ? '—' : k.erreurs ? <Badge tone="danger">{k.erreurs} erreur(s)</Badge> : k.alertes ? <Badge tone="attention">{k.alertes} alerte(s)</Badge> : <Badge tone="succes">Conforme</Badge>) },
                    ...(a.cibler ? [{ key: 'retirer', header: '', render: (k) => !k.reponse_statut && <button type="button" className="btn-ghost px-1 text-red-700" aria-label={`Retirer ${k.raison_sociale}`} onClick={(e) => { e.stopPropagation(); retirer(k); }}><UserMinus size={14} aria-hidden /></button> }] : []),
                  ]} />
              </Card>
              <div className="space-y-4">
                <Card title="Campagne">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={c.statut} />], ['Questionnaire', `${c.version.questionnaire_titre} (v${c.version.version})`],
                    ['Période', `${c.periode} : du ${fmtDate(c.periode_debut)} au ${fmtDate(c.periode_fin)}`], ['Échéance', fmtDate(c.echeance)], ['Responsable', c.responsable || '—'],
                    ['Ciblage', ref.data ? `${c.categories.length ? c.categories.map((x) => ref.data.categories.find((g) => g.id === x)?.libelle).join(', ') : 'Toutes catégories'} — ${c.zones.length ? c.zones.map((x) => ref.data.zones.find((z) => z.id === x)?.libelle).join(', ') : 'toutes provinces'}` : '…'],
                  ]} />
                  {c.instructions && <p className="mt-3 whitespace-pre-line border-t pt-2 text-sm">{c.instructions}</p>}
                  {c.cibles.length > 0 && <div className="mt-3 text-sm">Avancement du contrôle <Progress value={Math.round((compte('CONTROLEE') / c.cibles.length) * 100)} label="Avancement du contrôle" /></div>}
                </Card>
                <Card title="Historique"><Timeline items={c.historique} /></Card>
              </div>
            </div>
            {modal === 'modifier' && <CampagneModal campagne={c} referentiel={ref.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); state.reload(); }} />}
            {modal === 'cibles' && <AjoutCibles campagne={c} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
          </>
        );
      }}
    </Loadable>
  );
}
