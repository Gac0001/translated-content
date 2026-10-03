import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { refreshSession } from './lib/api';
import { useAuth } from './store/auth';
import AppLayout from './components/layout/AppLayout';
import { ConfirmProvider, Spinner, Toaster } from './components/ui';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import PremiereConnexion from './pages/PremiereConnexion';
import { Forbidden, NotFound } from './pages/Errors';

const p = (loader) => lazy(loader);
const Dashboard = p(() => import('./pages/Dashboard'));
const Organigramme = p(() => import('./pages/organisation/Organigramme'));
const Structure = p(() => import('./pages/organisation/Structure'));
const Cadre = p(() => import('./pages/organisation/Cadre'));
const AgentsList = p(() => import('./pages/personnel/AgentsList'));
const AgentDetail = p(() => import('./pages/personnel/AgentDetail'));
const AgentForm = p(() => import('./pages/personnel/AgentForm'));
const AgentImport = p(() => import('./pages/personnel/AgentImport'));
const Profil = p(() => import('./pages/personnel/Profil'));
const UsersList = p(() => import('./pages/comptes/UsersList'));
const UserDetail = p(() => import('./pages/comptes/UserDetail'));
const UserCreate = p(() => import('./pages/comptes/UserCreate'));
const Roles = p(() => import('./pages/comptes/Roles'));
const Delegations = p(() => import('./pages/comptes/Delegations'));
const ListeDeclarative = p(() => import('./pages/comptes/ListeDeclarative'));
const Enrolement = p(() => import('./pages/comptes/Enrolement'));
const PresencesList = p(() => import('./pages/presences/PresencesList'));
const PresenceCreate = p(() => import('./pages/presences/PresenceCreate'));
const PresenceSheet = p(() => import('./pages/presences/PresenceSheet'));
const CourriersList = p(() => import('./pages/courriers/CourriersList'));
const CourrierForm = p(() => import('./pages/courriers/CourrierForm'));
const CourrierDetail = p(() => import('./pages/courriers/CourrierDetail'));
const InstructionsList = p(() => import('./pages/instructions/InstructionsList'));
const InstructionForm = p(() => import('./pages/instructions/InstructionForm'));
const InstructionDetail = p(() => import('./pages/instructions/InstructionDetail'));
const TachesList = p(() => import('./pages/taches/TachesList'));
const TacheForm = p(() => import('./pages/taches/TacheForm'));
const TacheDetail = p(() => import('./pages/taches/TacheDetail'));
const DocumentsList = p(() => import('./pages/documents/DocumentsList'));
const DocumentForm = p(() => import('./pages/documents/DocumentForm'));
const DocumentDetail = p(() => import('./pages/documents/DocumentDetail'));
const PipList = p(() => import('./pages/pip/PipList'));
const PipForm = p(() => import('./pages/pip/PipForm'));
const PipDetail = p(() => import('./pages/pip/PipDetail'));
const Notifications = p(() => import('./pages/Notifications'));
const Audit = p(() => import('./pages/systeme/Audit'));
const Systeme = p(() => import('./pages/systeme/Systeme'));
const Securite = p(() => import('./pages/systeme/Securite'));
const Sante = p(() => import('./pages/systeme/Sante'));
const JournalTechnique = p(() => import('./pages/systeme/JournalTechnique'));
const RapportsSecurite = p(() => import('./pages/RapportsSecurite'));
const Reinitialisation = p(() => import('./pages/systeme/Reinitialisation'));
const Rapports = p(() => import('./pages/Rapports'));

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="flex min-h-screen items-center justify-center"><Spinner label="Ouverture de la session…" /></div>;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (user.exigences?.length && location.pathname !== '/premiere-connexion') return <Navigate to="/premiere-connexion" replace />;
  return children;
}

/** Garde d’affichage (le backend reste la seule barrière de sécurité). */
function Guard({ perms, children }) {
  const can = useAuth((s) => s.can);
  if (perms && !can(...perms)) return <Forbidden />;
  return children;
}

const G = (perms, el) => <Guard perms={perms}>{el}</Guard>;

export default function App() {
  const { setReady, user } = useAuth();
  useEffect(() => {
    refreshSession().catch(() => {}).finally(() => setReady());
  }, [setReady]);

  return (
    <ConfirmProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/connexion" element={user && !user.exigences?.length ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/premiere-connexion" element={<RequireAuth><PremiereConnexion /></RequireAuth>} />
          <Route path="/changer-mot-de-passe" element={<Navigate to="/premiere-connexion" replace />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="mot-de-passe" element={<ChangePassword />} />
            <Route path="organigramme" element={G(['organisation.consulter'], <Organigramme />)} />
            <Route path="structures/:type/:id" element={G(['organisation.consulter'], <Structure />)} />
            <Route path="cadre-organique" element={G(['organisation.consulter'], <Cadre />)} />
            <Route path="personnel" element={G(['personnel.consulter', 'personnel.suivre'], <AgentsList />)} />
            <Route path="personnel/nouveau" element={G(['personnel.gerer', 'personnel.suivre'], <AgentForm />)} />
            <Route path="personnel/import" element={G(['personnel.gerer', 'personnel.suivre'], <AgentImport />)} />
            <Route path="personnel/:id" element={<AgentDetail />} />
            <Route path="personnel/:id/modifier" element={G(['personnel.gerer', 'personnel.suivre'], <AgentForm />)} />
            <Route path="profil" element={<Profil />} />
            <Route path="liste-declarative" element={G(['liste.consulter'], <ListeDeclarative />)} />
            <Route path="comptes/enrolement" element={G(['compte.enroler'], <Enrolement />)} />
            <Route path="comptes" element={G(['compte.consulter'], <UsersList />)} />
            <Route path="comptes/nouveau" element={G(['compte.creer_initial'], <UserCreate />)} />
            <Route path="comptes/:id" element={G(['compte.consulter'], <UserDetail />)} />
            <Route path="roles" element={G(['role.attribuer'], <Roles />)} />
            <Route path="delegations" element={G(['delegations.gerer'], <Delegations />)} />
            <Route path="presences" element={G(['presences.consulter', 'presences.preparer_direction'], <PresencesList />)} />
            <Route path="presences/nouvelle" element={G(['presences.saisir', 'presences.preparer_direction'], <PresenceCreate />)} />
            <Route path="presences/:id" element={<PresenceSheet />} />
            <Route path="courriers" element={G(['courriers.consulter'], <CourriersList />)} />
            <Route path="courriers/nouveau" element={G(['courriers.enregistrer'], <CourrierForm />)} />
            <Route path="courriers/:id" element={G(['courriers.consulter'], <CourrierDetail />)} />
            <Route path="courriers/:id/modifier" element={G(['courriers.enregistrer'], <CourrierForm />)} />
            <Route path="instructions" element={G(['instructions.consulter'], <InstructionsList />)} />
            <Route path="instructions/nouvelle" element={G(['instructions.emettre'], <InstructionForm />)} />
            <Route path="instructions/:id" element={G(['instructions.consulter'], <InstructionDetail />)} />
            <Route path="taches" element={G(['taches.consulter'], <TachesList />)} />
            <Route path="taches/nouvelle" element={G(['taches.attribuer'], <TacheForm />)} />
            <Route path="taches/:id" element={G(['taches.consulter'], <TacheDetail />)} />
            <Route path="documents" element={G(['documents.consulter'], <DocumentsList />)} />
            <Route path="documents/nouveau" element={G(['documents.rediger'], <DocumentForm />)} />
            <Route path="documents/:id" element={G(['documents.consulter'], <DocumentDetail />)} />
            <Route path="documents/:id/modifier" element={G(['documents.rediger'], <DocumentForm />)} />
            <Route path="pip" element={G(['pip.consulter'], <PipList />)} />
            <Route path="pip/nouveau" element={G(['pip.rediger'], <PipForm />)} />
            <Route path="pip/:id" element={G(['pip.consulter'], <PipDetail />)} />
            <Route path="pip/:id/modifier" element={G(['pip.rediger'], <PipForm />)} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="audit" element={G(['audit.consulter'], <Audit />)} />
            <Route path="rapports" element={G(['rapports.consulter'], <Rapports />)} />
            <Route path="systeme" element={G(['systeme.consulter', 'systeme.configurer'], <Systeme />)} />
            <Route path="systeme/sante" element={G(['systeme.consulter'], <Sante />)} />
            <Route path="systeme/erreurs" element={G(['systeme.consulter'], <JournalTechnique />)} />
            <Route path="rapports-securite" element={G(['rapport_securite.consulter'], <RapportsSecurite />)} />
            <Route path="securite" element={G(['securite.superviser', 'session.consulter'], <Securite />)} />
            <Route path="systeme/reinitialisation" element={G(['systeme.maintenir'], <Reinitialisation />)} />
            <Route path="acces-refuse" element={<Forbidden />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </ConfirmProvider>
  );
}
