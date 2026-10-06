import { LogOut, MonitorSmartphone } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../store/auth';
import { useApi, Loadable, Card, Badge, runAction, useConfirm } from './ui';
import { fmtDateTime } from '../lib/format';

/** Appareils connectés au compte, avec fermeture à distance d’une session. */
export default function SessionsCompte() {
  const state = useApi('/auth/sessions');
  const confirm = useConfirm();
  const { user, setSession } = useAuth();
  const fermer = async (s) => {
    if (!(await confirm({ title: 'Fermer la session', message: `Fermer la session ${s.appareil} (${s.ip}) ? Cet appareil devra se reconnecter.`, danger: true, confirmLabel: 'Fermer' }))) return;
    const r = await runAction(() => api.post(`/auth/sessions/${s.id}/fermer`), 'Session fermée.');
    // Les jetons d’accès en cours sont invalidés : la session courante reçoit un nouveau jeton.
    setSession(r.data.accessToken, user);
    state.reload();
  };
  return (
    <Card title="Sessions ouvertes">
      <p className="mb-3 text-sm text-slate-600">Si vous ne reconnaissez pas un appareil, fermez sa session puis changez votre mot de passe.</p>
      <Loadable state={state}>
        {(d) => (
          <ul className="divide-y divide-slate-100">
            {d.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <MonitorSmartphone size={18} className="text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.appareil} {s.courante && <Badge className="ml-1 bg-emerald-50 text-emerald-800 ring-emerald-200">Cet appareil</Badge>}</div>
                  <div className="text-xs text-slate-500">Adresse {s.ip} · ouverte le {fmtDateTime(s.ouverte)} · dernière activité {fmtDateTime(s.derniereActivite)}</div>
                </div>
                {!s.courante && <button type="button" className="btn-secondary py-1 text-red-700" onClick={() => fermer(s)}><LogOut size={14} /> Fermer</button>}
              </li>
            ))}
          </ul>
        )}
      </Loadable>
    </Card>
  );
}
