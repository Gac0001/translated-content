import { Link } from 'react-router-dom';
import { ShieldAlert, SearchX } from 'lucide-react';

export function Forbidden({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <ShieldAlert size={48} className="text-red-600" />
      <h1 className="mt-4 text-2xl font-semibold">Accès refusé</h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">{message || 'Vous n’êtes pas autorisé à consulter cette page. Votre accès dépend de votre rôle, de vos permissions et de votre affectation administrative.'}</p>
      <Link to="/" className="btn-primary mt-6">Retour au tableau de bord</Link>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <SearchX size={48} className="text-slate-400" />
      <h1 className="mt-4 text-2xl font-semibold">Page introuvable</h1>
      <p className="mt-2 text-sm text-slate-600">La page demandée n’existe pas ou a été déplacée.</p>
      <Link to="/" className="btn-primary mt-6">Retour au tableau de bord</Link>
    </div>
  );
}
