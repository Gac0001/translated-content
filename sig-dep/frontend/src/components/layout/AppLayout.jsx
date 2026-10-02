import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, Network, BookOpen, Users, UserCog, CalendarCheck, Mail, Send, ListTodo, FileText, FolderKanban,
  Bell, ScrollText, BarChart3, Settings, LogOut, Menu, X, UserCircle, KeyRound, ShieldCheck, ListChecks, UserPlus, DatabaseZap,
} from 'lucide-react';
import api from '../../lib/api';
import { useAuth, useCompteurs } from '../../store/auth';
import { DEP_NOM, SG_NOM, ROLES, PERIMETRES } from '../../lib/labels';
import { useInactivity } from '../../lib/inactivity';
import { Modal } from '../ui';
import GlobalSearch from './GlobalSearch';

const MENU = [
  { section: 'Pilotage' },
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
  { to: '/rapports', label: 'Rapports et statistiques', icon: BarChart3, perms: ['rapports.consulter'] },
  { section: 'Organisation' },
  { to: '/organigramme', label: 'Organigramme', icon: Network, perms: ['organisation.consulter'] },
  { to: '/cadre-organique', label: 'Cadre organique', icon: BookOpen, perms: ['organisation.consulter'] },
  { to: '/personnel', label: 'Personnel', icon: Users, perms: ['personnel.consulter', 'personnel.suivre'] },
  { section: 'Activités' },
  { to: '/instructions', label: 'Instructions', icon: Send, perms: ['instructions.consulter'], counter: 'instructions' },
  { to: '/taches', label: 'Tâches', icon: ListTodo, perms: ['taches.consulter'], counter: 'taches' },
  { to: '/presences', label: 'Présences', icon: CalendarCheck, perms: ['presences.consulter', 'presences.preparer_direction'], counter: 'presences' },
  { to: '/courriers', label: 'Courriers', icon: Mail, perms: ['courriers.consulter'], counter: 'courriers' },
  { to: '/documents', label: 'Documents de service', icon: FileText, perms: ['documents.consulter'], counter: 'documents' },
  { to: '/pip', label: 'Projets PIP', icon: FolderKanban, perms: ['pip.consulter'], counter: 'pip' },
  { section: 'Administration' },
  { to: '/liste-declarative', label: 'Liste déclarative', icon: ListChecks, perms: ['liste.consulter'] },
  { to: '/comptes/enrolement', label: 'Enrôlement des agents', icon: UserPlus, perms: ['comptes.enroler'] },
  { to: '/comptes', label: 'Comptes utilisateurs', icon: UserCog, perms: ['comptes.consulter'], end: true },
  { to: '/roles', label: 'Rôles et permissions', icon: ShieldCheck, perms: ['roles.gerer'] },
  { to: '/audit', label: 'Journal d’audit', icon: ScrollText, perms: ['audit.consulter'] },
  { to: '/systeme', label: 'Système', icon: Settings, perms: ['systeme.etat', 'systeme.parametres'], end: true },
  { to: '/systeme/reinitialisation', label: 'Réinitialisation', icon: DatabaseZap, perms: ['systeme.reinitialiser'] },
];

function Sidebar({ onNavigate }) {
  const { user } = useAuth();
  const { compteurs } = useCompteurs();
  const items = MENU.filter((m) => m.section || !m.perms || m.perms.some((p) => user.permissions.includes(p)));
  // Retire les titres de section sans éléments
  const visible = items.filter((m, i) => !m.section || (items[i + 1] && !items[i + 1].section));
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Menu principal">
      {visible.map((m, i) => (m.section ? (
        <div key={i} className="mt-4 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-dep-200/70 first:mt-0">{m.section}</div>
      ) : (
        <NavLink key={m.to} to={m.to} end={m.end} onClick={onNavigate}
          className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-medium text-white' : 'text-dep-100 hover:bg-white/10 hover:text-white'}`}>
          <m.icon size={17} />
          <span className="flex-1">{m.label}</span>
          {m.counter && compteurs[m.counter] > 0 && <span className="rounded-full bg-rdc-jaune px-1.5 text-xs font-semibold text-dep-900">{compteurs[m.counter]}</span>}
        </NavLink>
      )))}
    </nav>
  );
}

export default function AppLayout() {
  const { user, clear } = useAuth();
  const { nonLues, setNonLues, setCompteurs } = useCompteurs();
  const [open, setOpen] = useState(false);
  const [menuUser, setMenuUser] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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

  useEffect(() => { setMenuUser(false); }, [location.pathname]);

  const logout = async (raison) => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clear();
    navigate('/connexion', { state: raison === 'inactivite' ? { message: 'Vous avez été déconnecté après une période d’inactivité.' } : undefined });
  };
  const { remaining, prolonger } = useInactivity(() => logout('inactivite'));

  const nom = user.agent ? [user.agent.prenom, user.agent.nom].filter(Boolean).join(' ') : user.username;
  const structure = user.affectation?.bureauNom || user.affectation?.divisionNom || (user.primaryRole === 'DIRECTEUR' ? DEP_NOM : user.primaryRole === 'SECRETAIRE_GENERAL' ? SG_NOM : 'Administration technique');

  const aside = (
    <div className="flex h-full flex-col bg-dep-800 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <img src="/favicon.jpg" alt="Ministère de l’Économie Numérique" className="h-10 w-[5.75rem] shrink-0 rounded-md bg-white object-contain" />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">SIG-DEP</div>
          <div className="text-[11px] leading-tight text-dep-200">{DEP_NOM}</div>
        </div>
      </div>
      <Sidebar onNavigate={() => setOpen(false)} />
      <div className="border-t border-white/10 px-4 py-3 text-[11px] leading-snug text-dep-200">{SG_NOM}<br />République Démocratique du Congo</div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block no-print">{aside}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden no-print">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{aside}</div>
          <button type="button" className="absolute right-3 top-3 rounded bg-white/90 p-1" onClick={() => setOpen(false)} aria-label="Fermer le menu"><X size={20} /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
          <div className="h-1 tricolore" />
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button type="button" className="rounded p-1.5 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu"><Menu size={22} /></button>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-xs uppercase tracking-wide text-slate-500">République Démocratique du Congo — {SG_NOM}</div>
              <div className="truncate text-sm font-semibold text-dep-800">{DEP_NOM} (DEP)</div>
            </div>
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
              <div className="mr-2 hidden min-w-0 flex-1 justify-end md:flex"><GlobalSearch /></div>
              <Link to="/notifications" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${nonLues} non lues)`}>
                <Bell size={20} />
                {nonLues > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rdc-rouge px-1 text-center text-[11px] font-semibold text-white">{nonLues > 99 ? '99+' : nonLues}</span>}
              </Link>
              <div className="relative">
                <button type="button" onClick={() => setMenuUser((v) => !v)} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={menuUser}>
                  <UserCircle size={26} className="text-dep-700" />
                  <div className="hidden text-left md:block">
                    <div className="max-w-[200px] truncate text-sm font-medium leading-tight">{nom}</div>
                    <div className="max-w-[220px] truncate text-xs leading-tight text-slate-500">{ROLES[user.primaryRole] || '—'} · {structure}</div>
                  </div>
                </button>
                {menuUser && (
                  <div className="absolute right-0 mt-1 w-64 rounded-md border bg-white py-1 shadow-lg" role="menu">
                    <div className="border-b px-3 py-2 text-xs text-slate-500">
                      Périmètre : <b className="text-slate-700">{PERIMETRES[user.perimetre]}</b>
                      <div>Rôle(s) : {user.roles.map((r) => ROLES[r]).join(', ')}</div>
                    </div>
                    {user.agent && <Link to="/profil" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50" role="menuitem"><UserCircle size={16} /> Mon profil</Link>}
                    <Link to="/mot-de-passe" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50" role="menuitem"><KeyRound size={16} /> Changer le mot de passe</Link>
                    <button type="button" onClick={() => logout()} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" role="menuitem"><LogOut size={16} /> Se déconnecter</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <div className="print-only mb-4 border-b pb-2 text-center">
          <div className="text-sm font-bold uppercase">République Démocratique du Congo</div>
          <div className="text-xs uppercase">{SG_NOM}</div>
          <div className="text-sm font-bold uppercase text-dep-800">{DEP_NOM} (DEP)</div>
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
          <Outlet />
        </main>
        <Modal open={remaining !== null} title="Session inactive" onClose={prolonger}
          footer={<><button type="button" className="btn-secondary" onClick={() => logout()}>Se déconnecter</button><button type="button" className="btn-primary" onClick={prolonger}>Rester connecté</button></>}>
          <p className="text-sm">Aucune activité n’a été détectée. Par sécurité, vous serez déconnecté dans <b className="tabular-nums">{remaining}</b> seconde(s).</p>
        </Modal>
        <footer className="border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-500 no-print">
          SIG-DEP — Système Intégré de Gestion de la {DEP_NOM} · {SG_NOM}
        </footer>
      </div>
    </div>
  );
}
