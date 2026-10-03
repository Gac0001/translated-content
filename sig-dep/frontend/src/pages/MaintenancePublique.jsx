import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import api from '../lib/api';
import { DEP_NOM, SG_NOM } from '../lib/labels';

/** Page affichée pendant une maintenance (accessible sans connexion). */
export default function MaintenancePublique() {
  const [m, setM] = useState(null);
  useEffect(() => {
    const charger = () => api.get('/statut-public').then((r) => setM(r.data.maintenance)).catch(() => {});
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-dep-800 via-dep-700 to-dep-900">
      <div className="h-1.5 tricolore" />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg text-center text-white">
          <div className="text-xs uppercase tracking-[0.2em] text-dep-200">République Démocratique du Congo</div>
          <div className="mt-1 text-sm text-dep-100">{SG_NOM}</div>
          <h1 className="mt-3 text-2xl font-semibold">{DEP_NOM}</h1>
          <div className="card mt-6 p-6 text-left text-slate-800">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Wrench size={20} className="text-dep-700" /> {m && !m.active ? 'Le SIG-DEP est de nouveau disponible' : 'Maintenance en cours'}</h2>
            {m && m.active && <p className="mt-2 text-sm">{m.message}</p>}
            {m && m.active && m.fin && <p className="mt-2 text-sm text-slate-600">Fin prévue : <b>{m.fin}</b></p>}
            {m && m.active && <p className="mt-3 text-xs text-slate-500">Cette page se met à jour automatiquement. Merci de votre patience.</p>}
            <Link to="/connexion" className="btn-primary mt-4">{m && !m.active ? 'Se connecter' : 'Retour à la connexion'}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
