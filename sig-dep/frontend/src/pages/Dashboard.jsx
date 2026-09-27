import { Link } from 'react-router-dom';
import {
  Users, UserCheck, Lock, ShieldAlert, Activity, Database, Send, ListTodo, FileText, CalendarCheck, Mail, FolderKanban,
  AlertTriangle, Clock, Building2, Bell,
} from 'lucide-react';
import { useAuth } from '../store/auth';
import { useApi, Loadable, PageHeader, Card, Stat, StatusBadge, Progress, Empty, Badge, RangBadge, InfoAlert } from '../components/ui';
import { fmtDate, fmtDateTime, fmtMontant, isOverdue } from '../lib/format';
import { DEP_NOM, ROLES, STATUTS, PERIMETRES, NOTIF_TYPES, DELEGATIONS } from '../lib/labels';
import { Progression } from './comptes/ListeDeclarative';

const sum = (obj = {}, keys) => keys.reduce((s, k) => s + (obj[k] || 0), 0);
const ACTIVE = ['TRANSMISE', 'RECUE', 'EN_COURS', 'A_CORRIGER', 'EN_RETARD'];

function MiniList({ rows = [], to, render, empty = 'Rien à signaler.' }) {
  if (!rows.length) return <Empty message={empty} />;
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
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className={`grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3 ${r.indent ? 'sm:pl-5' : ''}`}>
          <div className="flex min-w-0 items-center gap-2">
            <RangBadge rang={r.rang} />
            <span className={`truncate text-sm ${r.rang === 'DIVISION' ? 'font-semibold' : ''}`} title={r.nom}>{r.nom}</span>
            {r.direct && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Rattaché au Directeur</Badge>}
          </div>
          <div className="flex items-center gap-2" title={`${r.nom} — tâches : ${r.detail.taches}, instructions : ${r.detail.instructions}, en retard : ${r.detail.tachesEnRetard + r.detail.instructionsEnRetard}`}>
            <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
              {r.v !== null && <div className="h-full rounded-r bg-dep-600" style={{ width: `${Math.max(r.v, 1)}%` }} />}
            </div>
            <span className="w-24 text-right text-xs tabular-nums text-slate-700">{r.v === null ? 'aucune activité' : `${r.v} % exécuté`}</span>
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-slate-500">Taux d’exécution = tâches et instructions exécutées, validées ou clôturées ÷ total. Les Divisions et le Bureau directement rattaché au Directeur sont présentés séparément.</p>
    </div>
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
    {can('liste.consulter') && <Link to="/liste-declarative" className="text-sm text-dep-700 hover:underline">Liste déclarative</Link>}
    {can('comptes.enroler') && <Link to="/comptes/enrolement" className="text-sm text-dep-700 hover:underline">Enrôlement</Link>}
  </>;
  return (
    <Card title="Mise en service des comptes" actions={actions}>
      {can('liste.valider') && p.statutListe !== 'VALIDEE' && <div className="mb-3"><InfoAlert tone="warning">La liste déclarative des agents {p.statutListe === 'A_REVALIDER' ? 'a changé et doit être revalidée' : 'attend votre validation'}. <Link to="/liste-declarative" className="font-medium underline">Ouvrir la liste</Link></InfoAlert></div>}
      <Progression p={p} />
    </Card>
  );
}

function AdminPanel({ a }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Comptes" value={a.comptes.total} icon={Users} to="/comptes" />
        <Stat label="Comptes actifs" value={a.comptes.actifs} icon={UserCheck} tone="vert" />
        <Stat label="Comptes verrouillés" value={a.comptes.verrouilles} icon={Lock} tone={a.comptes.verrouilles ? 'rouge' : 'gris'} />
        <Stat label="Échecs de connexion (24 h)" value={a.securite.echecsConnexion24h} icon={ShieldAlert} tone={a.securite.echecsConnexion24h ? 'jaune' : 'gris'} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Sécurité">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between"><span>Utilisateurs avec session active</span><b>{a.securite.utilisateursConnectes}</b></li>
            <li className="flex justify-between"><span>Connexions réussies (24 h)</span><b>{a.securite.connexions24h}</b></li>
            <li className="flex justify-between"><span>Changement de mot de passe requis</span><b>{a.comptes.changementMdpRequis}</b></li>
            <li className="flex justify-between"><span>Comptes désactivés</span><b>{a.comptes.desactives}</b></li>
          </ul>
          {a.securite.comptesVerrouilles.length > 0 && (
            <div className="mt-3 border-t pt-2 text-sm">
              <div className="mb-1 font-medium text-red-700">Comptes verrouillés</div>
              {a.securite.comptesVerrouilles.map((u) => <Link key={u.id} to={`/comptes/${u.id}`} className="block text-dep-700 hover:underline">{u.username} — jusqu’à {fmtDateTime(u.locked_until)}</Link>)}
            </div>
          )}
        </Card>
        <Card title="État du système" actions={<Link to="/systeme" className="text-sm text-dep-700 hover:underline">Détails</Link>}>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><Database size={16} className="text-emerald-600" /> Base de données : <b>{a.systeme.baseDeDonnees}</b></li>
            <li className="flex justify-between"><span>Taille de la base</span><b>{a.systeme.tailleBase}</b></li>
            <li className="flex justify-between"><span>Dernière migration</span><b className="truncate pl-2 text-xs">{a.systeme.derniereMigration}</b></li>
            <li className="flex justify-between"><span>Disponibilité de l’API</span><b>{Math.round(a.systeme.uptimeSecondes / 60)} min</b></li>
          </ul>
        </Card>
        <Card title="Dernières opérations auditées" actions={<Link to="/audit" className="text-sm text-dep-700 hover:underline">Journal</Link>}>
          <ul className="space-y-1.5 text-xs">
            {a.audit.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.resultat === 'SUCCES' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="min-w-0 flex-1 truncate"><b>{l.username || 'système'}</b> · {l.action} · {l.module}</span>
                <span className="shrink-0 text-slate-500">{fmtDateTime(l.created_at)}</span>
              </li>
            ))}
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
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[['Instructions en cours', sum(s.instructions, ACTIVE)], ['Instructions en retard', s.instructions.EN_RETARD || 0], ['Tâches en cours', sum(s.taches, ACTIVE)], ['Tâches en retard', s.taches.EN_RETARD || 0],
              ['Tâches exécutées', sum(s.taches, ['EXECUTEE', 'VALIDEE', 'CLOTUREE'])], ['Courriers en circulation', s.courriers.EN_CIRCULATION || 0]].map(([k, v]) => (
              <div key={k} className="rounded-md bg-slate-50 p-3"><div className="text-xl font-semibold tabular-nums">{v}</div><div className="text-xs text-slate-600">{k}</div></div>
            ))}
          </div>
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
        <Stat label="Présences soumises" value={d.presencesSoumises.length} hint={d.presencesSemaine ? `Taux de présence : ${d.presencesSemaine.tauxPresence ?? '—'} %` : null} icon={CalendarCheck} tone="violet" to="/presences" />
        <Stat label="Courriers à réceptionner" value={d.courriersARecevoir.length} icon={Mail} tone={d.courriersARecevoir.length ? 'jaune' : 'gris'} to="/courriers" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Documents à valider">
          <MiniList rows={d.documentsAValider} to="/documents" empty="Aucun document en attente." render={(x) => <div className="text-sm"><div className="truncate font-medium">{x.titre}</div><div className="text-xs text-slate-500">{x.reference} · {fmtDateTime(x.updated_at)}</div></div>} />
        </Card>
        <Card title="Tâches en retard">
          <MiniList rows={d.tachesEnRetard} to="/taches" empty="Aucune tâche en retard." render={(t) => <div className="text-sm"><div className="truncate font-medium">{t.titre}</div><div className="text-xs text-red-700">{t.nom} · {t.bureau} · échéance {fmtDate(t.echeance)}</div></div>} />
        </Card>
        <Card title="Instructions du Secrétaire Général">
          <MiniList rows={d.instructionsRecues} to="/instructions" empty="Aucune instruction reçue." render={(i) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate">{i.objet}</span><StatusBadge value={i.statut} /></div><Progress value={i.avancement} /></div>} />
        </Card>
        <Card title="Présences soumises">
          <MiniList rows={d.presencesSoumises} to="/presences" empty="Aucune liste en attente." render={(p) => <div className="text-sm"><div className="font-medium">{p.bureau || 'Direction (toutes structures)'}</div><div className="text-xs text-slate-500">{p.reference} · soumise le {fmtDateTime(p.submitted_at)}</div></div>} />
        </Card>
        <Card title="Courriers">
          <MiniList rows={d.courriersARecevoir} to="/courriers" empty="Aucun courrier à réceptionner." render={(c) => <div className="text-sm"><div className="truncate font-medium">{c.objet}</div><div className="text-xs text-slate-500">{c.numero_enregistrement} · {fmtDateTime(c.created_at)}</div></div>} />
          <div className="mt-2 flex flex-wrap gap-2 border-t pt-2 text-xs">{Object.entries(d.courriers).map(([k, v]) => <Badge key={k}>{STATUTS[k]?.[0] || k} : {v}</Badge>)}</div>
        </Card>
        <Card title="Projets PIP à valider">
          <MiniList rows={d.pipAValider} to="/pip" empty="Aucune fiche à valider." render={(p) => <div className="text-sm"><div className="truncate font-medium">{p.intitule}</div><div className="text-xs text-slate-500">{p.code} · {fmtMontant(p.cout_total, p.devise)}</div></div>} />
          <div className="mt-2 flex flex-wrap gap-2 border-t pt-2 text-xs">{Object.entries(d.pip).map(([k, v]) => <Badge key={k}>{STATUTS[k]?.[0] || k} : {v}</Badge>)}</div>
        </Card>
      </div>
      <Card title="Performance des structures" className="mt-4"><PerformanceBars perf={d.performance} /></Card>
    </>
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
        <Card title="Bureaux rattachés à la Division">
          <div className="overflow-x-auto"><table className="min-w-full"><thead><tr><th className="th">Bureau</th><th className="th">Agents</th><th className="th">Tâches</th><th className="th">En retard</th><th className="th">Exécution</th></tr></thead>
            <tbody>{d.bureaux.map((b) => <tr key={b.id}><td className="td"><Link className="text-dep-700 hover:underline" to={`/structures/bureau/${b.id}`}>{b.nom}</Link></td><td className="td">{b.agents}</td><td className="td">{b.taches}</td><td className="td">{b.tachesEnRetard}</td><td className="td">{b.tauxExecution === null ? '—' : `${b.tauxExecution} %`}</td></tr>)}</tbody></table></div>
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
          <Badge className={d.bureau.estSecretariatDirection ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}>{d.bureau.rattachement}</Badge>
          <span className="text-slate-600">· Supérieur direct : {d.bureau.superieurDirect}</span>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Agents du Bureau" value={d.agents.length} icon={Users} />
        <Stat label="Tâches en cours" value={sum(d.taches, ACTIVE)} icon={ListTodo} to="/taches" />
        <Stat label="À valider (exécutées)" value={d.taches.EXECUTEE || 0} icon={Activity} tone="violet" to="/taches?statut=EXECUTEE" />
        <Stat label="Documents à vérifier" value={d.documentsAVerifier.length} icon={FileText} tone={d.documentsAVerifier.length ? 'jaune' : 'gris'} to="/documents" />
      </div>
      {d.delegations?.length > 0 && <div className="mt-4"><InfoAlert>Opérations déléguées par le Directeur : {d.delegations.map((x) => DELEGATIONS[x] || x).join(', ')}. Ces délégations ne modifient pas le rang du Bureau.</InfoAlert></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Agents du Bureau" actions={<Link to="/taches/nouvelle" className="btn-primary py-1.5"><ListTodo size={14} /> Attribuer une tâche</Link>}>
          <ul className="divide-y divide-slate-100">{d.agents.map((a) => <li key={a.id} className="flex items-center justify-between py-2 text-sm"><Link to={`/personnel/${a.id}`} className="text-dep-700 hover:underline">{a.nom}</Link><span className="text-xs text-slate-500">{a.poste} · {a.taches_en_cours} tâche(s) en cours</span></li>)}</ul>
        </Card>
        <Card title="Tâches et échéances">
          <MiniList rows={d.tachesEnCours} to="/taches" empty="Aucune tâche." render={(t) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate">{t.titre} <span className="text-xs text-slate-500">— {t.nom}</span></span><StatusBadge value={t.statut} /></div><div className="flex items-center gap-3"><div className="flex-1"><Progress value={t.avancement} /></div><span className={`text-xs ${isOverdue(t.echeance, t.statut) ? 'text-red-700' : 'text-slate-500'}`}>{fmtDate(t.echeance)}</span></div></div>} />
        </Card>
        <Card title="Présences du Bureau" actions={<Link to="/presences/nouvelle" className="text-sm text-dep-700 hover:underline">Nouvelle liste</Link>}>
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
        <Stat label="Documents en cours" value={d.documents.filter((x) => ['BROUILLON', 'A_CORRIGER', 'EN_EXAMEN'].includes(x.statut)).length} icon={FileText} tone="violet" to="/documents" />
        <Stat label="Notifications non lues" value={d.notificationsNonLues} icon={Bell} tone="jaune" to="/notifications" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Mes tâches" className="lg:col-span-2">
          <MiniList rows={d.taches} to="/taches" empty="Aucune tâche attribuée." render={(t) => <div className="space-y-1 text-sm"><div className="flex justify-between gap-2"><span className="truncate font-medium">{t.titre}</span><StatusBadge value={t.statut} /></div><div className="flex items-center gap-3"><div className="flex-1"><Progress value={t.avancement} /></div><span className={`text-xs ${isOverdue(t.echeance, t.statut) ? 'text-red-700' : 'text-slate-500'}`}>Échéance {fmtDate(t.echeance)}</span></div></div>} />
        </Card>
        <Card title="Mon profil" actions={<Link to="/profil" className="text-sm text-dep-700 hover:underline">Voir</Link>}>
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
    ADMIN: 'Administration technique', SECRETAIRE_GENERAL: 'Supervision de la DEP', DIRECTEUR: 'Pilotage de la Direction',
    CHEF_DIVISION: 'Tableau de bord de la Division', CHEF_BUREAU: 'Tableau de bord du Bureau', AGENT: 'Mon espace de travail',
  }[user.primaryRole] || 'Tableau de bord';
  return (
    <>
      <PageHeader title={titre} subtitle={`${DEP_NOM} · ${ROLES[user.primaryRole] || ''} · Périmètre : ${PERIMETRES[user.perimetre]}`} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-6">
            {d.miseEnService && <MiseEnService p={d.miseEnService} />}
            {user.roles.includes('ADMIN') && d.admin && <AdminPanel a={d.admin} />}
            {d.role === 'SECRETAIRE_GENERAL' && <SGPanel d={d} />}
            {d.role === 'DIRECTEUR' && <DirecteurPanel d={d} />}
            {d.role === 'CHEF_DIVISION' && d.bureaux && <ChefDivisionPanel d={d} />}
            {d.role === 'CHEF_BUREAU' && d.agents && <ChefBureauPanel d={d} />}
            {(d.role === 'AGENT' || (d.profil && d.role !== 'AGENT')) && d.profil && <AgentPanel d={d} />}
            {d.role && d.role !== 'ADMIN' && (
              <Card title="Mes échéances"><Echeances rows={d.echeances} /></Card>
            )}
          </div>
        )}
      </Loadable>
    </>
  );
}
