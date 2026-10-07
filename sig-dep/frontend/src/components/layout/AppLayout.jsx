import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { fmtDate } from '../../lib/format';
import {
  LayoutDashboard, Network, BookOpen, Users, UserCog, CalendarCheck, Mail, Send, ListTodo, FileText, FolderKanban,
  Bell, ScrollText, BarChart3, Settings, LogOut, Menu, X, UserCircle, KeyRound, ShieldCheck, ListChecks, UserPlus, DatabaseZap, ShieldAlert, FileBarChart, HeartPulse, Bug, DatabaseBackup, History, Wrench, Stamp, Share2, Landmark, IdCard, MessageCircleQuestion,
  Search, CalendarDays, Gavel, Presentation, Target, Database,
} from 'lucide-react';
import api from '../../lib/api';
import { useAuth, useCompteurs } from '../../store/auth';
import { DEP_NOM, SG_NOM, ROLES, PERIMETRES } from '../../lib/labels';
import { useInactivity } from '../../lib/inactivity';
import { Modal, Spinner, IconButton, DropdownMenu, useFocusTrap, useScrollLock } from '../ui';
import GlobalSearch from './GlobalSearch';

const MENU = [
  { section: 'Pilotage' },
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
  { to: '/agenda', label: 'Agenda du Directeur', icon: CalendarDays, perms: ['agenda.consulter'] },
  { to: '/decisions', label: 'Registre des décisions', icon: Gavel, agent: true },
  { to: '/rapports', label: 'Rapports et statistiques', icon: BarChart3, perms: ['rapports.consulter'] },
  { section: 'Planification et données' },
  { to: '/planification', label: 'PTBA et exécution', icon: Target, perms: ['planification.consulter'] },
  { to: '/donnees', label: 'Données sectorielles', icon: Database, perms: ['donnees.consulter'] },
  { section: 'Organisation' },
  { to: '/organigramme', label: 'Organigramme', icon: Network, perms: ['organisation.consulter'] },
  { to: '/cadre-organique', label: 'Cadre organique', icon: BookOpen, perms: ['organisation.consulter'] },
  { to: '/personnel', label: 'Personnel', icon: Users, perms: ['personnel.consulter', 'personnel.suivre'] },
  { to: '/ma-carte', label: 'Ma carte de service', icon: IdCard, agent: true },
  { section: 'Activités' },
  { to: '/instructions', label: 'Instructions', icon: Send, perms: ['instructions.consulter'], counter: 'instructions' },
  { to: '/reunions', label: 'Réunions', icon: Presentation, agent: true },
  { to: '/demandes-information', label: 'Demandes d’information', icon: MessageCircleQuestion, perms: ['demandes_info.emettre', 'demandes_info.repondre'], counter: 'demandesInfo' },
  { to: '/taches', label: 'Tâches', icon: ListTodo, perms: ['taches.consulter'], counter: 'taches' },
  { to: '/presences', label: 'Présences', icon: CalendarCheck, perms: ['presences.consulter', 'presences.preparer_direction'], counter: 'presences' },
  { to: '/courriers', label: 'Courriers', icon: Mail, perms: ['courriers.consulter'], counter: 'courriers' },
  { to: '/documents', label: 'Documents de service', icon: FileText, perms: ['documents.consulter'], counter: 'documents' },
  { to: '/pip', label: 'Projets PIP', icon: FolderKanban, perms: ['pip.consulter'], counter: 'pip' },
  { section: 'Administration' },
  { to: '/liste-declarative', label: 'Liste déclarative', icon: ListChecks, perms: ['liste.consulter'] },
  { to: '/comptes/enrolement', label: 'Enrôlement des agents', icon: UserPlus, perms: ['compte.enroler'] },
  { to: '/comptes', label: 'Comptes utilisateurs', icon: UserCog, perms: ['compte.consulter'], end: true },
  { to: '/cartes', label: 'Cartes de service', icon: IdCard, perms: ['cartes.consulter'], end: true },
  { to: '/cartes/modele', label: 'Modèle de carte', icon: IdCard, perms: ['modele_carte.configurer'] },
  { to: '/actes', label: 'Actes administratifs', icon: Stamp, perms: ['actes.consulter', 'actes.preparer', 'actes.enregistrer_direction'] },
  { to: '/designations', label: 'Désignations', icon: Share2, perms: ['designations.gerer'] },
  { to: '/roles', label: 'Rôles et permissions', icon: ShieldCheck, perms: ['role.attribuer'] },
  { to: '/securite', label: 'Sécurité', icon: ShieldAlert, perms: ['securite.superviser'], counter: 'alertes' },
  { to: '/rapports-securite', label: 'Rapports de sécurité', icon: FileBarChart, perms: ['rapport_securite.consulter'] },
  { to: '/audit', label: 'Journal d’audit', icon: ScrollText, perms: ['audit.consulter'] },
  { to: '/systeme/sauvegardes', label: 'Sauvegardes', icon: DatabaseBackup, perms: ['sauvegarde.creer'] },
  { to: '/gouvernance', label: 'Gouvernance', icon: Landmark, perms: ['operations.confirmer', 'systeme.maintenir', 'acces_support.demander', 'acces_support.valider', 'urgence.activer', 'urgence.desactiver'] },
  { to: '/restaurations', label: 'Restaurations', icon: History, perms: ['sauvegarde.restaurer', 'sauvegarde.valider_restauration'] },
  { to: '/systeme/maintenance', label: 'Maintenance', icon: Wrench, perms: ['systeme.maintenir'] },
  { to: '/systeme/sante', label: 'Santé du système', icon: HeartPulse, perms: ['systeme.consulter'] },
  { to: '/systeme/erreurs', label: 'Journal technique', icon: Bug, perms: ['systeme.consulter'] },
  { to: '/systeme', label: 'Système', icon: Settings, perms: ['systeme.consulter', 'systeme.configurer'], end: true },
  { to: '/systeme/reinitialisation', label: 'Réinitialisation', icon: DatabaseZap, perms: ['systeme.maintenir'] },
];

/** Regroupe le menu par section, en ne gardant que les entrées autorisées (« agent » : réservé aux titulaires d’une fiche Agent). */
function groupes(user) {
  const res = [];
  for (const m of MENU) {
    if (m.section) res.push({ section: m.section, items: [] });
    else if (m.agent ? !!user.agent : !m.perms || m.perms.some((p) => user.permissions.includes(p))) res[res.length - 1].items.push(m);
  }
  return res.filter((g) => g.items.length);
}

function Sidebar({ onNavigate }) {
  const { user } = useAuth();
  const { compteurs } = useCompteurs();
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Menu principal">
      {groupes(user).map((g) => (
        <div key={g.section} className="mt-4 first:mt-0">
          <h2 id={`menu-${g.section}`} className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-dep-200">{g.section}</h2>
          <ul aria-labelledby={`menu-${g.section}`} className="space-y-0.5">
            {g.items.map((m) => (
              <li key={m.to}>
                <NavLink to={m.to} end={m.end} onClick={onNavigate}
                  className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-rdc-jaune ${isActive ? 'bg-white/15 font-medium text-white' : 'text-dep-100 hover:bg-white/10 hover:text-white'}`}>
                  <m.icon size={17} aria-hidden />
                  <span className="flex-1">{m.label}</span>
                  {m.counter && compteurs[m.counter] > 0 && (
                    <span className="rounded-full bg-rdc-jaune px-1.5 text-xs font-semibold text-dep-900">{compteurs[m.counter]}<span className="sr-only"> à traiter</span></span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Menu latéral en tiroir (mobile) : focus piégé, Échap pour fermer. */
function Tiroir({ onClose, children }) {
  const ref = useRef(null);
  useFocusTrap(ref, true, onClose);
  useScrollLock();
  return (
    <div ref={ref} className="fixed inset-0 z-40 lg:hidden no-print" role="dialog" aria-modal="true" aria-label="Menu principal" tabIndex={-1}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col">{children}</div>
      <IconButton label="Fermer le menu" icon={X} size={20} data-autofocus className="absolute right-3 top-3 bg-white/90 text-slate-700 hover:bg-white" onClick={onClose} />
    </div>
  );
}

export default function AppLayout() {
  const { user, clear } = useAuth();
  const { nonLues, setNonLues, setCompteurs } = useCompteurs();
  const [open, setOpen] = useState(false);
  const [recherche, setRecherche] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const main = useRef(null);
  const pageCourante = useRef(location.pathname);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [n, c] = await Promise.all([api.get('/notifications/compteur'), api.get('/dashboard/compteurs')]);
        if (alive) { setNonLues(n.data.nonLues); setCompteurs(c.data); }
      } catch { /* silencieux */ }
    };
    tick();
    const t = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [location.pathname, setNonLues, setCompteurs]);

  // Changement de page : retour en haut et focus sur le contenu, sauf si la nouvelle page a déjà placé
  // le focus sur un de ses champs. Un élément masqué appartient à l’ancienne page (chargement en cours).
  useEffect(() => {
    setRecherche(false);
    if (pageCourante.current === location.pathname) return;
    pageCourante.current = location.pathname;
    window.scrollTo(0, 0);
    const a = document.activeElement;
    const placeParLaPage = a && a !== main.current && main.current?.contains(a) && a.getClientRects().length > 0;
    if (!placeParLaPage) main.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const logout = async (raison) => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clear();
    navigate('/connexion', { state: raison === 'inactivite' ? { message: 'Vous avez été déconnecté après une période d’inactivité.' } : undefined });
  };
  const { remaining, prolonger } = useInactivity(() => logout('inactivite'), user.sessionInactiviteMinutes);
  // Bandeau « maintenance active » (visible des Admins Système, seuls à garder l’accès)
  const [maintenanceActive, setMaintenanceActive] = useState(null);
  const [modeDemo, setModeDemo] = useState(false);
  useEffect(() => {
    let vivant = true;
    const lire = () => api.get('/statut-public').then((r) => { if (!vivant) return; setMaintenanceActive(r.data.maintenance.active ? r.data.maintenance : null); setModeDemo(!!r.data.demo); }).catch(() => {});
    lire();
    const t = setInterval(lire, 60000);
    return () => { vivant = false; clearInterval(t); };
  }, [location.pathname]);

  const nom = user.agent ? [user.agent.prenom, user.agent.nom].filter(Boolean).join(' ') : user.username;
  const structure = user.affectation?.bureauNom || user.affectation?.divisionNom || (user.primaryRole === 'DIRECTEUR' ? DEP_NOM : user.primaryRole === 'SECRETAIRE_GENERAL' ? SG_NOM : 'Administration technique');

  const aside = (
    <div className="flex h-full w-full flex-col bg-dep-800 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <img src="/favicon.jpg" alt="Ministère de l’Économie Numérique" className="h-10 w-[5.75rem] shrink-0 rounded-md bg-white object-contain" />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">SIG-DEP</div>
          <div className="text-xs leading-tight text-dep-200">{DEP_NOM}</div>
        </div>
      </div>
      <Sidebar onNavigate={() => setOpen(false)} />
      <div className="border-t border-white/10 px-4 py-3 text-xs leading-snug text-dep-200">{SG_NOM}<br />République Démocratique du Congo</div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#contenu" onClick={(e) => { e.preventDefault(); main.current?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-dep-800 focus:shadow-lg">
        Aller au contenu
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block no-print">{aside}</aside>
      {open && <Tiroir onClose={() => setOpen(false)}>{aside}</Tiroir>}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
          <div className="h-1 tricolore" />
          <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
            <IconButton label="Ouvrir le menu" icon={Menu} size={22} className="p-1.5 lg:hidden" aria-expanded={open} onClick={() => setOpen(true)} />
            <div className="min-w-0 sm:hidden"><div className="text-sm font-semibold text-dep-800">SIG-DEP</div></div>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-xs uppercase tracking-wide text-slate-500">République Démocratique du Congo — {SG_NOM}</div>
              <div className="truncate text-sm font-semibold text-dep-800">{DEP_NOM} (DEP)</div>
            </div>
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
              <div className="mr-2 hidden min-w-0 flex-1 justify-end md:flex"><GlobalSearch /></div>
              <IconButton label="Rechercher" icon={Search} size={20} className="text-slate-600 md:hidden" onClick={() => setRecherche(true)} />
              <Link to="/notifications" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100">
                <Bell size={20} aria-hidden />
                <span className="sr-only">Notifications</span>
                {nonLues > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rdc-rouge px-1 text-center text-xs font-semibold text-white">{nonLues > 99 ? '99+' : nonLues}<span className="sr-only"> non lues</span></span>}
              </Link>
              <DropdownMenu width="w-64" menuLabel="Menu utilisateur"
                triggerClassName="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400"
                trigger={<>
                  <UserCircle size={26} className="text-dep-700" aria-hidden />
                  <span className="sr-only md:hidden">Menu de {nom}</span>
                  <span className="hidden text-left md:block">
                    <span className="block max-w-[200px] truncate text-sm font-medium leading-tight">{nom}</span>
                    <span className="block max-w-[220px] truncate text-xs leading-tight text-slate-500">{ROLES[user.primaryRole] || '—'} · {structure}</span>
                  </span>
                </>}
                header={(
                  <div className="border-b px-3 py-2 text-xs text-slate-600">
                    <div className="font-medium text-slate-800 md:hidden">{nom}</div>
                    Périmètre : <b className="text-slate-800">{PERIMETRES[user.perimetre]}</b>
                    <div>Rôle(s) : {user.roles.map((r) => ROLES[r]).join(', ')}</div>
                  </div>
                )}
                items={[
                  user.agent && { label: 'Mon profil', icon: UserCircle, to: '/profil' },
                  { label: 'Changer le mot de passe', icon: KeyRound, to: '/mot-de-passe' },
                  { label: 'Se déconnecter', icon: LogOut, danger: true, onClick: () => logout() },
                ]} />
            </div>
          </div>
        </header>
        <div className="print-only mb-4 border-b pb-2 text-center">
          <div className="text-sm font-bold uppercase">République Démocratique du Congo</div>
          <div className="text-xs uppercase">{SG_NOM}</div>
          <div className="text-sm font-bold uppercase text-dep-800">{DEP_NOM} (DEP)</div>
        </div>
        {modeDemo && (
          <div className="bg-amber-300 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wide text-amber-950 no-print" role="status">Environnement de démonstration et de formation — données fictives</div>
        )}
        {maintenanceActive && (
          <div className="flex flex-wrap items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 no-print" role="status">
            <Wrench size={16} /> <b>Mode maintenance actif</b> — seuls les Admins Système accèdent à l’application. {maintenanceActive.message}
            {user.permissions.includes('systeme.maintenir') && <Link to="/systeme/maintenance" className="ml-auto underline">Gérer</Link>}
          </div>
        )}
        {user.interim && (
          <div className="flex flex-wrap items-center gap-2 bg-sky-50 px-4 py-2 text-sm text-sky-900 no-print" role="status">
            <Stamp size={16} /> Vous exercez par intérim les fonctions de <b>{user.interim.poste}</b> jusqu’au {fmtDate(user.interim.dateFin)} inclus.
            <Link to={`/actes/${user.interim.acteId}`} className="ml-auto underline">Acte {user.interim.numero}</Link>
          </div>
        )}
        {user.suspensions?.map((x) => (
          <div key={x.acteId} className="flex flex-wrap items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900 no-print" role="status">
            <Stamp size={16} /> Pendant votre absence, les fonctions de <b>{x.poste}</b> sont exercées par intérim par {x.interimaire} jusqu’au {fmtDate(x.dateFin)} inclus.
            <Link to={`/actes/${x.acteId}`} className="ml-auto underline">Voir l’acte</Link>
          </div>
        ))}
        <main id="contenu" ref={main} tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 focus:outline-none sm:px-6">
          {/* Le menu et l’en-tête restent affichés pendant le chargement d’une page. */}
          <Suspense fallback={<Spinner />}><Outlet /></Suspense>
        </main>
        <Modal open={recherche} title="Recherche" placement="top" onClose={() => setRecherche(false)}>
          <GlobalSearch panel onNavigate={() => setRecherche(false)} />
        </Modal>
        <Modal open={remaining !== null} title="Session inactive" onClose={prolonger}
          footer={<><button type="button" className="btn-secondary" onClick={() => logout()}>Se déconnecter</button><button type="button" className="btn-primary" data-autofocus onClick={prolonger}>Rester connecté</button></>}>
          <p className="text-sm">Aucune activité n’a été détectée. Par sécurité, vous serez déconnecté dans <b className="tabular-nums">{remaining}</b> seconde(s).</p>
        </Modal>
        <footer className="border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-500 no-print">
          SIG-DEP — Système Intégré de Gestion de la {DEP_NOM} · {SG_NOM}
        </footer>
      </div>
    </div>
  );
}
