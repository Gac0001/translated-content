import { Link } from 'react-router-dom';
import {
  Users, UserCheck, Lock, Activity, Database, Send, ListTodo, FileText, CalendarCheck, Mail, FolderKanban,
  AlertTriangle, Clock, Building2, Bell, DatabaseZap, UserX, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../store/auth';
import { useApi, Loadable, PageHeader, Card, Stat, StatusBadge, Progress, Empty, Badge, RangBadge, InfoAlert, BarList, MiniStats, CardLink, DataTable } from '../components/ui';
import { fmtDate, fmtDateTime, fmtMontant, isOverdue } from '../lib/format';
import { DEP_NOM, ROLES, STATUTS, PERIMETRES, NOTIF_TYPES, DELEGATIONS } from '../lib/labels';
import { Progression } from './comptes/ListeDeclarative';
import { EtatBadge } from './systeme/Sante';

const sum = (obj = {}, keys) => keys.reduce((s, k) => s + (obj[k] || 0), 0);
const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'BLOQUEE', 'RAPPORT_INTERMEDIAIRE', 'A_CORRIGER', 'EN_RETARD'];

function MiniList({ rows = [], to, render, empty = 'Rien à signaler.' }) {
  if (!rows.length) return <Empty compact message={empty} />;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={`${r.type || ''}${r.id}`}><Link to={typeof to === 'function' ? to(r) : `${to}/${r.id}`} className="-mx-2 block rounded px-2 py-2 hover:bg-slate-50">{render(r)}</Link></li>
      ))}
    </ul>
  );
}

/** Taux d’exécution par structure : barre horizontale à une seule teinte, valeur écrite. */
function PerformanceBars({ perf }) {
  const rows = [];
  for (const d of perf.divisions) {
    rows.push({ key: `d${d.id}`, nom: d.nom, rang: 'DIVISION', v: d.tauxExecution, detail: d, indent: false });
    for (const b of d.bureaux || []) rows.push({ key: `b${b.id}`, nom: b.nom, rang: 'BUREAU', v: b.tauxExecution, detail: b, indent: true });
  }
  for (const b of perf.bureauxRattachesDirection) rows.push({ key: `b${b.id}`, nom: b.nom, rang: 'BUREAU', v: b.tauxExecution, detail: b, direct: true });
  return (
    <>
      <BarList label="Taux d’exécution par structure" rows={rows.map((r) => ({
        key: r.key, label: r.nom, value: r.v, strong: r.rang === 'DIVISION', indent: r.indent,
        avant: <RangBadge rang={r.rang} />, apres: r.direct && <Badge tone="ambre">Rattaché au Directeur</Badge>,
        detail: [['Tâches', r.detail.taches], ['Instructions', r.detail.instructions], ['En retard', r.detail.tachesEnRetard + r.detail.instructionsEnRetard]],
      }))} />
      <p className="pt-2 text-xs text-slate-500">Taux d’exécution = tâches et instructions exécutées, validées ou clôturées ÷ total. Les Divisions et le Bureau directement rattaché au Directeur sont présentés séparément.</p>
    </>
  );
}

function Echeances({ rows }) {
  return <MiniList rows={rows} to={(r) => (r.type === 'TACHE' ? `/taches/${r.id}` : `/instructions/${r.id}`)} empty="Aucune échéance en cours." render={(r) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="min-w-0 truncate"><span className="text-xs text-slate-500">{r.type === 'TACHE' ? 'Tâche' : 'Instruction'} · </span>{r.titre}</span>
      <span className={`shrink-0 text-xs ${isOverdue(r.echeance, r.statut) ? 'font-semibold text-red-700' : 'text-slate-600'}`}>{fmtDate(r.echeance)}</span>
    </div>
  )} />;
}

/** Mise en service des comptes : affichée tant que des agents de la liste n’ont pas de compte ou que la liste est à valider. */
function MiseEnService({ p }) {
  const can = useAuth((s) => s.can);
  const restant = p.secretariat.total - p.secretariat.avecCompte + p.autres.total - p.autres.avecCompte;
  if (p.statutListe === 'VALIDEE' && restant === 0 && p.directeur) return null;
  const actions = <>
    {can('liste.consulter') && <CardLink to="/liste-declarative">Liste déclarative</CardLink>}
    {can('compte.enroler') && <CardLink to="/comptes/enrolement">Enrôlement</CardLink>}
  </>;
  return (
    <Card title="Mise en service des comptes" actions={actions}>
      {can('liste.valider') && p.statutListe !== 'VALIDEE' && p.secretariat.total + p.autres.total > 0 && <div className="mb-3"><InfoAlert tone="warning">La liste déclarative des agents {p.statutListe === 'A_REVALIDER' ? 'a changé et doit être revalidée' : 'attend votre validation'}. <Link to="/liste-declarative" className="font-medium underline">Ouvrir la liste</Link></InfoAlert></div>}
      <Progression p={p} />
    </Card>
  );
}

function BanniereDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <DatabaseZap size={22} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">La base contient des données fictives de démonstration.</div>
        <div>Avant la mise en service, réinitialisez-la : le Directeur pourra alors importer et valider la liste officielle des agents de la Direction.</div>
      </div>
      <Link to="/systeme/reinitialisation" className="btn-primary">Réinitialiser la base</Link>
    </div>
  );
}

const ORDRE_SANTE = ['api', 'postgresql', 'stockage', 'sauvegarde', 'courriels', 'documents'];
const ACTIONS_SENSIBLES = {
  CHANGEMENT_ROLE: 'Changement de rôle', BLOCAGE: 'Blocage de compte', DESACTIVATION: 'Désactivation', REINITIALISATION_MDP: 'Réinitialisation de mot de passe',
  CHANGEMENT_MDP_IMPOSE: 'Changement de mot de passe imposé', POLITIQUE_SECURITE: 'Politique de sécurité', REINITIALISATION: 'Réinitialisation de la base',
  REVOCATION_SESSION: 'Fermeture de session', EXPORT: 'Export', CHANGEMENT_APPAREIL_2FA: 'Changement d’appareil 2FA', CODES_SECOURS: 'Codes de secours',
  AUTORISATION: 'Autorisation d’enrôlement', SAUVEGARDE: 'Sauvegarde', RESOLUTION_ERREUR: 'Erreur résolue',
};
const fmtOctets = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} Go` : `${Math.round(n / 1048576)} Mo`);

function AdminPanel({ a }) {
  const s = a.systeme.sante;
  const disque = a.systeme.disque;
  const etatDisque = disque && (disque.pourcentLibre < disque.seuilCritique ? 'PANNE' : disque.pourcentLibre < disque.seuilAttention ? 'ATTENTION' : 'OK');
  const sv = a.sauvegardes;
  const heuresSauvegarde = sv.derniereReussie ? Math.round((Date.now() - new Date(sv.derniereReussie.date).getTime()) / 3600000) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Utilisateurs" value={a.comptes.total} icon={Users} to="/comptes" />
        <Stat label="Comptes actifs" value={a.comptes.actifs} icon={UserCheck} tone="vert" />
        <Stat label="Comptes désactivés" value={a.comptes.desactives} icon={UserX} tone="gris" />
        <Stat label="Comptes verrouillés" value={a.comptes.verrouilles} icon={Lock} tone={a.comptes.verrouilles ? 'rouge' : 'gris'} />
        <Stat label={`Inactifs (> ${a.comptes.seuilInactiviteJours} j)`} value={a.comptes.inactifs} icon={Clock} tone={a.comptes.inactifs ? 'jaune' : 'gris'} to="/comptes" />
        <Stat label="Sessions actives" value={a.securite.sessionsActives} icon={Activity} hint={`${a.securite.utilisateursConnectes} utilisateur(s)`} to="/securite" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Santé du système" actions={<CardLink to="/systeme/sante">Détails</CardLink>}>
          {s ? (
            <>
              <div className="mb-3 flex items-center gap-2"><EtatBadge statut={s.global} /><span className="text-xs text-slate-500">vérifié le {fmtDateTime(s.verifieAt)}</span></div>
              <ul className="space-y-1.5 text-sm">
                {ORDRE_SANTE.filter((k) => s.composants[k]).map((k) => (
                  <li key={k} className="flex items-center justify-between gap-2"><span>{s.composants[k].libelle}</span><EtatBadge statut={s.composants[k].statut} /></li>
                ))}
              </ul>
            </>
          ) : <p className="text-sm text-slate-500">Aucun contrôle encore réalisé. <Link to="/systeme/sante" className="text-dep-700 underline">Vérifier maintenant</Link></p>}
        </Card>
        <Card title="Sécurité" actions={<CardLink to="/securite">Ouvrir</CardLink>}>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Alertes critiques ouvertes</span><b className={a.securite.alertes.CRITIQUE ? 'text-red-700' : ''}>{a.securite.alertes.CRITIQUE}</b></li>
            <li className="flex justify-between"><span>Alertes à surveiller</span><b className={a.securite.alertes.ATTENTION ? 'text-amber-700' : ''}>{a.securite.alertes.ATTENTION}</b></li>
            <li className="flex justify-between"><span>Échecs de connexion (24 h / 7 j)</span><b>{a.securite.echecsConnexion24h} / {a.securite.echecsConnexion7j}</b></li>
            <li className="flex justify-between"><span>Connexions réussies (24 h)</span><b>{a.securite.connexions24h}</b></li>
            <li className="flex justify-between"><span>Mots de passe à changer</span><b>{a.comptes.changementMdpRequis}</b></li>
            <li className="flex justify-between"><span>Dernière vérification</span><b className="text-right text-xs">{a.securite.derniereVerification ? `${fmtDateTime(a.securite.derniereVerification.at)} — ${a.securite.derniereVerification.bilan}` : 'jamais'}</b></li>
          </ul>
          {a.securite.comptesVerrouilles.length > 0 && (
            <div className="mt-3 border-t pt-2 text-sm">
              <div className="mb-1 font-medium text-red-700">Comptes verrouillés</div>
              {a.securite.comptesVerrouilles.map((u) => <Link key={u.id} to={`/comptes/${u.id}`} className="link block">{u.username} — jusqu’au {fmtDateTime(u.locked_until)}</Link>)}
            </div>
          )}
        </Card>
        <Card title="Sauvegardes et stockage" actions={<CardLink to="/systeme">Sauvegardes</CardLink>}>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between gap-2"><span>Dernière sauvegarde réussie</span><b className={`text-right ${heuresSauvegarde === null || heuresSauvegarde > 48 ? 'text-amber-700' : ''}`}>{sv.derniereReussie ? `${fmtDateTime(sv.derniereReussie.date)} (il y a ${heuresSauvegarde} h)` : 'aucune'}</b></li>
            <li className="flex justify-between"><span>Sauvegardes échouées (30 j)</span><b className={sv.echecs30j ? 'text-red-700' : ''}>{sv.echecs30j}</b></li>
            <li className="flex justify-between"><span>Taille de la base</span><b>{a.systeme.tailleBase}</b></li>
          </ul>
          {disque && (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-sm"><span>Espace disque (part utilisée)</span><EtatBadge statut={etatDisque} /></div>
              <Progress value={Math.round(100 - disque.pourcentLibre)} />
              <p className="mt-1 text-xs text-slate-500">{fmtOctets(disque.libre)} libres sur {fmtOctets(disque.total)} ({disque.pourcentLibre} %) — alerte sous {disque.seuilAttention} %, critique sous {disque.seuilCritique} %.</p>
            </div>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={`Erreurs techniques ouvertes (${a.erreurs.ouvertes})`} actions={<CardLink to="/systeme/erreurs">Journal technique</CardLink>}>
          {a.erreurs.recentes.length ? (
            <ul className="space-y-2 text-xs">
              {a.erreurs.recentes.map((e) => (
                <li key={e.id}><code className="text-xs">{e.methode} {e.route}</code> <Badge>{e.occurrences}×</Badge><div className="truncate text-slate-600">{e.message}</div><div className="text-slate-500">{fmtDateTime(e.derniere_at)}</div></li>
              ))}
            </ul>
          ) : <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} /> Aucune erreur technique ouverte.</p>}
        </Card>
        <Card title="Dernières opérations sensibles" actions={<CardLink to="/audit">Journal d’audit</CardLink>}>
          {a.operationsSensibles.length ? (
            <ul className="space-y-1.5 text-xs">
              {a.operationsSensibles.map((l) => (
                <li key={l.id} className="flex gap-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.resultat === 'SUCCES' ? 'bg-emerald-500' : 'bg-red-500'}`} aria-label={l.resultat === 'SUCCES' ? 'Succès' : 'Échec'} />
                  <span className="min-w-0 flex-1"><b>{l.username || 'système'}</b> · {ACTIONS_SENSIBLES[l.action] || l.action}{l.message ? <span className="block truncate text-slate-500">{l.message}</span> : null}</span>
                  <span className="shrink-0 text-slate-500">{fmtDateTime(l.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Aucune opération sensible.</p>}
        </Card>
        <Card title="Application">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Version</span><b>{a.systeme.version.version}{a.systeme.version.commit ? ` (${a.systeme.version.commit})` : ''}</b></li>
            <li className="flex items-center gap-2"><Database size={16} className="text-emerald-600" /> Backend : <b>{a.systeme.version.environnement}</b>, Node.js {a.systeme.version.node}</li>
            <li className="flex justify-between gap-2"><span>Dernière migration</span><b className="truncate pl-2 text-xs">{a.systeme.derniereMigration}</b></li>
            <li className="flex justify-between"><span>Disponibilité de l’API</span><b>{Math.round(a.systeme.uptimeSecondes / 60)} min</b></li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function SGPanel({ d }) {
  const s = d.statistiques;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Divisions" value={d.vueGlobale.divisions} icon={Building2} to="/organigramme" />
        <Stat label="Bureaux" value={d.vueGlobale.bureaux} hint={`dont ${d.vueGlobale.bureauxRattachesDirection} rattaché(s) au Directeur`} icon={Building2} tone="gris" />
        <Stat label="Agents en fonction" value={d.vueGlobale.agents} icon={Users} tone="vert" />
        <Stat label="Documents validés" value={s.documentsValides} icon={FileText} tone="violet" to="/documents" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Instructions adressées au Directeur" actions={<Link to="/instructions/nouvelle" className="btn-primary py-1.5"><Send size={14} /> Nouvelle instruction</Link>}>
          <MiniList rows={d.instructionsAuDirecteur} to="/instructions" empty="Aucune instruction adressée." render={(i) => (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate font-medium">{i.objet}</span><StatusBadge value={i.statut} /></div>
              <Progress value={i.avancement} />
              <div className="text-xs text-slate-500">{i.reference} · échéance {fmtDate(i.echeance)}{i.date_reponse ? ` · compte rendu reçu le ${fmtDate(i.date_reponse)}` : ''}</div>
            </div>
          )} />
        </Card>
        <Card title="Activités consolidées de la DEP">
          <MiniStats items={[
            ['Instructions en cours', sum(s.instructions, ACTIVE)], ['Instructions en retard', s.instructions.EN_RETARD || 0, 'danger'],
            ['Tâches en cours', sum(s.taches, ACTIVE)], ['Tâches en retard', s.taches.EN_RETARD || 0, 'danger'],
            ['Tâches exécutées', sum(s.taches, ['EXECUTEE', 'VALIDEE', 'CLOTUREE'])], ['Courriers en circulation', s.courriers.EN_CIRCULATION || 0],
          ]} />
          <div className="mt-3 border-t pt-3 text-sm">
            <div className="mb-1 font-medium">Projets PIP</div>
            {d.pip.length ? d.pip.map((p) => <div key={p.statut} className="flex justify-between"><span>{STATUTS[p.statut]?.[0] || p.statut} ({p.nombre})</span><span className="tabular-nums">{fmtMontant(p.cout)}</span></div>) : <span className="text-slate-500">Aucun projet soumis.</span>}
          </div>
        </Card>
      </div>
      <Card title="Résultats par structure" className="mt-4"><PerformanceBars perf={d.performance} /></Card>
    </>
  );
}

function DirecteurPanel({ d }) {
  const retard = d.tachesEnRetard.length + d.instructionsEnRetard.length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Documents à valider" value={d.documentsAValider.length} icon={FileText} tone={d.documentsAValider.length ? 'jaune' : 'gris'} to="/documents" />
        <Stat label="Travaux en retard" value={retard} icon={AlertTriangle} tone={retard ? 'rouge' : 'gris'} to="/taches?statut=EN_RETARD" />
        <Stat label="Présences soumises" value={d.presencesSoumises.length} hint={d.presencesSemaine ? `Taux de présence : ${d.presencesSemaine.tauxPresence ?? '—'} %` : null} icon={CalendarCheck} tone="violet" to="/presences?statut=SOUMISE" />
        <Stat label="Courriers à réceptionner" value={d.courriersARecevoir.length} icon={Mail} tone={d.courriersARecevoir.length ? 'jaune' : 'gris'} to="/courriers?onglet=recevoir" />
      </div>
      {d.decisions && <PilotageCard d={d} />}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Documents à valider" actions={<CardLink to="/documents" />}>
          <MiniList rows={d.documentsAValider} to="/documents" empty="Aucun document en attente." render={(x) => <div className="text-sm"><div className="truncate font-medium">{x.titre}</div><div className="text-xs text-slate-500">{x.reference} · {fmtDateTime(x.updated_at)}</div></div>} />
        </Card>
        <Card title="Tâches en retard" actions={<CardLink to="/taches?statut=EN_RETARD" />}>
          <MiniList rows={d.tachesEnRetard} to="/taches" empty="Aucune tâche en retard." render={(t) => <div className="text-sm"><div className="truncate font-medium">{t.titre}</div><div className="text-xs text-red-700">{t.nom} · {t.bureau} · échéance {fmtDate(t.echeance)}</div></div>} />
        </Card>
        <Card title="Instructions du Secrétaire Général" actions={<CardLink to="/instructions?boite=recues" />}>
          <MiniList rows={d.instructionsRecues} to="/instructions" empty="Aucune instruction reçue." render={(i) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate">{i.objet}</span><StatusBadge value={i.statut} /></div><Progress value={i.avancement} /></div>} />
        </Card>
        <Card title="Présences soumises" actions={<CardLink to="/presences?statut=SOUMISE" />}>
          <MiniList rows={d.presencesSoumises} to="/presences" empty="Aucune liste en attente." render={(p) => <div className="text-sm"><div className="font-medium">{p.bureau || 'Direction (toutes structures)'}</div><div className="text-xs text-slate-500">{p.reference} · soumise le {fmtDateTime(p.submitted_at)}</div></div>} />
        </Card>
        <Card title="Courriers" actions={<CardLink to="/courriers?onglet=recevoir">À réceptionner</CardLink>}>
          <MiniList rows={d.courriersARecevoir} to="/courriers" empty="Aucun courrier à réceptionner." render={(c) => <div className="text-sm"><div className="truncate font-medium">{c.objet}</div><div className="text-xs text-slate-500">{c.numero_enregistrement} · {fmtDateTime(c.created_at)}</div></div>} />
          <div className="mt-2 flex flex-wrap gap-2 border-t pt-2 text-xs">{Object.entries(d.courriers).map(([k, v]) => <Badge key={k}>{STATUTS[k]?.[0] || k} : {v}</Badge>)}</div>
        </Card>
        <Card title="Projets PIP à valider" actions={<CardLink to="/pip?statut=VERIFIE" />}>
          <MiniList rows={d.pipAValider} to="/pip" empty="Aucune fiche à valider." render={(p) => <div className="text-sm"><div className="truncate font-medium">{p.intitule}</div><div className="text-xs text-slate-500">{p.code} · {fmtMontant(p.cout_total, p.devise)}</div></div>} />
          <div className="mt-2 flex flex-wrap gap-2 border-t pt-2 text-xs">{Object.entries(d.pip).map(([k, v]) => <Badge key={k}>{STATUTS[k]?.[0] || k} : {v}</Badge>)}</div>
        </Card>
      </div>
      {d.effectif && <EffectifCard e={d.effectif} />}
      <Card title="Performance des structures" className="mt-4"><PerformanceBars perf={d.performance} /></Card>
    </>
  );
}

/** Centre de pilotage du Directeur : décisions, agenda du jour, demandes du Secrétaire Général. */
function PilotageCard({ d }) {
  const heure = (x) => new Date(x).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' });
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card title="Décisions à suivre" actions={<CardLink to="/decisions">Registre</CardLink>}>
        <div className="mb-2 flex gap-2 text-xs"><Badge>{d.decisions.ouvertes} ouverte(s)</Badge>{d.decisions.enRetard > 0 && <Badge className="bg-red-50 text-red-800 ring-red-200">{d.decisions.enRetard} en retard</Badge>}</div>
        <MiniList rows={d.decisions.liste} to="/decisions" empty="Aucune décision ouverte." render={(x) => <div className="text-sm"><div className="truncate font-medium">{x.libelle}</div><div className={`text-xs ${x.en_retard ? 'text-red-700' : 'text-slate-500'}`}>{x.responsable_nom} · {x.echeance ? `échéance ${fmtDate(x.echeance)}` : 'sans échéance'}</div></div>} />
      </Card>
      <Card title="Agenda du jour" actions={<CardLink to="/agenda">Agenda</CardLink>}>
        <MiniList rows={d.agendaDuJour} to={(e) => (e.reunion_id ? `/reunions/${e.reunion_id}` : '/agenda')} empty="Aucun rendez-vous aujourd’hui." render={(e) => <div className="flex gap-3 text-sm"><span className="w-12 shrink-0 font-semibold tabular-nums text-dep-800">{heure(e.debut)}</span><div className="min-w-0"><div className="truncate font-medium">{e.titre}</div><div className="text-xs text-slate-500">{e.lieu || '—'}</div></div></div>} />
      </Card>
      <Card title="Demandes du Secrétaire Général" actions={<CardLink to="/demandes-information">Toutes</CardLink>}>
        <MiniList rows={d.demandesInfo} to="/demandes-information" empty="Aucune demande en attente." render={(x) => <div className="text-sm"><div className="truncate font-medium">{x.objet}</div><div className="text-xs text-slate-500">{x.reference}{x.echeance ? ` · réponse attendue le ${fmtDate(x.echeance)}` : ''}</div></div>} />
      </Card>
    </div>
  );
}

/** Effectif organique de référence comparé à l’effectif réel, et postes de commandement vacants. */
function EffectifCard({ e }) {
  const t = e.totaux;
  return (
    <Card title="Effectif organique et effectif réel" className="mt-4" actions={<CardLink to="/cadre-organique#effectif">Détail</CardLink>}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="text-sm">
          <div className="text-2xl font-semibold">{t.reel} <span className="text-base font-normal text-slate-500">/ {t.prevu} prévus</span></div>
          <div className="text-xs text-slate-500">dont {t.horsReference} hors cadre de référence · {t.vacances} vacance(s) · {t.sureffectifs} sureffectif(s)</div>
        </div>
        <div className="text-sm">
          <div className="mb-1 font-medium">Écarts</div>
          {e.ecarts.length ? e.ecarts.map((l) => <div key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.libelle}</span><span className={l.ecart < 0 ? 'text-amber-700' : 'text-red-700'}>{l.reel}/{l.prevu} ({l.ecart > 0 ? '+' : ''}{l.ecart})</span></div>) : <div className="text-slate-500">Effectif conforme à la référence.</div>}
        </div>
        <div className="text-sm">
          <div className="mb-1 font-medium">Postes de commandement vacants</div>
          {e.postesVacants.length ? e.postesVacants.map((p) => <div key={p.posteId} className="truncate">{p.codeOrganique && <span className="mr-1 font-mono text-xs text-slate-500">{p.codeOrganique}</span>}{p.poste}</div>) : <div className="text-slate-500">Aucun poste vacant.</div>}
        </div>
      </div>
    </Card>
  );
}

function ChefDivisionPanel({ d }) {
  return (
    <>
      {d.division && <InfoAlert>{d.division.nom} — {d.division.missions}</InfoAlert>}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Documents à examiner" value={d.documentsAExaminer.length} icon={FileText} tone={d.documentsAExaminer.length ? 'jaune' : 'gris'} to="/documents" />
        <Stat label="Tâches en cours" value={sum(d.taches, ACTIVE)} icon={ListTodo} to="/taches" />
        <Stat label="Tâches en retard" value={d.tachesEnRetard.length} icon={AlertTriangle} tone={d.tachesEnRetard.length ? 'rouge' : 'gris'} />
        <Stat label="Fiches PIP à vérifier" value={d.pipAVerifier.length} icon={FolderKanban} tone="violet" to="/pip" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Bureaux rattachés à la Division" bodyClass="p-0">
          <DataTable encadre={false} searchable={false} label="Bureaux rattachés à la Division" rows={d.bureaux} empty="Aucun Bureau rattaché." columns={[
            { key: 'nom', header: 'Bureau', primary: true, render: (b) => <Link className="link" to={`/structures/bureau/${b.id}`}>{b.nom}</Link> },
            { key: 'agents', header: 'Agents', className: 'tabular-nums' },
            { key: 'taches', header: 'Tâches', className: 'tabular-nums' },
            { key: 'tachesEnRetard', header: 'En retard', className: 'tabular-nums', render: (b) => (b.tachesEnRetard > 0 ? <span className="font-semibold text-red-700">{b.tachesEnRetard}</span> : 0) },
            { key: 'tauxExecution', header: 'Exécution', className: 'tabular-nums', render: (b) => (b.tauxExecution === null ? '—' : `${b.tauxExecution} %`) },
          ]} />
        </Card>
        <Card title="Documents à examiner">
          <MiniList rows={d.documentsAExaminer} to="/documents" empty="Aucun document à examiner." render={(x) => <div className="flex justify-between gap-2 text-sm"><span className="truncate">{x.titre}</span><StatusBadge value={x.statut} /></div>} />
        </Card>
        <Card title="Instructions reçues du Directeur">
          <MiniList rows={d.instructionsRecues} to="/instructions" render={(i) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate">{i.objet}</span><StatusBadge value={i.statut} /></div><Progress value={i.avancement} /></div>} />
        </Card>
        <Card title="Présences du périmètre">
          <MiniList rows={d.presences} to="/presences" empty="Aucune liste." render={(p) => <div className="flex justify-between gap-2 text-sm"><span className="truncate">{p.bureau || 'Direction'} — {p.reference}</span><StatusBadge value={p.statut} /></div>} />
        </Card>
      </div>
    </>
  );
}

function ChefBureauPanel({ d }) {
  return (
    <>
      {d.bureau && (
        <div className="card flex flex-wrap items-center gap-2 p-3 text-sm">
          <b>{d.bureau.nom}</b><RangBadge rang="BUREAU" />
          <Badge tone={d.bureau.estSecretariatDirection ? 'ambre' : 'neutre'}>{d.bureau.rattachement}</Badge>
          <span className="text-slate-600">· Supérieur direct : {d.bureau.superieurDirect}</span>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Agents du Bureau" value={d.agents.length} icon={Users} />
        <Stat label="Tâches en cours" value={sum(d.taches, ACTIVE)} icon={ListTodo} to="/taches" />
        <Stat label="À valider (exécutées)" value={d.taches.EXECUTEE || 0} icon={Activity} tone="violet" to="/taches?statut=EXECUTEE" />
        <Stat label="Documents à vérifier" value={d.documentsAVerifier.length} icon={FileText} tone={d.documentsAVerifier.length ? 'jaune' : 'gris'} to="/documents" />
      </div>
      {d.delegations?.length > 0 && <div className="mt-4"><InfoAlert>Opérations exercées par désignation du Directeur : {d.delegations.map((x) => DELEGATIONS[x] || x).join(', ')}. Ces désignations, fondées sur un acte, ne modifient pas le rang du Bureau.</InfoAlert></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Agents du Bureau" actions={<Link to="/taches/nouvelle" className="btn-primary py-1.5"><ListTodo size={14} /> Attribuer une tâche</Link>}>
          <ul className="divide-y divide-slate-100">{d.agents.map((a) => <li key={a.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"><Link to={`/personnel/${a.id}`} className="link">{a.nom}</Link><span className="text-xs text-slate-500 sm:text-right">{a.poste} · {a.taches_en_cours} tâche(s) en cours</span></li>)}</ul>
        </Card>
        <Card title="Tâches et échéances">
          <MiniList rows={d.tachesEnCours} to="/taches" empty="Aucune tâche." render={(t) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate">{t.titre} <span className="text-xs text-slate-500">— {t.nom}</span></span><StatusBadge value={t.statut} /></div><div className="flex items-center gap-3"><div className="flex-1"><Progress value={t.avancement} /></div><span className={`text-xs ${isOverdue(t.echeance, t.statut) ? 'text-red-700' : 'text-slate-500'}`}>{fmtDate(t.echeance)}</span></div></div>} />
        </Card>
        <Card title="Présences du Bureau" actions={<CardLink to="/presences/nouvelle">Nouvelle liste</CardLink>}>
          <MiniList rows={d.presences} to="/presences" empty="Aucune liste." render={(p) => <div className="flex justify-between gap-2 text-sm"><span>Semaine du {fmtDate(p.semaine_debut)}</span><StatusBadge value={p.statut} /></div>} />
        </Card>
        <Card title="Instructions reçues">
          <MiniList rows={d.instructionsRecues} to="/instructions" render={(i) => <div className="flex justify-between gap-2 text-sm"><span className="truncate">{i.objet}</span><StatusBadge value={i.statut} /></div>} />
        </Card>
      </div>
    </>
  );
}

function AgentPanel({ d }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tâches en cours" value={d.taches.filter((t) => ACTIVE.includes(t.statut)).length} icon={ListTodo} to="/taches" />
        <Stat label="En retard" value={d.taches.filter((t) => t.statut === 'EN_RETARD').length} icon={Clock} tone="rouge" />
        <Stat label="Documents en cours" value={d.documents.filter((x) => ['BROUILLON', 'A_CORRIGER', 'EN_RELECTURE', 'VISE'].includes(x.statut)).length} icon={FileText} tone="violet" to="/documents" />
        <Stat label="Notifications non lues" value={d.notificationsNonLues} icon={Bell} tone="jaune" to="/notifications" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Mes tâches" className="lg:col-span-2">
          <MiniList rows={d.taches} to="/taches" empty="Aucune tâche attribuée." render={(t) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate font-medium">{t.titre}</span><StatusBadge value={t.statut} /></div><div className="flex items-center gap-3"><div className="flex-1"><Progress value={t.avancement} /></div><span className={`text-xs ${isOverdue(t.echeance, t.statut) ? 'text-red-700' : 'text-slate-500'}`}>Échéance {fmtDate(t.echeance)}</span></div></div>} />
        </Card>
        <Card title="Mon profil" actions={<CardLink to="/profil">Voir le profil</CardLink>}>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-slate-500">Nom</dt><dd className="font-medium">{d.profil.nom}</dd></div>
            <div><dt className="text-xs text-slate-500">Matricule</dt><dd>{d.profil.matricule || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Bureau</dt><dd>{d.profil.bureau || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Division</dt><dd>{d.profil.division || '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Poste</dt><dd>{d.profil.poste || '—'}</dd></div>
          </dl>
        </Card>
        <Card title="Mes documents" className="lg:col-span-2">
          <MiniList rows={d.documents} to="/documents" empty="Aucun document." render={(x) => <div className="flex justify-between gap-2 text-sm"><span className="truncate">{x.titre}</span><StatusBadge value={x.statut} /></div>} />
        </Card>
        <Card title="Dernières notifications">
          <MiniList rows={d.notifications} to={(n) => n.lien || '/notifications'} empty="Aucune notification." render={(n) => <div className="text-sm"><div className={`truncate ${n.lu ? '' : 'font-semibold'}`}>{n.titre}</div><div className="text-xs text-slate-500">{NOTIF_TYPES[n.type] || n.type} · {fmtDateTime(n.created_at)}</div></div>} />
        </Card>
      </div>
    </>
  );
}

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const state = useApi('/dashboard');
  const titre = {
    ADMIN_SYSTEME: 'Administration technique', SECRETAIRE_GENERAL: 'Supervision de la DEP', DIRECTEUR: 'Pilotage de la Direction',
    CHEF_DIVISION: 'Tableau de bord de la Division', CHEF_BUREAU: 'Tableau de bord du Bureau', AGENT: 'Mon espace de travail',
  }[user.primaryRole] || 'Tableau de bord';
  return (
    <>
      <PageHeader title={titre} subtitle={`${DEP_NOM} · ${ROLES[user.primaryRole] || ''} · Périmètre : ${PERIMETRES[user.perimetre]}`} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-6">
            {d.admin?.donneesDemo && <BanniereDemo />}
            {d.miseEnService && <MiseEnService p={d.miseEnService} />}
            {user.roles.includes('ADMIN_SYSTEME') && d.admin && <AdminPanel a={d.admin} />}
            {d.role === 'SECRETAIRE_GENERAL' && <SGPanel d={d} />}
            {d.role === 'DIRECTEUR' && <DirecteurPanel d={d} />}
            {d.role === 'CHEF_DIVISION' && d.bureaux && <ChefDivisionPanel d={d} />}
            {d.role === 'CHEF_BUREAU' && d.agents && <ChefBureauPanel d={d} />}
            {(d.role === 'AGENT' || (d.profil && d.role !== 'AGENT')) && d.profil && <AgentPanel d={d} />}
            {d.role && d.role !== 'ADMIN_SYSTEME' && (
              <Card title="Mes échéances"><Echeances rows={d.echeances} /></Card>
            )}
          </div>
        )}
      </Loadable>
    </>
  );
}
