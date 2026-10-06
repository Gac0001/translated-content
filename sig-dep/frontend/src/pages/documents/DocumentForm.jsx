import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Save } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, Spinner, InfoAlert } from '../../components/ui';
import { DynamicField } from '../../components/shared';

const schema = z.object({
  titre: z.string().trim().min(3, 'Titre requis (3 caractères minimum)'),
  confidentialite: z.enum(['ORDINAIRE', 'CONFIDENTIEL', 'SECRET']),
  commentaire: z.string().max(500).optional(),
});

export default function DocumentForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const types = useApi('/documents/types');
  const existing = useApi(id ? `/documents/${id}` : null);
  const [typeCode, setTypeCode] = useState(null);
  const [contenu, setContenu] = useState({});
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: { confidentialite: 'ORDINAIRE' } });
  useEffect(() => {
    const d = existing.data;
    if (d) { setTypeCode(d.type_document); setContenu(d.contenu || {}); reset({ titre: d.titre, confidentialite: d.confidentialite, commentaire: '' }); }
  }, [existing.data, reset]);
  const type = (types.data?.data || []).find((t) => t.code === typeCode);
  const submit = async (v) => {
    const body = { ...v, contenu };
    const r = await runAction(() => (id ? api.put(`/documents/${id}`, body) : api.post('/documents', { ...body, type_document: typeCode, task_id: params.get('tache') ? Number(params.get('tache')) : null, instruction_id: params.get('instruction') ? Number(params.get('instruction')) : null })), id ? 'Nouvelle version enregistrée.' : 'Brouillon créé.');
    navigate(`/documents/${r.data.id}`);
  };
  if (types.loading || (id && existing.loading)) return <Spinner />;
  if (!type) {
    return (
      <>
        <PageHeader title="Nouveau document de service" subtitle="Choisissez le modèle de document." breadcrumb={[{ label: 'Documents', to: '/documents' }, { label: 'Nouveau' }]} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {types.data.data.map((t) => (
            <button key={t.code} type="button" onClick={() => setTypeCode(t.code)} className="card p-4 text-left transition hover:border-dep-400 hover:shadow">
              <div className="font-semibold text-dep-800">{t.libelle}</div>
              <p className="mt-1 text-sm text-slate-600">{t.description}</p>
              <p className="mt-2 text-xs text-slate-500">{t.sections.length} rubriques</p>
            </button>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title={id ? `Modifier — ${type.libelle}` : `Nouveau — ${type.libelle}`} subtitle={id ? 'Chaque enregistrement crée une nouvelle version ; les versions antérieures sont conservées.' : type.description}
        breadcrumb={[{ label: 'Documents', to: '/documents' }, { label: id ? 'Modification' : 'Nouveau' }]}
        actions={!id && <button type="button" className="btn-ghost" onClick={() => setTypeCode(null)}><ArrowLeft size={16} /> Changer de modèle</button>} />
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <Card title="En-tête">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Titre" error={errors.titre?.message} required className="sm:col-span-2"><input className="input" {...register('titre')} /></Field>
            <Field label="Confidentialité"><select className="input" {...register('confidentialite')}><option value="ORDINAIRE">Ordinaire</option><option value="CONFIDENTIEL">Confidentiel</option><option value="SECRET">Secret</option></select></Field>
          </div>
        </Card>
        <InfoAlert>Les rubriques marquées * sont obligatoires pour transmettre le document. Vous pouvez enregistrer un brouillon incomplet.</InfoAlert>
        {type.sections.map((s, i) => (
          <Card key={s.key} title={`${i + 1}. ${s.label}${s.required ? ' *' : ''}`}>
            {s.help && <p className="mb-2 text-xs text-slate-500">{s.help}</p>}
            <DynamicField field={s} aria-label={s.label} value={contenu[s.key]} onChange={(v) => setContenu((c) => ({ ...c, [s.key]: v }))} />
          </Card>
        ))}
        {id && <Card><Field label="Commentaire de version"><input className="input" placeholder="Ex. : prise en compte des observations du Chef de Bureau" {...register('commentaire')} /></Field></Card>}
        <div className="flex gap-2"><button className="btn-primary" disabled={isSubmitting}><Save size={16} /> {id ? 'Enregistrer une nouvelle version' : 'Créer le brouillon'}</button><button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Annuler</button></div>
      </form>
    </>
  );
}
