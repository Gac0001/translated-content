import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, ArrowRight, Check, FileCheck2, IdCard, ImagePlus, ListChecks, Lock, Search, UserPlus, UserSearch,
} from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useApi, runAction, PageHeader, Card, Field, InfoAlert, Loadable, Badge, KeyValues, Spinner, ErrorAlert } from '../../components/ui';
import { COLORS } from '../../lib/labels';
import TempPassword from './TempPassword';

const today = () => new Date().toISOString().slice(0, 10);
const date = (label) => z.string().min(1, `${label} requise`).refine((v) => v <= today(), `${label} ne peut pas être future`);

const base = z.object({
  identite_confirmee: z.literal(true, { message: 'Confirmez l’identité de l’agent pour continuer.' }),
  structure: z.string().optional(),
  role: z.enum(['AGENT', 'CHEF_BUREAU']).optional(),
  date_affectation: z.string().optional(),
  affectation_confirmee: z.literal(true, { message: 'Confirmez l’affectation pour continuer.' }),
  sexe: z.enum(['M', 'F'], { message: 'Sexe requis' }),
  date_naissance: date('Date de naissance'),
  lieu_naissance: z.string().trim().max(150).optional(),
  date_mise_en_service: date('Date de mise en service'),
  numero_carte_igap: z.string().trim().min(3, 'Numéro de carte IGAP requis').max(60),
  fonction_id: z.string().min(1, 'Fonction requise'),
  telephone: z.string().trim().max(40).optional(),
  email: z.union([z.email('Adresse invalide'), z.literal('')]).optional(),
  adresse: z.string().trim().max(300).optional(),
  username: z.string().trim().toLowerCase().min(3, 'Au moins 3 caractères').regex(/^[a-z0-9._-]+$/, 'Minuscules, chiffres, point ou tiret uniquement'),
});
const apresNaissance = (v) => !v.date_naissance || !v.date_mise_en_service || v.date_mise_en_service > v.date_naissance;
const schema = base.refine(apresNaissance || !v.date_mise_en_service || v.date_mise_en_service > v.date_naissance, { path: ['date_mise_en_service'], message: 'Doit être postérieure à la date de naissance' });

/** Champs contrôlés à chaque étape (validation explicite, indépendante du reste du formulaire). */
const CHAMPS_ETAPE = {
  1: ['identite_confirmee'],
  2: ['affectation_confirmee'],
  3: ['sexe', 'date_naissance', 'lieu_naissance', 'date_mise_en_service', 'numero_carte_igap', 'fonction_id', 'telephone', 'email', 'adresse'],
};

const ROLE_LIB = { AGENT: 'Agent', CHEF_BUREAU: 'Chef de Bureau', CHEF_DIVISION: 'Chef de Division' };
const ETAPES = ['Identification', 'Fiche de la liste', 'Affectation', 'Informations complémentaires', 'Récapitulatif'];
const STATUTS = {
  ENROLABLE: ['Enrôlable', COLORS.succes],
  COMPTE_EXISTANT: ['Compte existant', COLORS.neutre],
  NON_INSCRIT: ['Absent de la liste', COLORS.danger],
  A_REVALIDER: ['Liste à revalider', COLORS.attention],
  LISTE_NON_VALIDEE: ['Liste non validée', COLORS.attention],
  HORS_PORTEE: ['Hors de votre portée', COLORS.neutre],
};
const nomListe = (a) => [a.nom, a.postnom, a.prenom].filter(Boolean).join(' ');

function Stepper({ etape }) {
  return (
    <ol className="mb-5 flex flex-wrap gap-x-1 gap-y-2 text-xs sm:text-sm" aria-label="Étapes de l’enrôlement">
      {ETAPES.map((l, i) => {
        const fait = i < etape; const actif = i === etape;
        return (
          <li key={l} className="flex items-center gap-1.5" aria-current={actif ? 'step' : undefined}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${fait ? 'bg-emerald-600 text-white' : actif ? 'bg-dep-700 text-white' : 'bg-slate-200 text-slate-600'}`}>{fait ? <Check size={14} /> : i + 1}</span>
            <span className={actif ? 'font-semibold text-dep-800' : fait ? 'text-slate-700' : 'text-slate-500'}>{l}</span>
            {i < ETAPES.length - 1 && <span className="mx-1 hidden h-px w-6 bg-slate-300 sm:inline-block" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Choix d’un fichier avec aperçu (photo) ou nom (commission). */
function FileInput({ label, accept, file, onChange, error, preview, hint, icon: Icon }) {
  const [url, setUrl] = useState(null);
  const id = useId();
  useEffect(() => {
    if (!preview || !file) { setUrl(null); return undefined; }
    const u = URL.createObjectURL(file); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, preview]);
  return (
    <Field label={label} required error={error} hint={hint} id={id}>
      <label className={`flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 text-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-dep-400 ${error ? 'border-red-400' : 'border-slate-300'}`}>
        {url ? <img src={url} alt="Aperçu" className="h-16 w-16 rounded object-cover" /> : <Icon size={22} className="shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choisir un fichier…'}</span>
        <input id={id} type="file" className="sr-only" accept={accept} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.files?.[0] || null)} />
      </label>
    </Field>
  );
}

function Confirmation({ register, name, error, children }) {
  return (
    <div className={`rounded-md border p-3 ${error ? 'border-red-300 bg-red-50' : 'border-dep-200 bg-dep-50/60'}`}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" {...register(name)} />
        <span>{children}</span>
      </label>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// ─── Étape 1 : identification ───────────────────────────────────────────────
function Identification({ onSelect }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const candidats = useApi('/enrolement/candidats');

  const chercher = async (e, valeur) => {
    if (e) e.preventDefault();
    const terme = (valeur ?? q).trim();
    if (terme.length < 2) { setErr('Saisissez au moins 2 caractères : matricule ou nom.'); return; }
    setBusy(true); setErr(null);
    try { setRes((await api.get('/enrolement/identifier', { params: { q: terme } })).data); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  const enrolables = (candidats.data?.candidats || []).filter((c) => c.enrolable);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(260px,340px)]">
      <Card title="Identifier l’agent">
        <p className="mb-3 text-sm text-slate-600">Saisissez le <b>matricule</b> (avec ou sans points) ou le <b>nom</b> de l’agent. Le système vérifie qu’il figure sur la liste déclarative validée par le Directeur et génère sa fiche.</p>
        <form onSubmit={chercher} className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input className="input pl-8" placeholder="Ex. 1.234.567 ou MASIKA" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Matricule ou nom de l’agent" autoFocus />
          </div>
          <button className="btn-primary" disabled={busy}><UserSearch size={16} /> {busy ? 'Recherche…' : 'Rechercher sur la liste'}</button>
        </form>
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        {res && (
          <div className="mt-4">
            {!res.resultats.length && <InfoAlert tone="warning">Aucun agent ne correspond à « {res.q} ». Un agent doit d’abord être inscrit sur la liste déclarative et la liste validée par le Directeur.</InfoAlert>}
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {res.resultats.map((r) => (
                <li key={r.agent_id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{nomListe(r)}</span><Badge className={STATUTS[r.statut][1]}>{STATUTS[r.statut][0]}</Badge></div>
                    <div className="text-xs text-slate-500">Matricule {r.matricule} · {r.grade || 'grade ?'} · {r.structure || 'sans affectation'}</div>
                    {r.motif && <div className="mt-0.5 text-xs text-amber-800">{r.motif}</div>}
                  </div>
                  {r.statut === 'ENROLABLE' && <button type="button" className="btn-primary" onClick={() => onSelect(r.agent_id)}><IdCard size={16} /> Générer la fiche</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card title={`À enrôler (${enrolables.length})`} bodyClass="p-0">
        {candidats.loading ? <Spinner /> : (
          <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
            {enrolables.map((c) => (
              <li key={c.agent_id}>
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-dep-50/60" onClick={() => { setQ(c.matricule); chercher(null, c.matricule); }}>
                  <div className="font-medium">{nomListe(c)}</div>
                  <div className="text-xs text-slate-500">{c.matricule} · {c.structure || 'sans affectation'}</div>
                </button>
              </li>
            ))}
            {!enrolables.length && <li className="p-4 text-sm text-slate-500">Aucun agent enrôlable pour le moment.</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Étapes 2 à 5 ───────────────────────────────────────────────────────────
function Assistant({ agentId, etape, setEtape, onCreated, onAnnuler }) {
  const pre = useApi(`/enrolement/agents/${agentId}`);
  const [photo, setPhoto] = useState(null);
  const [commission, setCommission] = useState(null);
  const [fileErr, setFileErr] = useState({});
  const { register, handleSubmit, reset, watch, getValues, setError, clearErrors, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!pre.data) return;
    const a = pre.data.agent;
    reset({
      identite_confirmee: false, affectation_confirmee: false, structure: '', role: 'AGENT', date_affectation: '',
      username: pre.data.usernamePropose, sexe: a.sexe || '', date_naissance: a.date_naissance || '', lieu_naissance: a.lieu_naissance || '',
      date_mise_en_service: a.date_mise_en_service || '', numero_carte_igap: a.numero_carte_igap || '',
      fonction_id: pre.data.fonctions.some((f) => f.id === a.fonction_id) ? String(a.fonction_id) : '',
      telephone: a.telephone || '', email: a.email || '', adresse: a.adresse || '',
    });
  }, [pre.data, reset]);

  const structure = watch('structure');
  if (pre.loading) return <Spinner label="Génération de la fiche…" />;
  if (pre.error) return <ErrorAlert message={pre.error} onRetry={pre.reload} />;
  const { agent: a, affectation: aff, fonctions, structures } = pre.data;
  const bureauxDirection = structures.bureaux.filter((b) => b.rattachement === 'DIRECTION');
  const structureChoisie = () => {
    const [t, id] = (getValues('structure') || '').split(':');
    if (t === 'B') { const b = structures.bureaux.find((x) => String(x.id) === id); const d = structures.divisions.find((x) => x.id === b?.division_id); return { bureau: b?.nom, division: d?.nom || 'Aucune (rattaché au Directeur)' }; }
    if (t === 'D') return { bureau: '—', division: structures.divisions.find((x) => String(x.id) === id)?.nom };
    return {};
  };

  const valider = (champs) => {
    clearErrors(champs);
    const shape = Object.fromEntries(champs.map((c) => [c, true]));
    const r = base.pick(shape).safeParse(getValues());
    const issues = r.success ? [] : r.error.issues;
    if (champs.includes('date_mise_en_service') && !issues.length && !apresNaissance(getValues())) issues.push({ path: ['date_mise_en_service'], message: 'Doit être postérieure à la date de naissance' });
    issues.forEach((i) => setError(i.path[0], { type: 'manual', message: i.message }));
    return !issues.length;
  };

  const suivant = () => {
    const fe = {};
    let ok = valider(CHAMPS_ETAPE[etape]);
    if (etape === 2) {
      if (!aff && !getValues('structure')) { fe.structure = 'Choisissez la structure d’affectation.'; ok = false; }
      if (!commission) { fe.commission = 'Joignez la commission d’affectation.'; ok = false; }
    }
    if (etape === 3) {
      if (!photo) { fe.photo = 'Joignez la photo de l’agent.'; ok = false; }
    }
    setFileErr(fe);
    if (ok) setEtape(etape + 1);
  };

  const submit = async (v) => {
    const fd = new FormData();
    const { structure: s, role, date_affectation: da, identite_confirmee: ic, affectation_confirmee: ac, ...rest } = v;
    Object.entries(rest).forEach(([k, val]) => { if (val !== undefined && val !== '') fd.append(k, val); });
    fd.append('identite_confirmee', String(ic)); fd.append('affectation_confirmee', String(ac));
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
  const v = getValues();
  const sc = structureChoisie();
  const fonction = fonctions.find((f) => String(f.id) === v.fonction_id);

  return (
    <form onSubmit={etape === 4 ? handleSubmit(submit) : (e) => { e.preventDefault(); suivant(); }} noValidate className="space-y-4">
      {!pre.data.enrolable && <InfoAlert tone="warning">{pre.data.motif}</InfoAlert>}

      {etape === 1 && (
        <Card title="Fiche générée depuis la liste déclarative" actions={<Badge tone="neutre"><Lock size={12} /> Données de la liste validée</Badge>}>
          <KeyValues cols={3} items={[
            ['Nom', a.nom], ['Postnom', a.postnom], ['Prénom', a.prenom], ['Matricule', a.matricule],
            ['Grade', a.grade_libelle ? `${a.grade_libelle} (${a.grade_code})` : null], ['Sexe', a.sexe === 'F' ? 'Féminin' : a.sexe === 'M' ? 'Masculin' : 'À renseigner'],
            a.date_naissance && ['Date de naissance', fmtDate(a.date_naissance)], a.numero_carte_igap && ['N° carte IGAP', a.numero_carte_igap],
          ]} />
          <p className="mt-4 text-sm text-slate-600">Comparez cette fiche avec la pièce d’identité ou la carte de service de l’agent. Si une information est erronée, ne poursuivez pas : signalez-la au Directeur, qui corrigera puis revalidera la liste.</p>
          <div className="mt-3">
            <Confirmation register={register} name="identite_confirmee" error={errors.identite_confirmee?.message}>
              J’atteste avoir vérifié l’identité de l’agent : elle correspond à la fiche de la liste déclarative (nom, postnom, prénom, matricule et grade).
            </Confirmation>
          </div>
        </Card>
      )}

      {etape === 2 && (
        <Card title="Confirmation de l’affectation">
          {aff ? (
            <>
              <KeyValues cols={3} items={[
                ['Division', aff.division_nom || 'Aucune'], ['Bureau', aff.bureau_nom || '—'], ['Poste organique', aff.poste],
                ['Rôle du compte', ROLE_LIB[aff.role]], ['Date d’affectation', fmtDate(aff.date_affectation)],
              ]} />
              <p className="mt-3 text-xs text-slate-500">Affectation reprise de la liste validée. Une erreur se corrige par le Directeur (Personnel → Affecter), puis la liste est revalidée.</p>
            </>
          ) : (
            <>
              <InfoAlert>Cet agent n’a pas d’affectation sur la liste : indiquez celle de sa commission d’affectation.</InfoAlert>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Division / Bureau d’affectation" required error={fileErr.structure} className="sm:col-span-2">
                  <select className="input" {...register('structure')}>
                    <option value="">— Choisir —</option>
                    {bureauxDirection.length > 0 && <optgroup label="Bureaux rattachés au Directeur">{bureauxDirection.map((b) => <option key={b.id} value={`B:${b.id}`}>{b.nom}</option>)}</optgroup>}
                    {structures.divisions.map((d) => (
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
            </>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FileInput label="Commission d’affectation" accept="application/pdf,image/jpeg,image/png,image/webp" file={commission} onChange={setCommission} error={fileErr.commission} icon={FileCheck2} hint="PDF ou image scannée." />
          </div>
          <div className="mt-3">
            <Confirmation register={register} name="affectation_confirmee" error={errors.affectation_confirmee?.message}>
              Je confirme que cette affectation correspond à la commission d’affectation jointe.
            </Confirmation>
          </div>
        </Card>
      )}

      {etape === 3 && (
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
            <div className="sm:col-span-2 lg:col-span-1">
              <FileInput label="Photo de l’agent" accept="image/jpeg,image/png,image/webp" file={photo} onChange={setPhoto} error={fileErr.photo} preview icon={ImagePlus} hint="JPEG, PNG ou WebP." />
            </div>
          </div>
        </Card>
      )}

      {etape === 4 && (
        <>
          <Card title="Récapitulatif">
            <KeyValues cols={3} items={[
              ['Agent', nomListe(a)], ['Matricule', a.matricule], ['Grade', a.grade_code],
              ['Division', aff ? aff.division_nom || 'Aucune' : sc.division], ['Bureau', aff ? aff.bureau_nom || '—' : sc.bureau],
              ['Rôle du compte', ROLE_LIB[aff ? aff.role : (structure?.startsWith('D:') ? 'CHEF_DIVISION' : v.role)]],
              ['Sexe', v.sexe === 'F' ? 'Féminin' : 'Masculin'], ['Date de naissance', fmtDate(v.date_naissance)], ['Lieu de naissance', v.lieu_naissance],
              ['Date de mise en service', fmtDate(v.date_mise_en_service)], ['N° carte IGAP', v.numero_carte_igap?.toUpperCase()], ['Fonction', fonction?.libelle],
              ['Téléphone', v.telephone], ['Adresse électronique', v.email], ['Adresse', v.adresse],
              ['Photo', photo?.name], ['Commission d’affectation', commission?.name], ['Vérifications', 'Identité et affectation confirmées'],
            ]} />
          </Card>
          <Card title="Compte">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {t('username', 'Nom d’utilisateur', true)}
              <div className="text-sm text-slate-600 lg:col-span-2 lg:self-end">Un mot de passe temporaire est généré ; l’agent devra le changer à la première connexion.</div>
            </div>
          </Card>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => (etape === 1 ? onAnnuler() : setEtape(etape - 1))}><ArrowLeft size={16} /> {etape === 1 ? 'Changer d’agent' : 'Précédent'}</button>
        {etape < 4 && <button type="button" className="btn-primary" onClick={suivant} disabled={!pre.data.enrolable}>Suivant <ArrowRight size={16} /></button>}
        {etape === 4 && <button className="btn-success" disabled={isSubmitting || !pre.data.enrolable}><UserPlus size={16} /> {isSubmitting ? 'Création…' : 'Créer le compte'}</button>}
      </div>
    </form>
  );
}

export default function Enrolement() {
  const [params, setParams] = useSearchParams();
  const [etape, setEtape] = useState(params.get('agent') ? 1 : 0);
  const [created, setCreated] = useState(null);
  const can = useAuth((s) => s.can);
  const state = useApi('/enrolement/candidats');
  const agentId = params.get('agent');
  const select = (id) => { setParams(id ? { agent: String(id) } : {}); setEtape(id ? 1 : 0); };

  return (
    <>
      <PageHeader title="Enrôlement des agents" subtitle="Création des comptes à partir de la liste déclarative validée par le Directeur."
        breadcrumb={[{ label: 'Administration' }, { label: 'Enrôlement des agents' }]}
        actions={can('liste.consulter') && <Link to="/liste-declarative" className="btn-secondary"><ListChecks size={16} /> Liste déclarative</Link>} />
      <Loadable state={state}>
        {(d) => (
          <div className="space-y-4">
            {d.statutListe === 'NON_VALIDEE' && <InfoAlert tone="warning">La liste déclarative n’a pas encore été validée par le Directeur : aucun compte ne peut être créé.</InfoAlert>}
            {d.statutListe === 'A_REVALIDER' && <InfoAlert tone="warning">La liste déclarative a changé depuis sa dernière validation : les agents ajoutés ou modifiés seront enrôlables après sa revalidation par le Directeur.</InfoAlert>}
            {d.portee === 'SECRETARIAT_AUTORISE' && <InfoAlert>En tant qu’Admin Système, vous enrôlez uniquement les agents du Bureau Secrétariat de Direction que le Directeur a autorisés nominativement ({d.resume.enrolables} en attente). Une fois enrôlés, ce sont eux qui créent les comptes des agents des Divisions.</InfoAlert>}
            {d.portee === 'HORS_SECRETARIAT' && <InfoAlert>En tant que membre du Bureau Secrétariat de Direction, vous enrôlez les agents des Divisions et des autres Bureaux. Les comptes du Secrétariat sont créés par l’Admin.</InfoAlert>}
            <p className="text-xs text-slate-500">{d.resume.enrolables} agent(s) enrôlable(s) · {d.resume.avecCompte} compte(s) déjà créé(s){d.validation ? ` · liste validée le ${fmtDateTime(d.validation.valide_at)}` : ''}</p>
            <Stepper etape={agentId ? etape : 0} />
            {agentId
              ? <Assistant key={agentId} agentId={agentId} etape={etape} setEtape={setEtape} onCreated={setCreated} onAnnuler={() => select(null)} />
              : <Identification onSelect={select} />}
          </div>
        )}
      </Loadable>
      <TempPassword data={created} onClose={() => { setCreated(null); select(null); state.reload(); }} />
    </>
  );
}
