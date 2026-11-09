import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, Spinner, UnsavedChangesGuard } from '../../components/ui';
import { FormulaireEtapes, PageControle } from '../../components/FormulaireEtapes';
import { DynamicField } from '../../components/shared';
import { fmtCdf } from '../../lib/format';

function isFilled(v) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}
const somme = (lignes, cles) => (lignes || []).reduce((t, r) => t + cles.reduce((u, k) => u + (Number(r[k]) || 0), 0), 0);
const annee = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);

/** Durée en mois entre deux dates (fin incluse au mois près), comme le calcule l’API. */
function duree(debut, fin) {
  if (!debut || !fin) return null;
  const [a1, m1] = debut.split('-').map(Number); const [a2, m2] = fin.split('-').map(Number);
  const n = (a2 - a1) * 12 + (m2 - m1) + 1;
  return n > 0 ? n : null;
}

/** Fiche de projet PIP au modèle du Ministère du Plan : formulaire guidé en huit étapes. */
export default function PipForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const modele = useApi('/pip/modele');
  const existing = useApi(id ? `/pip/${id}` : null);
  const [data, setData] = useState(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [modifie, setModifie] = useState(false);
  useEffect(() => { if (existing.data) setData(existing.data.donnees || {}); }, [existing.data]);
  useEffect(() => { if (!id && modele.data && !data) setData(modele.data.vide); }, [id, modele.data, data]);
  const sections = useMemo(() => modele.data?.sections || [], [modele.data]);
  const sugg = modele.data?.suggestions || {};
  const d = data || {};
  const set = (sk, fk, v) => {
    setData((x) => {
      const n = { ...x, [sk]: { ...(x[sk] || {}), [fk]: v } };
      if (sk === 'calendrier' && ['date_debut', 'date_fin'].includes(fk)) n.calendrier.duree_mois = duree(n.calendrier.date_debut, n.calendrier.date_fin);
      return n;
    });
    setModifie(true);
  };
  const f = d.financier || {};
  const cout = somme(f.couts, ['annee1', 'annee2', 'annee3', 'annee4']);
  const financement = somme(f.financement, ['annee1', 'annee2', 'annee3', 'autres']);
  const a0 = annee(d.calendrier?.date_debut); const aFin = annee(d.calendrier?.date_fin);
  /** En-têtes « Année n » remplacés par les années réelles. */
  const libelles = (s, fd) => {
    const base = fd.key === 'recurrents' ? (aFin ? aFin + 1 : null) : a0;
    if (!base) return {};
    return Object.fromEntries(fd.columns.filter((c) => /^annee\d$/.test(c.key)).map((c) => [c.key, String(base + Number(c.key.slice(5)) - 1)]));
  };
  /** Suggestions d’une rubrique ; pour un niveau du PNSD ou de la stratégie, filtrées par le niveau supérieur choisi. */
  const suggestions = (s, fd) => {
    const liste = sugg[fd.suggestions];
    if (!liste) return null;
    if (typeof liste[0] === 'string') return liste;
    const parent = fd.parent ? d[s.key]?.[fd.parent] : null;
    const filtre = parent && liste.some((x) => x.parent === parent) ? liste.filter((x) => x.parent === parent) : liste;
    return [...new Set(filtre.map((x) => x.libelle))];
  };
  const requis = (s, fd) => fd.required || (fd.key === 'etudes' && d.identification?.etape === 'Sélection');
  const completude = (s) => { const req = s.fields.filter((fd) => requis(s, fd)); const ok = req.filter((fd) => isFilled(d[s.key]?.[fd.key])).length; return [ok, req.length]; };
  const save = async () => {
    setSaving(true);
    try {
      const r = await runAction(() => (id ? api.put(`/pip/${id}`, { donnees: data }) : api.post('/pip', { donnees: data })), id ? 'Nouvelle version enregistrée.' : 'Fiche PIP créée.');
      setModifie(false);
      navigate(`/pip/${r.data.id}`);
    } catch { /* message affiché */ } finally { setSaving(false); }
  };
  if (modele.loading || (id && existing.loading) || !data) return <Spinner />;
  const s = sections[step];
  const controle = step === sections.length;
  const ecart = Math.round(cout - financement);
  const manquantes = sections.flatMap((x, i) => x.fields.filter((fd) => requis(x, fd) && !isFilled(d[x.key]?.[fd.key])).map((fd) => ({ etape: i, label: `${x.label} — ${fd.label}` })));
  const incoherences = [
    ...(ecart !== 0 && (cout > 0 || financement > 0) ? [{ bloquant: true, message: `Le plan de financement (${fmtCdf(financement)}) ne couvre pas exactement le coût du projet (${fmtCdf(cout)}).` }] : []),
    ...(d.calendrier?.date_debut && d.calendrier?.date_fin && d.calendrier.date_fin < d.calendrier.date_debut ? [{ bloquant: true, message: 'La date de fin prévue précède la date de début.' }] : []),
    ...(Number(d.institutionnel?.emplois_femmes) > Number(d.institutionnel?.emplois ?? Infinity) ? [{ bloquant: true, message: 'Le nombre d’emplois occupés par des femmes dépasse le nombre d’emplois créés.' }] : []),
  ];
  const etapes = [
    ...sections.map((x) => { const [ok, total] = completude(x); return { key: x.key, numero: x.numero, label: x.label, ok, total }; }),
    { key: 'controle', numero: sections.length + 1, label: 'Contrôle', ok: 0, total: 0, alerte: manquantes.length > 0 || incoherences.some((x) => x.bloquant) },
  ];
  return (
    <>
      <UnsavedChangesGuard when={modifie && !saving} />
      <PageHeader title={id ? 'Modifier la fiche PIP' : 'Nouvelle fiche de projet PIP'} subtitle="Modèle de fiche de projet du Ministère du Plan (Direction de la Programmation et Budgétisation) ; montants en francs congolais." breadcrumb={[{ label: 'Projets PIP', to: '/pip' }, { label: id ? 'Modification' : 'Nouvelle fiche' }]} />
      <FormulaireEtapes etapes={etapes} etape={step} onEtape={setStep} navigation="Étapes de la fiche"
        onEnregistrer={save} enregistrement={saving} peutEnregistrer={isFilled(d.identification?.libelle)}
        aide="Vous pouvez enregistrer à tout moment. Avant la soumission, toutes les rubriques obligatoires doivent être renseignées et le plan de financement doit couvrir exactement le coût du projet."
        resume={(
          <dl className="space-y-1">
            <div className="flex justify-between gap-2"><dt>Coût du projet</dt><dd className="font-semibold tabular-nums text-slate-800">{fmtCdf(cout)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Financement</dt><dd className="font-semibold tabular-nums text-slate-800">{fmtCdf(financement)}</dd></div>
            {ecart !== 0 && (cout > 0 || financement > 0) && <div className="rounded bg-amber-50 px-1.5 py-1 text-amber-800" role="status">Écart à résorber : {fmtCdf(Math.abs(ecart))} {ecart > 0 ? 'non financés' : 'de financement en trop'}</div>}
          </dl>
        )}>
        {s && !controle && (
          <Card title={`${s.numero}. ${s.label}`}>
            <div className="grid gap-4 sm:grid-cols-2">
              {s.fields.map((fd) => (
                <Field key={fd.key} label={fd.label} required={requis(s, fd)} hint={fd.help} className={['textarea', 'list', 'table'].includes(fd.type) ? 'sm:col-span-2' : ''}>
                  <DynamicField field={fd} value={d[s.key]?.[fd.key]} onChange={(v) => set(s.key, fd.key, v)} suggestions={suggestions(s, fd)} libelles={fd.type === 'table' ? libelles(s, fd) : undefined} />
                </Field>
              ))}
            </div>
          </Card>
        )}
        {controle && (
          <Card title={`${sections.length + 1}. Contrôle`}>
            <PageControle manquantes={manquantes} incoherences={incoherences} etapes={etapes} onAller={setStep} />
          </Card>
        )}
      </FormulaireEtapes>
    </>
  );
}
