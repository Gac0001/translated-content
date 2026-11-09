import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import api from '../lib/api';
import PagePublique from '../components/PagePublique';
import { useTitreDocument } from '../components/ui';

/** Page affichée pendant une maintenance (accessible sans connexion). */
export default function MaintenancePublique() {
  const [m, setM] = useState(null);
  useEffect(() => {
    const charger = () => api.get('/statut-public').then((r) => setM(r.data.maintenance)).catch(() => {});
    charger();
    const t = setInterval(charger, 30000);
    return () => clearInterval(t);
  }, []);
  useTitreDocument(m && !m.active ? 'De nouveau disponible' : 'Maintenance en cours');
  return (
    <PagePublique lien={{ to: '/verification', label: 'Vérifier une carte de service' }}>
      <div className="overflow-hidden rounded-xl bg-white shadow-[0_10px_30px_rgba(18,52,111,0.12)]">
        <div className="bg-dep-700 px-6 py-5 text-white">
          <h1 className="flex items-center gap-2 text-xl font-bold text-white"><Wrench size={22} /> {m && !m.active ? 'Le SIG-DEP est de nouveau disponible' : 'Maintenance en cours'}</h1>
        </div>
        <div className="p-6">
          {m && m.active && <p className="text-sm">{m.message}</p>}
          {m && m.active && m.fin && <p className="mt-2 text-sm text-slate-600">Fin prévue : <b>{m.fin}</b></p>}
          {m && m.active && <p className="mt-3 text-xs text-slate-600">Cette page se met à jour automatiquement. Merci de votre patience.</p>}
          <Link to="/connexion" className="btn-primary mt-4">{m && !m.active ? 'Se connecter' : 'Retour à la connexion'}</Link>
        </div>
      </div>
    </PagePublique>
  );
}
