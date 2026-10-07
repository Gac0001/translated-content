import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, FileSpreadsheet, Lock, Pencil, Play, Plus, RotateCcw, Undo2, UserMinus } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Modal, Badge, Progress, Stat, DataTable, runAction, toast, useConfirm } from '../../components/ui';
import { Timeline } from '../../components/shared';
import { fmtDate } from '../../lib/format';
import { TextModal } from '../instructions/WorkflowActions';
import { CampagneModal } from './Donnees';

function AjoutCibles({ campagne, onClose, onDone }) {
  const state = useApi('/donnees/acteurs?statut=ACTIF');
  const [choix, setChoix] = useState([]);
  const deja = new Set(campagne.cibles.map((c) => c.id));
  const ajouter = async () => { await runAction(() => api.post(`/donnees/campagnes/${campagne.id}/cibles`, { acteurs: choix }), `${choix.length} acteur(s) ajouté(s).`); onDone(); };
  return (
    <Modal open size="lg" title="Ajouter des acteurs au ciblage" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!choix.length} onClick={ajouter}>Ajouter {choix.length || ''}</button></>}>
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
  const post = async (path, body, msg) => { await runAction(() => api.post(`/donnees/campagnes/${id}/${path}`, body), msg); setModal(null); state.reload(); };
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
        const retirer = async (k) => {
          if (!(await confirm({ title: 'Retirer du ciblage', message: `Retirer ${k.raison_sociale} de la campagne ?`, confirmLabel: 'Retirer', danger: true }))) return;
          await runAction(() => api.del(`/donnees/campagnes/${id}/cibles/${k.id}`), 'Acteur retiré.');
          state.reload();
        };
        return (
          <>
            <PageHeader title={c.titre} subtitle={`${c.reference} · ${c.version.questionnaire_code} v${c.version.version} · période ${c.periode}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees' }, { label: c.reference }]}
              actions={<>
                {c.droits.exporter && <button type="button" className="btn-secondary" onClick={() => download(`/donnees/campagnes/${id}/export`, 'Campagne.xlsx').catch((e) => toast.error(errorMessage(e)))}><FileSpreadsheet size={16} /> Excel</button>}
                {a.modifier && ref.data && <button type="button" className="btn-secondary" onClick={() => setModal('modifier')}><Pencil size={16} /> Modifier</button>}
                {a.ouvrir && <button type="button" className="btn-primary" onClick={() => post('ouvrir', {}, 'Campagne ouverte : la saisie peut commencer.')}><Play size={16} /> Ouvrir la collecte</button>}
                {a.cloturer && <button type="button" className="btn-secondary" onClick={() => post('cloturer', {}, 'Campagne clôturée : transmise pour validation.')}><Lock size={16} /> Clôturer</button>}
                {a.rouvrir && <button type="button" className="btn-secondary" onClick={() => post('rouvrir', {}, 'Campagne rouverte.')}><RotateCcw size={16} /> Rouvrir</button>}
                {a.valider && <button type="button" className="btn-success" onClick={valider}><CheckCircle2 size={16} /> Valider</button>}
                {a.retourner && <button type="button" className="btn-secondary" onClick={() => setModal('retour')}><Undo2 size={16} /> Retourner</button>}
              </>} />
            {c.observations && c.statut === 'OUVERTE' && <div className="mb-3"><InfoAlert tone="warning"><b>Retournée</b> : {c.observations}</InfoAlert></div>}
            {c.statut === 'VALIDEE' && <div className="mb-3"><InfoAlert>Campagne validée : les réponses sont figées en base et peuvent être exploitées.</InfoAlert></div>}
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              <Stat label="Acteurs ciblés" value={c.cibles.length} />
              <Stat label="Réponses reçues" value={recues.length} hint={c.cibles.length ? `${Math.round((recues.length / c.cibles.length) * 100)} % de couverture` : null} />
              <Stat label="Contrôlées" value={compte('CONTROLEE')} tone="vert" />
              <Stat label="À corriger ou en cours" value={compte('A_CORRIGER') + compte('BROUILLON') + compte('SAISIE')} tone={compte('A_CORRIGER') ? 'jaune' : 'dep'} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Réponses par acteur" className="lg:col-span-2" bodyClass="p-0"
                actions={a.cibler && <button type="button" className="btn-secondary" onClick={() => setModal('cibles')}><Plus size={16} /> Acteurs</button>}>
                <DataTable rows={c.cibles} encadre={false} onRowClick={c.statut !== 'BROUILLON' ? (k) => navigate(`/donnees/campagnes/${id}/reponses/${k.id}`) : undefined} empty="Aucun acteur ciblé."
                  columns={[
                    { key: 'raison_sociale', header: 'Acteur', render: (k) => <div><div className="font-medium">{k.raison_sociale}</div><div className="text-xs text-slate-500">{k.categorie} · {k.zone}</div></div>, search: (k) => `${k.raison_sociale} ${k.sigle || ''} ${k.categorie} ${k.zone}` },
                    { key: 'reponse_statut', header: 'Réponse', render: (k) => (k.reponse_statut ? <StatusBadge value={k.reponse_statut} /> : <span className="text-xs text-slate-500">Non reçue</span>) },
                    { key: 'erreurs', header: 'Qualité', render: (k) => (!k.reponse_statut ? '—' : k.erreurs ? <Badge tone="danger">{k.erreurs} erreur(s)</Badge> : k.alertes ? <Badge tone="attention">{k.alertes} alerte(s)</Badge> : <Badge tone="succes">Conforme</Badge>) },
                    ...(a.cibler ? [{ key: 'retirer', header: '', render: (k) => !k.reponse_statut && <button type="button" className="btn-ghost px-1 text-red-700" aria-label={`Retirer ${k.raison_sociale}`} onClick={(e) => { e.stopPropagation(); retirer(k); }}><UserMinus size={14} /></button> }] : []),
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
                  {c.cibles.length > 0 && <div className="mt-3 text-sm">Avancement du contrôle <Progress value={Math.round((compte('CONTROLEE') / c.cibles.length) * 100)} /></div>}
                </Card>
                <Card title="Historique"><Timeline items={c.historique} /></Card>
              </div>
            </div>
            {modal === 'modifier' && <CampagneModal campagne={c} referentiel={ref.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); state.reload(); }} />}
            {modal === 'cibles' && <AjoutCibles campagne={c} onClose={() => setModal(null)} onDone={() => { setModal(null); state.reload(); }} />}
            {modal === 'retour' && <TextModal title="Retourner la campagne" label="Compléments demandés" confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(t) => post('retourner', { motif: t }, 'Campagne retournée au responsable.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
