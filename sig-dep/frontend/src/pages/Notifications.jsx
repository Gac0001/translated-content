import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck } from 'lucide-react';
import api from '../lib/api';
import { useCompteurs } from '../store/auth';
import { useApi, Loadable, PageHeader, Card, Tabs, Empty, Badge, runAction } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { NOTIF_TYPES } from '../lib/labels';

export default function Notifications() {
  const [filtre, setFiltre] = useState('');
  const state = useApi(`/notifications?limit=200${filtre ? '&non_lues=true' : ''}`);
  const setNonLues = useCompteurs((s) => s.setNonLues);
  const navigate = useNavigate();
  const open = async (n) => {
    if (!n.lu) { await api.post(`/notifications/${n.id}/lue`); setNonLues(Math.max(0, (state.data?.nonLues || 1) - 1)); }
    if (n.lien) navigate(n.lien); else state.reload();
  };
  const all = async () => { await runAction(() => api.post('/notifications/tout-lire'), 'Toutes les notifications sont lues.'); setNonLues(0); state.reload(); };
  return (
    <>
      <PageHeader title="Notifications" breadcrumb={[{ label: 'Notifications' }]} actions={<button type="button" className="btn-secondary" onClick={all}><CheckCheck size={16} /> Tout marquer comme lu</button>} />
      <Tabs value={filtre} onChange={setFiltre} tabs={[{ value: '', label: 'Toutes' }, { value: 'non', label: 'Non lues', count: state.data?.nonLues }]} />
      <Loadable state={state}>
        {(d) => (
          <Card bodyClass="p-0">
            {!d.data.length ? <Empty message="Aucune notification." /> : (
              <ul className="divide-y divide-slate-100">
                {d.data.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => open(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.lu ? '' : 'bg-dep-50/50'}`}>
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.lu ? 'bg-slate-300' : 'bg-rdc-rouge'}`} aria-label={n.lu ? 'Lue' : 'Non lue'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className={`text-sm ${n.lu ? '' : 'font-semibold'}`}>{n.titre}</span><Badge>{NOTIF_TYPES[n.type] || n.type}</Badge></div>
                        {n.message && <p className="mt-0.5 truncate text-sm text-slate-600">{n.message}</p>}
                        <div className="mt-0.5 text-xs text-slate-500">{fmtDateTime(n.created_at)}{n.expediteur ? ` · de ${n.expediteur}` : ''}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </Loadable>
    </>
  );
}
