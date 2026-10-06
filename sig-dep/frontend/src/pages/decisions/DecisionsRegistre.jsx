import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, DataTable, StatusBadge, Badge, Select, Stat, Modal, Field, runAction } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

const STATUTS_DECISION = ['A_EXECUTER', 'EN_COURS', 'EXECUTEE', 'ABANDONNEE'];

function NouvelleDecision({ onClose, onCreated }) {
  const invitables = useApi('/reunions/invitables');
  const [f, setF] = useState({ libelle: '', description: '', resultat_attendu: '', responsable_user_id: '', echeance: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enregistrer = async () => {
    const r = await runAction(() => api.post('/decisions', { ...f, responsable_user_id: Number(f.responsable_user_id), echeance: f.echeance || null, description: f.description || null, resultat_attendu: f.resultat_attendu || null }), 'Décision enregistrée et notifiée au responsable.');
    onCreated(r.data.id);
  };
  return (
    <Modal open size="lg" title="Décision du Directeur" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={f.libelle.trim().length < 3 || !f.responsable_user_id} onClick={enregistrer}><Gavel size={16} /> Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Décision" required className="sm:col-span-2"><input className="input" value={f.libelle} onChange={up('libelle')} /></Field>
        <Field label="Précisions" className="sm:col-span-2"><textarea className="input" rows={3} value={f.description} onChange={up('description')} /></Field>
        <Field label="Responsable" required>
          <select className="input" value={f.responsable_user_id} onChange={up('responsable_user_id')}>
            <option value="">— Choisir —</option>
            {(invitables.data?.data || []).map((n) => <option key={n.userId} value={n.userId}>{n.nomComplet} — {n.roleLibelle}</option>)}
          </select>
        </Field>
        <Field label="Échéance"><input type="date" className="input" min={new Date().toISOString().slice(0, 10)} value={f.echeance} onChange={up('echeance')} /></Field>
        <Field label="Résultat attendu" className="sm:col-span-2"><input className="input" value={f.resultat_attendu} onChange={up('resultat_attendu')} /></Field>
      </div>
    </Modal>
  );
}

/** Registre des décisions : décisions des réunions et décisions du Directeur, avec leur exécution. */
export default function DecisionsRegistre() {
  const [statut, setStatut] = useState('');
  const [origine, setOrigine] = useState('');
  const [retard, setRetard] = useState(false);
  const [mes, setMes] = useState(false);
  const [nouvelle, setNouvelle] = useState(false);
  const qs = new URLSearchParams({ ...(statut ? { statut } : {}), ...(origine ? { origine } : {}), ...(retard ? { retard: '1' } : {}), ...(mes ? { mes: '1' } : {}) }).toString();
  const state = useApi(`/decisions${qs ? `?${qs}` : ''}`, [qs]);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Registre des décisions" subtitle="Responsable, échéance et résultat de chaque décision ; mise en œuvre par instruction ou par tâche."
        breadcrumb={[{ label: 'Pilotage' }, { label: 'Décisions' }]}
        actions={<>
          <ExportButtons base="/decisions/export" query={qs ? `?${qs}` : ''} print={false} />
          {state.data?.droits?.prendre && <button type="button" className="btn-primary" onClick={() => setNouvelle(true)}><Plus size={16} /> Décision du Directeur</button>}
        </>} />
      <Loadable state={state}>
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Ouvertes" value={d.stats.ouvertes} icon={Gavel} tone="jaune" />
              <Stat label="En retard" value={d.stats.enRetard} icon={Gavel} tone={d.stats.enRetard ? 'rouge' : 'gris'} />
              <Stat label="Exécutées" value={d.stats.executees} icon={Gavel} tone="vert" />
            </div>
            <div className="mt-4">
              <DataTable rows={d.data} onRowClick={(x) => navigate(`/decisions/${x.id}`)} empty="Aucune décision."
                toolbar={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={statut} onChange={setStatut} placeholder="Tous les statuts" options={STATUTS_DECISION.map((s) => [s, STATUTS[s][0]])} />
                    <Select value={origine} onChange={setOrigine} placeholder="Toutes origines" options={[['REUNION', 'Réunions'], ['DIRECTEUR', 'Directeur']]} />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={retard} onChange={(e) => setRetard(e.target.checked)} /> En retard</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mes} onChange={(e) => setMes(e.target.checked)} /> Dont je suis responsable</label>
                  </div>
                )}
                columns={[
                  { key: 'reference', header: 'Référence', render: (x) => <span className="font-mono text-xs">{x.reference}</span> },
                  { key: 'libelle', header: 'Décision', render: (x) => <div><div className="font-medium">{x.libelle}</div><div className="text-xs text-slate-500">{x.origine === 'REUNION' ? `Réunion ${x.reunion_reference} — ${x.reunion_objet}` : 'Décision du Directeur'}</div></div>, search: (x) => `${x.libelle} ${x.reference}` },
                  { key: 'responsable_nom', header: 'Responsable' },
                  { key: 'echeance', header: 'Échéance', render: (x) => <span className={x.en_retard ? 'font-semibold text-red-700' : ''}>{fmtDate(x.echeance)}</span> },
                  { key: 'suivi', header: 'Mise en œuvre', render: (x) => x.instruction_reference || x.task_reference || '—' },
                  { key: 'statut', header: 'Statut', render: (x) => <div className="flex flex-wrap gap-1"><StatusBadge value={x.statut} />{x.en_retard && <Badge className="bg-red-50 text-red-800 ring-red-200">En retard</Badge>}</div> },
                ]} />
            </div>
          </>
        )}
      </Loadable>
      {nouvelle && <NouvelleDecision onClose={() => setNouvelle(false)} onCreated={(id) => navigate(`/decisions/${id}`)} />}
    </>
  );
}
