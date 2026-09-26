import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, Card, Field, runAction, Spinner } from '../../components/ui';
import { mondayOf } from '../../lib/format';

export default function PresenceCreate() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const delegue = can('presences.preparer_direction');
  const [type, setType] = useState(can('presences.saisir') && user.affectation?.bureauId ? 'BUREAU' : 'DIRECTION');
  const [bureauId, setBureauId] = useState(user.affectation?.bureauId || '');
  const [semaine, setSemaine] = useState(mondayOf());
  const [selected, setSelected] = useState(new Set());
  const bureaux = useApi(delegue ? '/organisation/bureaux' : null);
  const agents = useApi(`/presences/agents-eligibles?structure_type=${type}${type === 'BUREAU' && bureauId ? `&bureau_id=${bureauId}` : ''}`);
  useEffect(() => { if (agents.data) setSelected(new Set(agents.data.data.map((a) => a.id))); }, [agents.data]);
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => {
    const r = await runAction(() => api.post('/presences', { structure_type: type, bureau_id: type === 'BUREAU' ? Number(bureauId) : null, semaine_debut: semaine, agent_ids: [...selected] }), 'Liste créée.');
    navigate(`/presences/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title="Nouvelle liste de présence" breadcrumb={[{ label: 'Présences', to: '/presences' }, { label: 'Nouvelle liste' }]} />
      <div className="space-y-4">
        <Card title="Paramètres">
          <div className="grid gap-4 sm:grid-cols-3">
            {delegue && (
              <Field label="Portée">
                <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="DIRECTION">Direction (tous les Agents de la DEP)</option>
                  <option value="BUREAU">Un Bureau</option>
                </select>
              </Field>
            )}
            {type === 'BUREAU' && delegue && (
              <Field label="Bureau"><select className="input" value={bureauId} onChange={(e) => setBureauId(e.target.value)}><option value="">— Choisir —</option>{(bureaux.data?.data || []).map((b) => <option key={b.id} value={b.id}>{b.nom}</option>)}</select></Field>
            )}
            {type === 'BUREAU' && !delegue && <Field label="Bureau"><input className="input" disabled value={user.affectation?.bureauNom || ''} /></Field>}
            <Field label="Semaine du (lundi)" hint="La date est ramenée au lundi de la semaine."><input type="date" className="input" value={semaine} onChange={(e) => setSemaine(mondayOf(new Date(`${e.target.value}T12:00:00`)))} /></Field>
          </div>
        </Card>
        <Card title={`Sélection des Agents (${selected.size})`} actions={<><button type="button" className="btn-ghost" onClick={() => setSelected(new Set((agents.data?.data || []).map((a) => a.id)))}>Tout sélectionner</button><button type="button" className="btn-ghost" onClick={() => setSelected(new Set())}>Aucun</button></>}>
          {agents.loading ? <Spinner /> : (
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {(agents.data?.data || []).map((a) => (
                <li key={a.id}><label className="flex items-start gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={selected.has(a.id)} onChange={() => toggle(a.id)} /><span>{[a.nom, a.postnom, a.prenom].filter(Boolean).join(' ')}<span className="block text-xs text-slate-500">{a.matricule} · {a.bureau_nom || a.division_nom || 'Direction'}</span></span></label></li>
              ))}
            </ul>
          )}
        </Card>
        <button type="button" className="btn-primary" disabled={!selected.size || (type === 'BUREAU' && !bureauId)} onClick={submit}><Save size={16} /> Créer la liste</button>
      </div>
    </>
  );
}
