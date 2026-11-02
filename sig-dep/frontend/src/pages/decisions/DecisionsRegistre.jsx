import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, Plus, X } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, DataTable, StatusBadge, Badge, Select, Stat, FormModal, FormSection, Field, useListParams, toast } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { aujourdhui, fmtDate } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

const STATUTS_DECISION = ['A_EXECUTER', 'EN_COURS', 'EXECUTEE', 'ABANDONNEE'];

function NouvelleDecision({ onClose, onCreated }) {
  const invitables = useApi('/reunions/invitables');
  const [f, setF] = useState({ libelle: '', description: '', resultat_attendu: '', responsable_user_id: '', echeance: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enregistrer = async () => {
    if (f.libelle.trim().length < 3 || !f.responsable_user_id) throw new Error('La décision (3 caractères au moins) et son responsable sont obligatoires.');
    const r = await api.post('/decisions', { ...f, responsable_user_id: Number(f.responsable_user_id), echeance: f.echeance || null, description: f.description || null, resultat_attendu: f.resultat_attendu || null });
    toast.success('Décision enregistrée et notifiée au responsable.');
    onCreated(r.data.id);
  };
  return (
    <FormModal open size="lg" title="Décision du Directeur" onClose={onClose} onSubmit={enregistrer} dirty={Object.values(f).some(Boolean)}>
      <FormSection>
        <Field label="Décision" required className="sm:col-span-2"><input className="input" value={f.libelle} onChange={up('libelle')} /></Field>
        <Field label="Précisions" className="sm:col-span-2"><textarea className="input" rows={3} value={f.description} onChange={up('description')} /></Field>
        <Field label="Responsable" required>
          <select className="input" value={f.responsable_user_id} onChange={up('responsable_user_id')}>
            <option value="">— Choisir —</option>
            {(invitables.data?.data || []).map((n) => <option key={n.userId} value={n.userId}>{n.nomComplet} — {n.roleLibelle}</option>)}
          </select>
        </Field>
        <Field label="Échéance"><input type="date" className="input" min={aujourdhui()} value={f.echeance} onChange={up('echeance')} /></Field>
        <Field label="Résultat attendu" className="sm:col-span-2"><input className="input" value={f.resultat_attendu} onChange={up('resultat_attendu')} /></Field>
      </FormSection>
    </FormModal>
  );
}

/** Registre des décisions : décisions des réunions et décisions du Directeur, avec leur exécution. */
export default function DecisionsRegistre() {
  const { valeurs: v, set } = useListParams({ statut: '', origine: '', retard: '', mes: '' });
  const [nouvelle, setNouvelle] = useState(false);
  const qs = new URLSearchParams(Object.entries({ statut: v.statut, origine: v.origine, retard: v.retard, mes: v.mes }).filter(([, x]) => x)).toString();
  const state = useApi(`/decisions${qs ? `?${qs}` : ''}`, [qs]);
  const navigate = useNavigate();
  const actifs = !!(qs || v.q);
  const effacer = <button type="button" className="btn-ghost btn-sm" onClick={() => set({ statut: '', origine: '', retard: '', mes: '', q: '' })}><X size={14} aria-hidden /> Effacer les filtres</button>;
  const d = state.data;
  return (
    <>
      <PageHeader title="Registre des décisions" subtitle="Responsable, échéance et résultat de chaque décision ; mise en œuvre par instruction ou par tâche."
        breadcrumb={[{ label: 'Pilotage' }, { label: 'Décisions' }]}
        actions={<>
          <ExportButtons base="/decisions/export" query={qs ? `?${qs}` : ''} print={false} />
          {d?.droits?.prendre && <button type="button" className="btn-primary" onClick={() => setNouvelle(true)}><Plus size={16} aria-hidden /> Décision du Directeur</button>}
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Ouvertes" value={d?.stats.ouvertes} icon={Gavel} tone="jaune" />
        <Stat label="En retard" value={d?.stats.enRetard} icon={Gavel} tone={d?.stats.enRetard ? 'rouge' : 'gris'} />
        <Stat label="Exécutées" value={d?.stats.executees} icon={Gavel} tone="vert" />
      </div>
              <DataTable rows={d?.data || []} loading={state.loading} error={state.error} onRetry={state.reload} label="Registre des décisions"
                controle={{ q: v.q, page: v.page, tri: v.tri }} onControle={set} onRowClick={(x) => navigate(`/decisions/${x.id}`)}
                empty={actifs ? 'Aucune décision pour ces critères.' : 'Aucune décision.'} emptyAction={actifs && effacer}
                toolbar={<>
                  <Select label="Statut" value={v.statut} onChange={(x) => set({ statut: x })} placeholder="Tous les statuts" options={STATUTS_DECISION.map((s) => [s, STATUTS[s][0]])} />
                  <Select label="Origine" value={v.origine} onChange={(x) => set({ origine: x })} placeholder="Toutes origines" options={[['REUNION', 'Réunions'], ['DIRECTEUR', 'Directeur']]} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.retard} onChange={(e) => set({ retard: e.target.checked ? '1' : '' })} /> En retard</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.mes} onChange={(e) => set({ mes: e.target.checked ? '1' : '' })} /> Dont je suis responsable</label>
                  {actifs && effacer}
                </>}
                columns={[
                  { key: 'reference', header: 'Référence', render: (x) => <span className="font-mono text-xs">{x.reference}</span> },
                  { key: 'libelle', header: 'Décision', render: (x) => <div><div className="font-medium">{x.libelle}</div><div className="text-xs text-slate-500">{x.origine === 'REUNION' ? `Réunion ${x.reunion_reference} — ${x.reunion_objet}` : 'Décision du Directeur'}</div></div>, search: (x) => `${x.libelle} ${x.reference}` },
                  { key: 'responsable_nom', header: 'Responsable' },
                  { key: 'echeance', header: 'Échéance', sortable: true, render: (x) => <span className={x.en_retard ? 'font-semibold text-red-700' : ''}>{fmtDate(x.echeance)}</span> },
                  { key: 'suivi', header: 'Mise en œuvre', render: (x) => x.instruction_reference || x.task_reference || '—' },
                  { key: 'statut', header: 'Statut', render: (x) => <div className="flex flex-wrap gap-1"><StatusBadge value={x.statut} />{x.en_retard && <Badge className="bg-red-50 text-red-800 ring-red-200">En retard</Badge>}</div> },
                ]} />
      {nouvelle && <NouvelleDecision onClose={() => setNouvelle(false)} onCreated={(id) => navigate(`/decisions/${id}`)} />}
    </>
  );
}
