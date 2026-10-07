import { useState } from 'react';
import { KeyRound, Lock, LockOpen } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, Tabs, useOnglet, DataTable, Badge, Modal, Field, InfoAlert, runAction } from '../../components/ui';

const ETATS = {
  EN_ATTENTE: ['En attente du Directeur', 'bg-amber-50 text-amber-800 ring-amber-200'],
  CONFIRMEE: ['Confirmée — à exécuter', 'bg-sky-50 text-sky-800 ring-sky-200'],
  EXECUTEE: ['Exécutée', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  ACTIF: ['Actif', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  REFUSEE: ['Refusée', 'bg-slate-100 text-slate-700 ring-slate-200'], REFUSE: ['Refusé', 'bg-slate-100 text-slate-700 ring-slate-200'],
  EXPIREE: ['Expirée', 'bg-slate-100 text-slate-700 ring-slate-200'], EXPIRE: ['Expiré', 'bg-slate-100 text-slate-700 ring-slate-200'],
  ANNULEE: ['Annulée', 'bg-slate-100 text-slate-700 ring-slate-200'], TERMINE: ['Terminé', 'bg-slate-100 text-slate-700 ring-slate-200'],
  REVOQUE: ['Révoqué', 'bg-red-50 text-red-800 ring-red-200'],
};
const Etat = ({ s }) => <Badge className={(ETATS[s] || ETATS.ANNULEE)[1]}>{(ETATS[s] || [s])[0]}</Badge>;

/** Décision protégée par le mot de passe du décideur. */
function Decision({ titre, texte, choix, onClose, onValider }) {
  const [motDePasse, setMdp] = useState('');
  const [commentaire, setCom] = useState('');
  const valider = async (decision) => { await onValider({ decision, motDePasse, commentaire: commentaire || undefined }); onClose(); };
  return (
    <Modal open title={titre} onClose={onClose} footer={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>
      {choix.map(([d, libelle, danger]) => (
        <button key={d} type="button" className={danger ? 'btn-danger' : 'btn-primary'} disabled={!motDePasse || (danger && commentaire.trim().length < 5 && d !== 'REVOQUER')} onClick={() => valider(d)}>{libelle}</button>
      ))}
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-700">{texte}</p>
        <Field label="Observation" hint="Obligatoire en cas de refus"><textarea className="input" rows={2} value={commentaire} onChange={(e) => setCom(e.target.value)} /></Field>
        <Field label="Votre mot de passe" required><input type="password" className="input" autoComplete="current-password" value={motDePasse} onChange={(e) => setMdp(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Operations() {
  const state = useApi('/gouvernance/confirmations');
  const can = useAuth((s) => s.can);
  const [modal, setModal] = useState(null);
  const valideur = can('operations.confirmer');
  return (
    <>
      <InfoAlert>
        Réinitialisation de la base, politique de sécurité, migrations et permissions du rôle Admin Système exigent la confirmation du Directeur.
        La première tentative de l’Admin crée la demande ; une fois confirmée, l’Admin relance la même opération dans les 24 heures. Une confirmation ne sert qu’une fois.
      </InfoAlert>
      {modal && <Decision titre={`Opération critique — ${modal.typeLibelle}`} texte={`${modal.resume} (demandée par ${modal.demandeur} le ${fmtDateTime(modal.created_at)}).`}
        choix={[['REFUSER', 'Refuser', true], ['CONFIRMER', 'Confirmer']]} onClose={() => setModal(null)}
        onValider={async (b) => { await runAction(() => api.post(`/gouvernance/confirmations/${modal.id}/decision`, b), b.decision === 'CONFIRMER' ? 'Opération confirmée.' : 'Opération refusée.'); state.reload(); }} />}
      <Loadable state={state}>
        {(d) => (
          <div className="mt-4">
            <DataTable rows={d.data} empty="Aucune demande." columns={[
              { key: 'typeLibelle', header: 'Opération', render: (x) => <div><div className="font-medium">{x.typeLibelle}</div><div className="text-xs text-slate-500">{x.resume}</div></div> },
              { key: 'demandeur', header: 'Demandée', render: (x) => `${x.demandeur} · ${fmtDateTime(x.created_at)}` },
              { key: 'statut', header: 'État', render: (x) => <div><Etat s={x.statut} />{x.decideur && <div className="mt-1 text-xs text-slate-500">{x.decideur} · {fmtDateTime(x.decide_at)}{x.commentaire ? ` — ${x.commentaire}` : ''}</div>}</div> },
              { key: 'expire_at', header: 'Échéance', render: (x) => (['EN_ATTENTE', 'CONFIRMEE'].includes(x.statut) ? fmtDateTime(x.expire_at) : '—') },
              { key: 'a', header: '', render: (x) => (
                <div className="flex gap-2">
                  {valideur && x.statut === 'EN_ATTENTE' && <button type="button" className="btn-primary py-1" onClick={() => setModal(x)}>Décider</button>}
                  {!valideur && ['EN_ATTENTE', 'CONFIRMEE'].includes(x.statut) && <button type="button" className="btn-secondary py-1" onClick={async () => { await runAction(() => api.post(`/gouvernance/confirmations/${x.id}/annuler`), 'Demande annulée.'); state.reload(); }}>Annuler</button>}
                </div>
              ) },
            ]} />
          </div>
        )}
      </Loadable>
    </>
  );
}

function Support() {
  const state = useApi('/gouvernance/support');
  const can = useAuth((s) => s.can);
  const [f, setF] = useState({ motif: '', entity_type: '', entity_id: '', duree_minutes: 60 });
  const [modal, setModal] = useState(null);
  const demandeur = can('acces_support.demander');
  const demander = async (e) => {
    e.preventDefault();
    await runAction(() => api.post('/gouvernance/support', { ...f, entity_id: f.entity_id || null, entity_type: f.entity_type || null }), 'Demande transmise au Directeur.');
    setF({ motif: '', entity_type: '', entity_id: '', duree_minutes: 60 }); state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>L’Admin Système n’a accès à aucune pièce jointe. Pour une intervention technique, il demande un accès de support motivé, limité à un élément ou à un type d’élément et à 4 heures au plus, validé par le Directeur. L’accès est en lecture seule, chaque consultation est inscrite au journal d’audit, et il expire automatiquement.</InfoAlert>
          {modal && <Decision titre={modal.statut === 'ACTIF' ? 'Révoquer l’accès de support' : 'Accès de support'} texte={`${modal.demandeur} : ${modal.portee}, ${modal.duree_minutes} min. Motif : ${modal.motif}`}
            choix={modal.statut === 'ACTIF' ? [['REVOQUER', 'Révoquer', true]] : [['REFUSER', 'Refuser', true], ['VALIDER', 'Valider']]} onClose={() => setModal(null)}
            onValider={async (b) => { await runAction(() => api.post(`/gouvernance/support/${modal.id}/decision`, b), 'Décision enregistrée.'); state.reload(); }} />}
          {demandeur && (
            <Card title="Demander un accès de support">
              <form onSubmit={demander} className="grid gap-3 sm:grid-cols-4">
                <Field label="Motif" required className="sm:col-span-4"><input className="input" value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} placeholder="Ex. pièce jointe illisible signalée par le Secrétariat" /></Field>
                <Field label="Type d’élément" hint="Vide : toutes les pièces jointes"><select className="input" value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })}><option value="">Toutes</option>{Object.entries(d.types).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                <Field label="N° de l’élément" hint="Facultatif"><input type="number" min={1} className="input" disabled={!f.entity_type} value={f.entity_id} onChange={(e) => setF({ ...f, entity_id: e.target.value })} /></Field>
                <Field label="Durée"><select className="input" value={f.duree_minutes} onChange={(e) => setF({ ...f, duree_minutes: Number(e.target.value) })}>{[15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</select></Field>
                <div className="flex items-end"><button type="submit" className="btn-primary w-full" disabled={f.motif.trim().length < 10}><KeyRound size={16} /> Demander</button></div>
              </form>
            </Card>
          )}
          <DataTable rows={d.data} empty="Aucun accès de support." columns={[
            { key: 'portee', header: 'Portée', render: (x) => <div><div className="font-medium">{x.portee}</div><div className="text-xs text-slate-500">{x.motif}</div></div> },
            { key: 'demandeur', header: 'Demandé', render: (x) => `${x.demandeur} · ${fmtDateTime(x.created_at)}` },
            { key: 'duree', header: 'Période', render: (x) => (x.debut_at ? `${fmtDateTime(x.debut_at)} → ${fmtDateTime(x.fin_at)}` : `${x.duree_minutes} min`) },
            { key: 'statut', header: 'État', render: (x) => <div><Etat s={x.statut} />{x.decideur && <div className="mt-1 text-xs text-slate-500">{x.decideur}{x.commentaire ? ` — ${x.commentaire}` : ''}</div>}</div> },
            { key: 'consultations', header: 'Consultations' },
            { key: 'a', header: '', render: (x) => (
              <div className="flex gap-2">
                {can('acces_support.valider') && ['EN_ATTENTE', 'ACTIF'].includes(x.statut) && <button type="button" className={x.statut === 'ACTIF' ? 'btn-secondary py-1 text-red-700' : 'btn-primary py-1'} onClick={() => setModal(x)}>{x.statut === 'ACTIF' ? 'Révoquer' : 'Décider'}</button>}
                {demandeur && ['EN_ATTENTE', 'ACTIF'].includes(x.statut) && <button type="button" className="btn-secondary py-1" onClick={async () => { await runAction(() => api.post(`/gouvernance/support/${x.id}/terminer`), 'Accès terminé.'); state.reload(); }}>Terminer</button>}
              </div>
            ) },
          ]} />
        </div>
      )}
    </Loadable>
  );
}

function Urgence() {
  const state = useApi('/gouvernance/urgence');
  const can = useAuth((s) => s.can);
  const [ouvrir, setOuvrir] = useState(false);
  const [f, setF] = useState({ motif: '', heures: 4, motDePasse: '' });
  const [secret, setSecret] = useState(null);
  const activer = async () => {
    const r = await runAction(() => api.post('/gouvernance/urgence/activer', f), 'Compte d’urgence activé.');
    setSecret(r.data); setOuvrir(false); setF({ motif: '', heures: 4, motDePasse: '' }); state.reload();
  };
  const fermer = async () => { await runAction(() => api.post('/gouvernance/urgence/fermer', { motif: 'Fin de l’intervention' }), 'Compte d’urgence refermé.'); state.reload(); };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>
            Le compte d’urgence <b>{d.username}</b> est distinct du compte de l’Admin Système. Il reste scellé (désactivé, mot de passe inconnu) et ne s’active que par le Directeur
            ou le Secrétaire Général, pour {d.dureeMaxHeures} heures au plus, lorsque l’Admin est indisponible. Toute activation et toute connexion sont signalées immédiatement ;
            le compte se referme seul à l’échéance. En dernier recours, il s’active sur le serveur : <code>npm run urgence -- activer 4 "motif"</code>.
          </InfoAlert>
          {secret && (
            <Card title="Mot de passe temporaire du compte d’urgence">
              <p className="text-sm">Remettez-le de façon sécurisée à la personne chargée de l’intervention : il ne sera plus affiché. À la connexion, elle choisira un nouveau mot de passe et configurera la double authentification.</p>
              <div className="mt-2 flex flex-wrap items-center gap-4"><span>Identifiant : <b>{secret.username}</b></span><code className="rounded bg-slate-100 px-3 py-1 text-lg">{secret.motDePasseTemporaire}</code><span className="text-sm text-slate-600">fermeture automatique le {fmtDateTime(secret.jusqua)}</span></div>
              <button type="button" className="btn-secondary mt-3" onClick={() => setSecret(null)}>J’ai remis le mot de passe</button>
            </Card>
          )}
          <Card title="État">
            <div className="flex flex-wrap items-center gap-3">
              {d.actif
                ? <Badge className="bg-red-50 text-red-800 ring-red-200"><LockOpen size={12} /> Actif jusqu’au {fmtDateTime(d.jusqua)}</Badge>
                : <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200"><Lock size={12} /> Scellé</Badge>}
              {!d.actif && can('urgence.activer') && <button type="button" className="btn-danger" onClick={() => setOuvrir(true)}><LockOpen size={16} /> Activer le compte d’urgence</button>}
              {d.actif && can('urgence.desactiver') && <button type="button" className="btn-primary" onClick={fermer}><Lock size={16} /> Refermer maintenant</button>}
            </div>
          </Card>
          {ouvrir && (
            <Modal open title="Activer le compte d’urgence" onClose={() => setOuvrir(false)} footer={<>
              <button type="button" className="btn-secondary" onClick={() => setOuvrir(false)}>Annuler</button>
              <button type="button" className="btn-danger" disabled={f.motif.trim().length < 10 || !f.motDePasse} onClick={activer}>Activer</button>
            </>}>
              <div className="space-y-3">
                <InfoAlert tone="warning">L’activation est signalée immédiatement à l’Admin Système, au Directeur et au Secrétaire Général.</InfoAlert>
                <Field label="Motif" required><textarea className="input" rows={2} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></Field>
                <Field label="Durée (heures)" required><input type="number" min={1} max={d.dureeMaxHeures} className="input" value={f.heures} onChange={(e) => setF({ ...f, heures: Number(e.target.value) })} /></Field>
                <Field label="Votre mot de passe" required><input type="password" className="input" autoComplete="current-password" value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} /></Field>
              </div>
            </Modal>
          )}
          <DataTable rows={d.historique} searchable={false} empty="Aucune activation." columns={[
            { key: 'debut_at', header: 'Activé', render: (x) => `${fmtDateTime(x.debut_at)} par ${x.active_par}` },
            { key: 'motif', header: 'Motif' },
            { key: 'connexions', header: 'Connexions' },
            { key: 'fin_at', header: 'Fermé', render: (x) => (x.fin_at ? `${fmtDateTime(x.fin_at)} par ${x.ferme_par} — ${x.motif_fermeture}` : <Badge className="bg-red-50 text-red-800 ring-red-200">En cours</Badge>) },
          ]} />
        </div>
      )}
    </Loadable>
  );
}

/** Gouvernance du compte Admin Système : opérations critiques, accès de support, compte d’urgence. */
export default function Gouvernance() {
  const can = useAuth((s) => s.can);
  const onglets = [
    (can('operations.confirmer') || can('systeme.maintenir') || can('role.attribuer')) && { value: 'operations', label: 'Opérations critiques' },
    (can('acces_support.demander') || can('acces_support.valider')) && { value: 'support', label: 'Accès de support' },
    (can('urgence.activer') || can('urgence.desactiver')) && { value: 'urgence', label: 'Compte d’urgence' },
  ].filter(Boolean);
  const [tab, setTab] = useOnglet(onglets[0]?.value, { valeurs: onglets.map((t) => t.value) });
  return (
    <>
      <PageHeader title="Gouvernance" subtitle="Contrôle des pouvoirs techniques : aucune opération critique, aucun accès aux pièces et aucun compte d’urgence sans décision du Directeur ou du Secrétaire Général."
        breadcrumb={[{ label: 'Administration' }, { label: 'Gouvernance' }]} />
      <Tabs value={tab} onChange={setTab} tabs={onglets} />
      <div className="mt-4">
        {tab === 'operations' && <Operations />}
        {tab === 'support' && <Support />}
        {tab === 'urgence' && <Urgence />}
      </div>
    </>
  );
}

