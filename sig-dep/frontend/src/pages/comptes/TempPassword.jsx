import { Copy, KeyRound } from 'lucide-react';
import { Modal, toast } from '../../components/ui';

/** Affiche une seule fois le mot de passe temporaire généré par le serveur. */
export default function TempPassword({ data, onClose }) {
  if (!data) return null;
  const copy = () => navigator.clipboard?.writeText(data.motDePasseTemporaire).then(() => toast.success('Mot de passe copié.'));
  return (
    <Modal open title="Mot de passe temporaire" onClose={onClose} footer={<button type="button" className="btn-primary" onClick={onClose}>J’ai noté le mot de passe</button>}>
      <div className="space-y-3 text-sm">
        <p>{data.message}</p>
        {data.username && <p>Nom d’utilisateur : <b>{data.username}</b></p>}
        <div className="flex items-center gap-2 rounded-md border border-dep-200 bg-dep-50 p-3 font-mono text-lg">
          <KeyRound size={18} className="text-dep-700" /><span className="flex-1 select-all">{data.motDePasseTemporaire}</span>
          <button type="button" className="btn-ghost" onClick={copy} aria-label="Copier"><Copy size={16} /></button>
        </div>
        <p className="text-xs text-slate-500">Ce mot de passe ne sera plus affiché. Transmettez-le de manière sécurisée : son titulaire devra le changer à la première connexion.</p>
      </div>
    </Modal>
  );
}
