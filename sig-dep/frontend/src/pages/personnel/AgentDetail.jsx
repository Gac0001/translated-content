import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRightLeft, Archive, Pencil, Upload, UserPlus, XCircle } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Modal, Field, runAction, toast, useConfirm } from '../../components/ui';
import AgentView from './AgentView';

const affSchema = z.object({
  structure: z.string().min(1, 'Choisissez la structure'),
  poste_id: z.string().min(1, 'Choisissez le poste organique'),
  date_debut: z.string().min(10, 'Date requise'),
  motif: z.string().max(300).optional(),
});

function AffectationModal({ agent, onClose, onDone }) {
  const cadre = useApi('/organisation/cadre');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(affSchema), defaultValues: { date_debut: new Date().toISOString().slice(0, 10) } });
  const structure = watch('structure');
  const [t, sid] = (structure || ':').split(':');
  const postes = (cadre.data?.postes || []).filter((p) => (t === 'BUREAU' ? p.bureau_id === Number(sid) : t === 'DIVISION' ? p.niveau === 'DIVISION' && p.division_id === Number(sid) : t === 'DIRECTION' ? p.niveau === 'DIRECTION' : false));
  const submit = async (v) => {
    const body = { poste_id: Number(v.poste_id), date_debut: v.date_debut, motif: v.motif || null };
    if (t === 'BUREAU') body.bureau_id = Number(sid);
    if (t === 'DIVISION') body.division_id = Number(sid);
    await runAction(() => api.post(`/agents/${agent.id}/affectations`, body), 'Affectation enregistrée. L’affectation précédente est clôturée et conservée.');
    onDone();
  };
  return (
    <Modal open title="Nouvelle affectation" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button form="aff" className="btn-primary" disabled={isSubmitting}>Affecter</button></>}>
      <form id="aff" onSubmit={handleSubmit(submit)} className="space-y-3">
        <p className="text-sm text-slate-600">L’affectation en cours sera clôturée à la date d’effet ; son historique est conservé.</p>
        <Field label="Structure" error={errors.structure?.message} required>
          <select className="input" {...register('structure')}>
            <option value="">— Choisir —</option>
            <option value="DIRECTION:">Direction (poste de Directeur)</option>
            <optgroup label="Bureaux directement rattachés au Directeur">{(cadre.data?.bureaux || []).filter((b) => b.parent_type === 'DIRECTION').map((b) => <option key={b.id} value={`BUREAU:${b.id}`}>{b.nom}</option>)}</optgroup>
            {(cadre.data?.divisions || []).map((d) => (
              <optgroup key={d.id} label={d.nom}>
                <option value={`DIVISION:${d.id}`}>{d.nom} (niveau Division)</option>
                {(cadre.data?.bureaux || []).filter((b) => b.division_id === d.id).map((b) => <option key={b.id} value={`BUREAU:${b.id}`}>— {b.nom}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Poste organique" error={errors.poste_id?.message} required>
          <select className="input" {...register('poste_id')} disabled={!postes.length}><option value="">— Choisir —</option>{postes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}</select>
        </Field>
        <Field label="Date d’effet" error={errors.date_debut?.message} required><input type="date" className="input" {...register('date_debut')} /></Field>
        <Field label="Motif / référence de l’acte"><input className="input" {...register('motif')} /></Field>
      </form>
    </Modal>
  );
}

function ClotureModal({ agent, onClose, onDone }) {
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({ defaultValues: { date_fin: new Date().toISOString().slice(0, 10) } });
  const submit = async (v) => { await runAction(() => api.post(`/agents/${agent.id}/affectations/cloturer`, v), 'Affectation clôturée.'); onDone(); };
  return (
    <Modal open title="Clôturer l’affectation" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button form="clo" className="btn-danger" disabled={isSubmitting}>Clôturer</button></>}>
      <form id="clo" onSubmit={handleSubmit(submit)} className="space-y-3">
        <Field label="Date de fin" required><input type="date" className="input" {...register('date_fin', { required: true })} /></Field>
        <Field label="Motif de clôture" required><input className="input" {...register('motif_cloture', { required: true, minLength: 3 })} /></Field>
      </form>
    </Modal>
  );
}

export default function AgentDetail() {
  const { id } = useParams();
  const state = useApi(`/agents/${id}`);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const [v, setV] = useState(0);
  const manage = can('personnel.gerer', 'personnel.suivre');
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append('photo', file);
    try { await api.post(`/agents/${id}/photo`, fd); toast.success('Photo enregistrée.'); setV((x) => x + 1); state.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const archive = async () => {
    const motif = await confirm({ title: 'Archiver l’Agent', message: 'L’Agent sera archivé, son affectation clôturée et son compte désactivé. Son historique est conservé.', danger: true, confirmLabel: 'Archiver', input: { label: 'Motif', required: true } });
    if (!motif) return;
    await runAction(() => api.post(`/agents/${id}/archiver`, { motif }), 'Agent archivé.');
    state.reload();
  };
  const done = () => { setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(a) => (
        <>
          <PageHeader title={[a.prenom, a.nom, a.postnom].filter(Boolean).join(' ')} subtitle={`Matricule ${a.matricule} · ${a.fonction || ''}`} breadcrumb={[{ label: 'Personnel', to: '/personnel' }, { label: a.nom }]}
            actions={<>
              {manage && !a.archived_at && <Link to={`/personnel/${id}/modifier`} className="btn-secondary"><Pencil size={16} /> Modifier</Link>}
              {can('affectations.gerer') && !a.est_autorite && !a.archived_at && <button type="button" className="btn-secondary" onClick={() => setModal('aff')}><ArrowRightLeft size={16} /> Affecter</button>}
              {can('affectations.gerer') && a.affectation_id && <button type="button" className="btn-secondary" onClick={() => setModal('clo')}><XCircle size={16} /> Clôturer l’affectation</button>}
              {can('comptes.creer', 'comptes.preparer') && !a.user_id && a.niveau && <Link to={`/comptes/nouveau?agent=${id}`} className="btn-primary"><UserPlus size={16} /> Créer le compte</Link>}
              {can('personnel.gerer') && !a.archived_at && <button type="button" className="btn-ghost text-red-700" onClick={archive}><Archive size={16} /> Archiver</button>}
            </>} />
          <AgentView a={a} photoVersion={v} extraActions={manage && <label className="btn-ghost mt-2 cursor-pointer text-xs no-print"><Upload size={14} /> Photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files[0])} /></label>} />
          {modal === 'aff' && <AffectationModal agent={a} onClose={() => setModal(null)} onDone={done} />}
          {modal === 'clo' && <ClotureModal agent={a} onClose={() => setModal(null)} onDone={done} />}
        </>
      )}
    </Loadable>
  );
}
