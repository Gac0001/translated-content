import { useState } from 'react';
import { KeyRound, Mail, ShieldCheck, Smartphone } from 'lucide-react';
import api, { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Card, Modal, ErrorAlert, InfoAlert, KeyValues, Badge, toast } from './ui';
import { CodesSecours } from '../pages/PremiereConnexion';

/** Demande le mot de passe et le code de double authentification avant une opération sensible. */
function Identite({ titre, texte, libelle, onValider, onClose }) {
  const [motDePasse, setMotDePasse] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [resultat, setResultat] = useState(null);
  const valider = async () => {
    setError(null);
    try { setResultat(await onValider({ motDePasse, code })); } catch (e) { setError(errorMessage(e)); }
  };
  if (resultat?.codesSecours) {
    return <Modal open title="Nouveaux codes de secours" onClose={onClose} size="lg"><CodesSecours codes={resultat.codesSecours} onContinuer={onClose} libelleContinuer="Terminer" /></Modal>;
  }
  return (
    <Modal open title={titre} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={!motDePasse || code.length < 6} onClick={valider}>{libelle}</button></>}>
      <div className="space-y-3">
        <ErrorAlert message={error} />
        <p className="text-sm text-slate-600">{texte}</p>
        <div><label className="label" htmlFor="id-mdp">Mot de passe</label><input id="id-mdp" type="password" className="input" autoComplete="current-password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} /></div>
        <div><label className="label" htmlFor="id-code">Code de l’application (ou code de secours)</label><input id="id-code" className="input font-mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function EmailModal({ onClose }) {
  const setUser = useAuth((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [envoye, setEnvoye] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const enregistrer = async () => {
    setError(null);
    try {
      const r = await api.post('/auth/email-recuperation', { email, motDePasse });
      setUser(r.data.user);
      if (r.data.verificationEnvoyee) setEnvoye(true); else { toast.info(r.data.message); onClose(); }
    } catch (e) { setError(errorMessage(e)); }
  };
  const verifier = async () => {
    setError(null);
    try { const r = await api.post('/auth/email-recuperation/verifier', { code }); setUser(r.data.user); toast.success(r.data.message); onClose(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Modal open title="Adresse de récupération" onClose={onClose}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Fermer</button>{envoye
        ? <button type="button" className="btn-primary" disabled={code.length !== 6} onClick={verifier}>Vérifier</button>
        : <button type="button" className="btn-primary" disabled={!email || !motDePasse} onClick={enregistrer}>Enregistrer</button>}</>}>
      <div className="space-y-3">
        <ErrorAlert message={error} />
        {envoye ? (
          <>
            <InfoAlert>Un code à 6 chiffres a été envoyé à {email}.</InfoAlert>
            <div><label className="label" htmlFor="em-code">Code reçu</label><input id="em-code" className="input font-mono tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          </>
        ) : (
          <>
            <div><label className="label" htmlFor="em">Adresse électronique</label><input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><label className="label" htmlFor="em-mdp">Mot de passe actuel</label><input id="em-mdp" type="password" className="input" autoComplete="current-password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} /></div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Sécurité du compte connecté : double authentification et récupération. */
export default function SecuriteCompte() {
  const { user, setUser } = useAuth();
  const [modal, setModal] = useState(null);
  if (!user.deuxFacteursActif && !user.emailRecuperation) return null;
  return (
    <Card title="Sécurité du compte">
      <KeyValues items={[
        ['Double authentification', user.deuxFacteursActif ? <Badge key="a" tone="succes"><ShieldCheck size={12} /> Active</Badge> : 'Inactive'],
        ['Adresse de récupération', user.emailRecuperation ? `${user.emailRecuperation} — ${user.emailRecuperationVerifie ? 'vérifiée' : 'non vérifiée'}` : 'Aucune'],
      ]} />
      <div className="mt-4 flex flex-wrap gap-2">
        {user.deuxFacteursActif && <button type="button" className="btn-secondary" onClick={() => setModal('codes')}><KeyRound size={16} /> Nouveaux codes de secours</button>}
        {user.deuxFacteursActif && <button type="button" className="btn-secondary" onClick={() => setModal('appareil')}><Smartphone size={16} /> Changer d’appareil</button>}
        <button type="button" className="btn-secondary" onClick={() => setModal('email')}><Mail size={16} /> {user.emailRecuperation ? (user.emailRecuperationVerifie ? 'Modifier l’adresse de récupération' : 'Vérifier ou modifier l’adresse') : 'Ajouter une adresse de récupération'}</button>
      </div>
      {modal === 'codes' && <Identite titre="Nouveaux codes de secours" texte="Les anciens codes seront invalidés." libelle="Générer" onClose={() => setModal(null)} onValider={async (b) => (await api.post('/auth/2fa/codes-secours', b)).data} />}
      {modal === 'appareil' && <Identite titre="Changer d’appareil d’authentification" texte="La double authentification sera réinitialisée : vous configurerez immédiatement votre nouveau téléphone." libelle="Continuer"
        onClose={() => setModal(null)} onValider={async (b) => { const r = await api.post('/auth/2fa/changer-appareil', b); setUser(r.data.user); return r.data; }} />}
      {modal === 'email' && <EmailModal onClose={() => setModal(null)} />}
    </Card>
  );
}
