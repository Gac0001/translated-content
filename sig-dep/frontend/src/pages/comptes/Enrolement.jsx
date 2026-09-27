import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FileCheck2, ImagePlus, Lock, ListChecks, Search, UserPlus } from 'lucide-react';
import api from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useApi, runAction, PageHeader, Card, Field, InfoAlert, Loadable, Badge, KeyValues, Spinner, ErrorAlert } from '../../components/ui';
import TempPassword from './TempPassword';

const today = () => new Date().toISOString().slice(0, 10);
const date = (label) => z.string().min(1, `${label} requise`).refine((v) => v <= today(), `${label} ne peut pas être future`);

const schema = z.object({
  username: z.string().trim().toLowerCase().min(3, 'Au moins 3 caractères').regex(/^[a-z0-9._-]+$/, 'Minuscules, chiffres, point ou tiret uniquement'),
  sexe: z.enum(['M', 'F'], { message: 'Sexe requis' }),
  date_naissance: date('Date de naissance'),
  lieu_naissance: z.string().trim().max(150).optional(),
  date_mise_en_service: date('Date de mise en service'),
  numero_carte_igap: z.string().trim().min(3, 'Numéro de carte IGAP requis').max(60),
  fonction_id: z.string().min(1, 'Fonction requise'),
  telephone: z.string().trim().max(40).optional(),
  email: z.union([z.email('Adresse invalide'), z.literal('')]).optional(),
  adresse: z.string().trim().max(300).optional(),
  structure: z.string().optional(),
  role: z.enum(['AGENT', 'CHEF_BUREAU']).optional(),
  date_affectation: z.string().optional(),
}).refine((v) => !v.date_naissance || !v.date_mise_en_service || v.date_mise_en_service > v.date_naissance, { path: ['date_mise_en_service'], message: 'Doit être postérieure à la date de naissance' });

const ROLE_LIB = { AGENT: 'Agent', CHEF_BUREAU: 'Chef de Bureau', CHEF_DIVISION: 'Chef de Division' };

/** Choix du fichier avec aperçu (photo) ou nom (commission). */
function FileInput({ label, accept, file, onChange, error, preview, hint, icon: Icon }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!preview || !file) { setUrl(null); return undefined; }
    const u = URL.createObjectURL(file); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, preview]);
  return (
    <Field label={label} required error={error} hint={hint}>
      <label className={`flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 text-sm hover:bg-slate-50 ${error ? 'border-red-400' : 'border-slate-300'}`}>
        {url ? <img src={url} alt="Aperçu" className="h-16 w-16 rounded object-cover" /> : <Icon size={22} className="shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choisir un fichier…'}</span>
        <input type="file" className="sr-only" accept={accept} onChange={(e) => onChange(e.target.files?.[0] || null)} />
      </label>
    </Field>
  );
}

function Formulaire({ agentId, onCreated }) {
  const pre = useApi(`/enrolement/agents/${agentId}`);
  const [photo, setPhoto] = useState(null);
  const [commission, setCommission] = useState(null);
  const [fileErr, setFileErr] = useState({});
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!pre.data) return;
    const a = pre.data.agent;
    reset({
      username: pre.data.usernamePropose, sexe: a.sexe || '', date_naissance: a.date_naissance || '', lieu_naissance: a.lieu_naissance || '',
      date_mise_en_service: a.date_mise_en_service || '', numero_carte_igap: a.numero_carte_igap || '',
      fonction_id: pre.data.fonctions.some((f) => f.id === a.fonction_id) ? String(a.fonction_id) : '',
      telephone: a.telephone || '', email: a.email || '', adresse: a.adresse || '', structure: '', role: 'AGENT', date_affectation: '',
    });
    setPhoto(null); setCommission(null); setFileErr({});
  }, [pre.data, reset]);

  const structure = watch('structure');
  if (pre.loading) return <Spinner />;
  if (pre.error) return <ErrorAlert message={pre.error} onRetry={pre.reload} />;
  const { agent: a, affectation: aff, fonctions, structures } = pre.data;
  const divisions = structures.divisions;
  const bureauxDirection = structures.bureaux.filter((b) => b.rattachement === 'DIRECTION');

  const submit = async (v) => {
    const fe = { photo: !photo && 'La photo de l’agent est obligatoire.', commission: !commission && 'La commission d’affectation est obligatoire.' };
    if (!aff && !v.structure) fe.structure = 'Choisissez la structure d’affectation.';
    setFileErr(fe);
    if (fe.photo || fe.commission || fe.structure) return;
    const fd = new FormData();
    const { structure: s, role, date_affectation: da, ...rest } = v;
    Object.entries(rest).forEach(([k, val]) => { if (val !== undefined && val !== '') fd.append(k, val); });
    if (!aff) {
      const [type, id] = s.split(':');
      fd.append(type === 'B' ? 'bureau_id' : 'division_id', id);
      if (type === 'B') fd.append('role', role);
      if (da) fd.append('date_affectation', da);
    }
    fd.append('photo', photo);
    fd.append('commission', commission);
    const r = await runAction(() => api.post(`/enrolement/agents/${agentId}`, fd));
    onCreated(r.data);
  };

  const t = (n, l, req, props = {}) => <Field label={l} error={errors[n]?.message} required={req}><input className="input" {...register(n)} {...props} /></Field>;

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      {!pre.data.enrolable && <InfoAlert tone="warning">{pre.data.motif}</InfoAlert>}
      <Card title="Informations de la liste déclarative" actions={<Badge className="bg-slate-100 text-slate-700 ring-slate-200"><Lock size={12} /> Non modifiables ici</Badge>}>
        <KeyValues cols={3} items={[
          ['Nom', a.nom], ['Postnom', a.postnom], ['Prénom', a.prenom], ['Matricule', a.matricule], ['Grade', a.grade_libelle ? `${a.grade_libelle} (${a.grade_code})` : null],
          aff && ['Division', aff.division_nom || 'Aucune'], aff && ['Bureau', aff.bureau_nom || '—'], aff && ['Poste organique', aff.poste], aff && ['Rôle du compte', ROLE_LIB[aff.role]],
        ]} />
      </Card>

      <Card title="Informations complémentaires">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Sexe" required error={errors.sexe?.message}>
            <select className="input" {...register('sexe')}><option value="">— Choisir —</option><option value="M">Masculin</option><option value="F">Féminin</option></select>
          </Field>
          {t('date_naissance', 'Date de naissance', true, { type: 'date', max: today() })}
          {t('lieu_naissance', 'Lieu de naissance')}
          {t('date_mise_en_service', 'Date de mise en service', true, { type: 'date', max: today() })}
          {t('numero_carte_igap', 'Numéro de la carte IGAP', true)}
          <Field label="Fonction" required error={errors.fonction_id?.message} hint={`Fonctions correspondant au grade ${a.grade_code || '—'}.`}>
            <select className="input" {...register('fonction_id')} disabled={!fonctions.length}>
              <option value="">{fonctions.length ? '— Choisir —' : 'Aucune fonction pour ce grade'}</option>
              {fonctions.map((f) => <option key={f.id} value={f.id}>{f.libelle}</option>)}
            </select>
          </Field>
          {t('telephone', 'Téléphone')}
          {t('email', 'Adresse électronique', false, { type: 'email' })}
          {t('adresse', 'Adresse')}
        </div>
      </Card>

      {!aff && (
        <Card title="Affectation">
          <InfoAlert>Cet agent n’a pas d’affectation sur la liste déclarative : choisissez sa Division et son Bureau.</InfoAlert>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Division / Bureau d’affectation" required error={fileErr.structure} className="sm:col-span-2">
              <select className="input" {...register('structure')}>
                <option value="">— Choisir —</option>
                {bureauxDirection.length > 0 && (
                  <optgroup label="Bureaux rattachés au Directeur">
                    {bureauxDirection.map((b) => <option key={b.id} value={`B:${b.id}`}>{b.nom}</option>)}
                  </optgroup>
                )}
                {divisions.map((d) => (
                  <optgroup key={d.id} label={d.nom}>
                    {a.grade_code === 'CD' && <option value={`D:${d.id}`}>{d.nom} — niveau Division (Chef de Division)</option>}
                    {structures.bureaux.filter((b) => b.division_id === d.id).map((b) => <option key={b.id} value={`B:${b.id}`}>{b.nom}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
            {structure?.startsWith('B:') && (
              <Field label="Poste" required>
                <select className="input" {...register('role')}><option value="AGENT">Agent</option><option value="CHEF_BUREAU">Chef de Bureau</option></select>
              </Field>
            )}
            {t('date_affectation', 'Date d’affectation', false, { type: 'date' })}
          </div>
        </Card>
      )}

      <Card title="Pièces à joindre">
        <div className="grid gap-4 sm:grid-cols-2">
          <FileInput label="Photo de l’agent" accept="image/jpeg,image/png,image/webp" file={photo} onChange={setPhoto} error={fileErr.photo} preview icon={ImagePlus} hint="JPEG, PNG ou WebP." />
          <FileInput label="Commission d’affectation" accept="application/pdf,image/jpeg,image/png,image/webp" file={commission} onChange={setCommission} error={fileErr.commission} icon={FileCheck2} hint="PDF ou image scannée." />
        </div>
      </Card>

      <Card title="Compte">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t('username', 'Nom d’utilisateur', true)}
          <div className="text-sm text-slate-600 lg:col-span-2 lg:self-end">Un mot de passe temporaire est généré ; l’agent devra le changer à la première connexion.</div>
        </div>
      </Card>

      <button className="btn-primary" disabled={isSubmitting || !pre.data.enrolable}><UserPlus size={16} /> {isSubmitting ? 'Création…' : 'Créer le compte'}</button>
    </form>
  );
}

export default function Enrolement() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [created, setCreated] = useState(null);
  const can = useAuth((s) => s.can);
  const state = useApi('/enrolement/candidats');
  const agentId = params.get('agent');
  const select = (id) => setParams(id ? { agent: String(id) } : {});

  const filtres = useMemo(() => {
    const n = q.trim().toLowerCase();
    const rows = state.data?.candidats || [];
    return n ? rows.filter((c) => `${c.nom} ${c.postnom || ''} ${c.prenom || ''} ${c.matricule}`.toLowerCase().includes(n)) : rows;
  }, [state.data, q]);

  return (
    <>
      <PageHeader title="Enrôlement des agents" subtitle="Création des comptes à partir de la liste déclarative validée par le Directeur."
        breadcrumb={[{ label: 'Enrôlement' }]}
        actions={can('liste.consulter') && <Link to="/liste-declarative" className="btn-secondary"><ListChecks size={16} /> Liste déclarative</Link>} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            {d.statutListe === 'NON_VALIDEE' && <InfoAlert tone="warning">La liste déclarative n’a pas encore été validée par le Directeur : aucun compte ne peut être créé.</InfoAlert>}
            {d.statutListe === 'A_REVALIDER' && <InfoAlert tone="warning">La liste déclarative a changé depuis sa dernière validation : les agents ajoutés ou modifiés seront enrôlables après sa revalidation par le Directeur.</InfoAlert>}
            {d.portee === 'TOUS' && d.resume.secretariatSansCompte > 0 && <InfoAlert>Commencez par les agents du Bureau Secrétariat de Direction ({d.resume.secretariatSansCompte} sans compte) : une fois enrôlés, ils créeront les comptes des agents des Divisions.</InfoAlert>}
            {d.portee === 'HORS_SECRETARIAT' && <InfoAlert>En tant que membre du Bureau Secrétariat de Direction, vous enrôlez les agents des Divisions et des autres Bureaux. Les comptes du Secrétariat sont créés par l’Admin.</InfoAlert>}
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
              <Card title={`Agents sans compte (${d.resume.sansCompte})`} bodyClass="p-0">
                <div className="border-b border-slate-100 p-3">
                  <div className="relative">
                    <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
                    <input className="input pl-8" placeholder="Nom ou matricule…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un agent" />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{d.resume.enrolables} enrôlable(s) · {d.resume.avecCompte} compte(s) déjà créé(s){d.validation ? ` · liste validée le ${fmtDateTime(d.validation.valide_at)}` : ''}</p>
                </div>
                <ul className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
                  {filtres.map((c) => (
                    <li key={c.agent_id}>
                      <button type="button" onClick={() => select(c.agent_id)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-dep-50/60 ${String(c.agent_id) === agentId ? 'bg-dep-50' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className="flex-1 font-medium">{[c.nom, c.postnom, c.prenom].filter(Boolean).join(' ')}</span>
                          {c.enrolable ? <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Enrôlable</Badge> : <Badge title={c.motif}>Bloqué</Badge>}
                        </div>
                        <div className="text-xs text-slate-500">{c.matricule} · {c.grade || 'grade ?'} · {c.structure || 'sans affectation'}</div>
                        {!c.enrolable && <div className="text-xs text-amber-700">{c.motif}</div>}
                      </button>
                    </li>
                  ))}
                  {!filtres.length && <li className="p-4 text-sm text-slate-500">{q ? 'Aucun agent ne correspond : il doit d’abord figurer sur la liste déclarative.' : 'Tous les agents de la liste ont un compte.'}</li>}
                </ul>
              </Card>
              <div>
                {agentId
                  ? <Formulaire key={agentId} agentId={agentId} onCreated={(r) => { setCreated(r); }} />
                  : <Card><p className="text-sm text-slate-600">Recherchez l’agent dans la liste : s’il figure sur la liste déclarative validée, le formulaire est prérempli avec les informations connues. Complétez ensuite la date de naissance, la date de mise en service, le numéro de la carte IGAP, la fonction, et joignez sa photo et sa commission d’affectation.</p></Card>}
              </div>
            </div>
          </div>
        )}
      </Loadable>
      <TempPassword data={created} onClose={() => { setCreated(null); select(null); state.reload(); }} />
    </>
  );
}
