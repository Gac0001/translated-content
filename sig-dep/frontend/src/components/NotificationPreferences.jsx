import { useEffect, useState } from 'react';
import { Mail, Save } from 'lucide-react';
import api from '../lib/api';
import { useApi, Loadable, Card, InfoAlert, runAction } from './ui';

/** Préférences de notification par e-mail de l’utilisateur connecté. */
export default function NotificationPreferences() {
  const state = useApi('/notifications/preferences');
  const [actif, setActif] = useState(true);
  const [off, setOff] = useState(new Set());
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state.data) { setActif(state.data.emailActif); setOff(new Set(state.data.typesDesactives)); setDirty(false); }
  }, [state.data]);
  const toggle = (code) => { setOff((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; }); setDirty(true); };
  const save = async () => {
    await runAction(() => api.put('/notifications/preferences', { emailActif: actif, typesDesactives: [...off] }), 'Préférences enregistrées.');
    state.reload();
  };
  return (
    <Card title="Notifications par e-mail" actions={<button type="button" className="btn-primary py-1.5" disabled={!dirty} onClick={save}><Save size={14} /> Enregistrer</button>}>
      <Loadable state={state}>
        {(p) => (
          <div className="space-y-3">
            {!p.messagerieActive && <InfoAlert tone="warning">La messagerie n’est pas encore activée par l’administrateur : vos préférences seront appliquées dès son activation.</InfoAlert>}
            {!p.email && <InfoAlert tone="warning">Aucune adresse électronique n’est enregistrée sur votre fiche : vous ne recevrez pas d’e-mail. Demandez sa mise à jour au Bureau Secrétariat de Direction.</InfoAlert>}
            {p.email && <p className="flex items-center gap-2 text-sm text-slate-600"><Mail size={16} /> Adresse de réception : <b className="text-slate-800">{p.email}</b></p>}
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={actif} onChange={(e) => { setActif(e.target.checked); setDirty(true); }} />
              Recevoir des e-mails pour les événements ci-dessous
            </label>
            <fieldset disabled={!actif} className={`grid gap-1 pl-6 sm:grid-cols-2 ${actif ? '' : 'opacity-50'}`}>
              <legend className="sr-only">Types de notification</legend>
              {p.types.map((t) => (
                <label key={t.code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!off.has(t.code)} onChange={() => toggle(t.code)} /> {t.libelle}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-slate-500">Les notifications restent toujours visibles dans l’application. Pour les éléments confidentiels, l’e-mail se limite à vous inviter à vous connecter, sans en révéler le contenu.</p>
          </div>
        )}
      </Loadable>
    </Card>
  );
}
