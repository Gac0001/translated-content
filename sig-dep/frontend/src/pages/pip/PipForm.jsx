import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, Spinner, InfoAlert } from '../../components/ui';
import { DynamicField } from '../../components/shared';
import { fmtMontant } from '../../lib/format';

function isFilled(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

export default function PipForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const modele = useApi('/pip/modele');
  const existing = useApi(id ? `/pip/${id}` : null);
  const [data, setData] = useState({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (existing.data) setData(existing.data.donnees || {}); }, [existing.data]);
  const sections = modele.data?.sections || [];
  useEffect(() => {
    if (!id && sections.length && !data.identification) {
      const init = {};
      for (const s of sections) { init[s.key] = {}; for (const f of s.fields) if (f.default) init[s.key][f.key] = f.default; }
      setData(init);
    }
  }, [sections, id, data.identification]);
  const set = (sk, fk, v) => setData((d) => ({ ...d, [sk]: { ...(d[sk] || {}), [fk]: v } }));
  const cout = useMemo(() => (data.cout?.couts || []).reduce((s, r) => s + (Number(r.total) || (Number(r.annee1) || 0) + (Number(r.annee2) || 0) + (Number(r.annee3) || 0)), 0), [data]);
  const completude = (s) => { const req = s.fields.filter((f) => f.required); const ok = req.filter((f) => isFilled(data[s.key]?.[f.key])).length; return [ok, req.length]; };
  const save = async () => {
    setSaving(true);
    try {
      const r = await runAction(() => (id ? api.put(`/pip/${id}`, { donnees: data }) : api.post('/pip', { donnees: data })), id ? 'Nouvelle version enregistrée.' : 'Fiche PIP créée.');
      navigate(`/pip/${r.data.id}`);
    } catch { /* message affiché */ } finally { setSaving(false); }
  };
  if (modele.loading || (id && existing.loading)) return <Spinner />;
  const s = sections[step];
  return (
    <>
      <PageHeader title={id ? 'Modifier la fiche PIP' : 'Nouvelle fiche de projet PIP'} subtitle="Formulaire guidé conforme au modèle de fiche projet du Ministère du Plan." breadcrumb={[{ label: 'Projets PIP', to: '/pip' }, { label: id ? 'Modification' : 'Nouvelle fiche' }]} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="card h-max p-2 lg:sticky lg:top-20" aria-label="Sections de la fiche">
          <ol className="space-y-0.5">
            {sections.map((x, i) => {
              const [ok, total] = completude(x);
              return (
                <li key={x.key}>
                  <button type="button" onClick={() => setStep(i)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === step ? 'bg-dep-50 font-medium text-dep-800' : 'hover:bg-slate-50'}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${total && ok === total ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{x.numero}</span>
                    <span className="flex-1 truncate">{x.label}</span>
                    {total > 0 && <span className="text-[11px] text-slate-500">{ok}/{total}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 border-t px-2 pt-2 text-xs text-slate-600">Coût total calculé : <b>{fmtMontant(cout, data.cout?.devise || 'USD')}</b></div>
        </nav>
        <div className="space-y-4">
          {s && (
            <Card title={`${s.numero}. ${s.label}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <Field key={f.key} label={f.label} required={f.required} className={['textarea', 'list', 'table'].includes(f.type) ? 'sm:col-span-2' : ''}>
                    <DynamicField field={f} value={data[s.key]?.[f.key]} onChange={(v) => set(s.key, f.key, v)} />
                  </Field>
                ))}
              </div>
            </Card>
          )}
          <InfoAlert>Vous pouvez enregistrer à tout moment. Toutes les rubriques obligatoires doivent être renseignées avant la soumission pour vérification.</InfoAlert>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><ChevronLeft size={16} /> Précédent</button>
            <button type="button" className="btn-secondary" disabled={step >= sections.length - 1} onClick={() => setStep(step + 1)}>Suivant <ChevronRight size={16} /></button>
            <button type="button" className="btn-primary ml-auto" disabled={saving || !isFilled(data.identification?.intitule)} onClick={save}><Save size={16} /> Enregistrer</button>
          </div>
        </div>
      </div>
    </>
  );
}
