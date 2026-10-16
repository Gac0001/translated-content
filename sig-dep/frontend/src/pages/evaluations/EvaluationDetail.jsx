import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleAlert, FileDown, FileSpreadsheet, Pencil, Plus, RefreshCw, RotateCcw, Send, Signature, Undo2 } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { circuitEvaluation } from '../../lib/workflows';
import { NotePresentation, LettreTransmission } from './Redaction';
import {
  useApi, Loadable, PageHeader, Card, Badge, Button, KeyValues, SimpleTable, FormModal, Field, NumberInput, MoneyInput, KpiTile, Tabs,
  InfoAlert, StatusBadge, useOnglet, runAction, useConfirm, toast, WorkflowPanel,
} from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { fmtCdf, fmtDate, fmtNombre, fmtPourcent } from '../../lib/format';
import EvaluationForm from './EvaluationForm';

const NIVEAUX = { TOTAL: 'Total', PARTIEL: 'Partiel', NON_ENTAME: 'Non entamé' };
const ouiNon = (v) => (v === true ? 'Oui' : v === false ? 'Non' : '—');

/**
 * Colonnes de chaque annexe : type de saisie (texte, montant, entier, pourcent, niveau, oui_non) ;
 * `calc` : valeur recalculée par l’API (jamais saisie) ; `libelle` : colonne d’en-tête de ligne.
 */
function colonnes(annexe, projection) {
  if (annexe === 'I') {
    return [
      { key: 'action', label: 'Action ou projet', type: 'texte', libelle: true },
      { key: 'prevision', label: 'Prévision', type: 'montant' },
      { key: 'execution', label: 'Exécution financière', type: 'montant' },
      { key: 'taux', label: 'Taux d’exécution', calc: true, format: (v) => fmtPourcent(v) },
      { key: 'taux_physique', label: 'Exécution physique', type: 'pourcent' },
      { key: 'niveau_physique', label: 'Niveau physique', type: 'niveau' },
      { key: 'cible', label: 'Cible ou bénéficiaires', type: 'texte', long: true },
      { key: 'reconduction', label: 'Reconduction', type: 'oui_non' },
    ];
  }
  if (annexe === 'II') {
    return [
      { key: 'action', label: 'Action', type: 'texte', libelle: true },
      ...projection.map((a, i) => ({ key: `montant_${i + 1}`, label: String(a), type: 'montant' })),
      { key: 'total', label: 'Total', calc: true, format: (v) => fmtCdf(v, { suffixe: false }) },
      { key: 'etude_faisabilite', label: 'Étude de faisabilité', type: 'oui_non' },
      { key: 'objectif_pag', label: 'Objectif visé (PAG)', type: 'texte', long: true },
      { key: 'impact_environnemental', label: 'Impact environnemental', type: 'texte', long: true },
    ];
  }
  if (annexe === 'V') {
    return [
      { key: 'programme', label: 'Programme', type: 'texte', libelle: true },
      { key: 'dotation', label: 'Dotation annuelle', type: 'montant' },
      { key: 'engage', label: 'Engagé', type: 'montant' },
      { key: 'paye', label: 'Payé', type: 'montant' },
      { key: 'non_paye', label: 'Non payé', calc: true, format: (v) => fmtCdf(v, { suffixe: false }) },
      { key: 'pourcentage', label: 'Engagé / dotation', calc: true, format: (v) => fmtPourcent(v) },
      { key: 'observation', label: 'Observation', type: 'texte', long: true },
    ];
  }
  return [
    { key: 'grade', label: 'Grade', type: 'texte', libelle: true },
    { key: 'organique', label: 'Organique', type: 'entier' },
    { key: 'affecte', label: 'Affecté', type: 'entier' },
    { key: 'ecart', label: 'Écart', calc: true, format: (v) => (v > 0 ? `+${v}` : fmtNombre(v)) },
    { key: 'paye', label: 'Payé', type: 'entier' },
    { key: 'non_paye', label: 'Non payé', type: 'entier' },
  ];
}

function afficher(c, v) {
  if (c.format) return c.format(v);
  if (c.type === 'montant') return fmtCdf(v, { suffixe: false });
  if (c.type === 'pourcent') return fmtPourcent(v, 0);
  if (c.type === 'entier') return fmtNombre(v);
  if (c.type === 'niveau') return NIVEAUX[v] || '—';
  if (c.type === 'oui_non') return ouiNon(v);
  return v || '—';
}

/** Calculs recalculés à l’écran pendant la saisie (l’API les refait à l’enregistrement). */
function calculer(annexe, v) {
  const n = (x) => Number(x) || 0;
  const taux = (a, b) => (n(b) ? Math.round((n(a) / n(b)) * 1000) / 10 : null);
  if (annexe === 'I') return { taux: taux(v.execution, v.prevision) };
  if (annexe === 'II') return { total: n(v.montant_1) + n(v.montant_2) + n(v.montant_3) };
  if (annexe === 'V') return { non_paye: n(v.engage) - n(v.paye), pourcentage: taux(v.engage, v.dotation) };
  return { ecart: n(v.affecte) - n(v.organique) };
}

function Champ({ c, valeur, onChange, source }) {
  const hint = source !== undefined && source !== valeur ? `Repris du SIG-DEP : ${afficher(c, source)}` : undefined;
  let saisie;
  if (c.type === 'montant') saisie = <MoneyInput value={valeur ?? null} onChange={onChange} />;
  else if (c.type === 'entier') saisie = <NumberInput value={valeur ?? null} min={0} onChange={onChange} />;
  else if (c.type === 'pourcent') saisie = <NumberInput value={valeur ?? null} min={0} max={100} suffixe="%" onChange={onChange} />;
  else if (c.type === 'niveau') {
    saisie = (
      <select className="input" value={valeur || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— Non renseigné —</option>
        {Object.entries(NIVEAUX).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    );
  } else if (c.type === 'oui_non') {
    saisie = (
      <select className="input" value={valeur === true ? 'oui' : valeur === false ? 'non' : ''} onChange={(e) => onChange(e.target.value === 'oui' ? true : e.target.value === 'non' ? false : null)}>
        <option value="">— Non renseigné —</option><option value="oui">Oui</option><option value="non">Non</option>
      </select>
    );
  } else if (c.long) saisie = <textarea className="input" rows={2} value={valeur || ''} onChange={(e) => onChange(e.target.value)} />;
  else saisie = <input className="input" value={valeur || ''} onChange={(e) => onChange(e.target.value)} />;
  return <Field label={c.label} required={c.libelle} hint={hint}>{saisie}</Field>;
}

/** Saisie d’une ligne d’annexe : valeurs retenues, rappel des valeurs reprises, calculs en direct. */
function LigneForm({ evaluation, annexe, ligne, onClose, onDone }) {
  const cols = colonnes(annexe, evaluation.projection);
  const [v, setV] = useState(ligne ? { ...ligne.valeurs } : {});
  const libelle = cols.find((c) => c.libelle);
  const calc = calculer(annexe, v);
  const enregistrer = async () => {
    const valeurs = Object.fromEntries(cols.filter((c) => !c.calc).map((c) => [c.key, v[c.key] ?? null]));
    if (ligne) await runAction(() => api.put(`/evaluations/${evaluation.id}/lignes/${ligne.id}`, { valeurs }), 'Ligne enregistrée.');
    else await runAction(() => api.post(`/evaluations/${evaluation.id}/lignes`, { annexe, valeurs }), 'Ligne ajoutée.');
    onDone();
  };
  return (
    <FormModal open size="lg" title={ligne ? `Annexe ${annexe} — ${ligne.valeurs[libelle.key]}` : `Annexe ${annexe} — nouvelle ligne`} onClose={onClose} onSubmit={enregistrer}
      dirty disabled={!String(v[libelle.key] || '').trim()}>
      {ligne?.anomalies.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          {ligne.anomalies.map((a, i) => <li key={i} className={a.gravite === 'ERREUR' ? 'text-red-800' : 'text-amber-900'}>{a.gravite === 'ERREUR' ? 'Erreur' : 'Alerte'} : {a.message}</li>)}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {cols.filter((c) => !c.calc).map((c) => (
          <div key={c.key} className={c.long || c.libelle ? 'sm:col-span-2' : ''}>
            <Champ c={c} valeur={v[c.key]} source={ligne?.source ? ligne.source[c.key] : undefined} onChange={(x) => setV({ ...v, [c.key]: x })} />
          </div>
        ))}
      </div>
      <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Calculé : {cols.filter((c) => c.calc).map((c) => `${c.label} ${afficher(c, calc[c.key])}`).join(' · ')}
      </p>
    </FormModal>
  );
}

function Controle({ ligne }) {
  const erreurs = ligne.anomalies.filter((a) => a.gravite === 'ERREUR').length;
  const alertes = ligne.anomalies.length - erreurs + (ligne.source_absente ? 1 : 0);
  return (
    <span className="flex flex-wrap gap-1">
      {erreurs > 0 && <Badge tone="danger" title={ligne.anomalies.filter((a) => a.gravite === 'ERREUR').map((a) => a.message).join('\n')}><CircleAlert size={12} aria-hidden />{erreurs}<span className="sr-only"> erreur(s)</span></Badge>}
      {alertes > 0 && <Badge tone="attention" title={ligne.anomalies.filter((a) => a.gravite === 'ALERTE').map((a) => a.message).join('\n')}><AlertTriangle size={12} aria-hidden />{alertes}<span className="sr-only"> alerte(s)</span></Badge>}
      {ligne.ajoutee && <Badge tone="info">Ajoutée</Badge>}
      {ligne.source_absente && <Badge tone="neutre">Sans source</Badge>}
      {!erreurs && !alertes && !ligne.ajoutee && <Badge tone="succes">Conforme</Badge>}
    </span>
  );
}

function Annexe({ e, code, onEdit, reload }) {
  const a = e.annexes[code];
  const cols = colonnes(code, e.projection);
  const peut = e.droits.annexes[code];
  const confirm = useConfirm();
  const actualiser = async () => {
    if (!(await confirm({ title: 'Reprendre les données du SIG-DEP', message: 'Les valeurs non modifiées suivent les données actuelles ; les valeurs que vous avez modifiées sont conservées.', confirmLabel: 'Reprendre' }))) return;
    const { data: b } = await runAction(() => api.post(`/evaluations/${e.id}/annexes/${code}/actualiser`));
    toast.success(`Données reprises : ${b.ajoutees} ligne(s) ajoutée(s), ${b.actualisees} actualisée(s), ${b.absentes} sans source.`);
    reload();
  };
  const ecarter = async (l, exclue) => {
    await runAction(() => api.post(`/evaluations/${e.id}/lignes/${l.id}/ecarter`, { exclue }), exclue ? 'Ligne écartée de l’annexe.' : 'Ligne rétablie.');
    reload();
  };
  const supprimer = async (l) => {
    if (!(await confirm({ title: 'Supprimer la ligne', message: `Supprimer « ${l.valeurs[cols[0].key]} » ?`, danger: true, confirmLabel: 'Supprimer' }))) return;
    await runAction(() => api.delete(`/evaluations/${e.id}/lignes/${l.id}`), 'Ligne supprimée.');
    reload();
  };
  const cellule = (c) => (l) => {
    const v = c.calc ? l.calculs[c.key] : l.valeurs[c.key];
    const modifie = l.modifies.includes(c.key);
    return (
      <span className={`${c.long ? 'block min-w-[12rem] whitespace-normal' : 'whitespace-nowrap'} ${c.libelle ? 'font-medium' : ''} ${modifie ? 'rounded bg-amber-50 px-1 ring-1 ring-amber-300' : ''}`}
        title={modifie ? `Modifié — repris du SIG-DEP : ${afficher(c, l.source[c.key])}` : undefined}>
        {afficher(c, v)}{modifie && <span className="sr-only"> (modifié ; SIG-DEP : {afficher(c, l.source[c.key])})</span>}
      </span>
    );
  };
  const numerique = (c) => c.calc || ['montant', 'entier', 'pourcent'].includes(c.type);
  return (
    <div className="space-y-4">
      <Card title={a.titre} bodyClass="p-0" actions={peut && (
        <div className="flex flex-wrap gap-2">
          <Button icon={RefreshCw} onClick={actualiser}>Reprendre du SIG-DEP</Button>
          <Button icon={Plus} onClick={() => onEdit(code, null)}>Ajouter une ligne</Button>
        </div>
      )}>
        <SimpleTable label={a.titre} dense figee rows={a.lignes} empty="Aucune ligne : reprenez les données du SIG-DEP ou ajoutez une ligne."
          onRowClick={peut ? (l) => onEdit(code, l) : undefined}
          footer={a.lignes.length ? [{ id: 'total', valeurs: { [cols[0].key]: 'Total', ...a.totaux }, calculs: a.totaux, total: true }] : []}
          columns={[
            ...cols.map((c) => ({
              key: c.key, header: c.label, align: numerique(c) ? 'right' : undefined,
              render: (l) => (l.total ? (c.libelle ? 'Total' : (numerique(c) && (c.calc ? l.calculs[c.key] !== undefined : l.valeurs[c.key] !== undefined) ? afficher(c, c.calc ? l.calculs[c.key] : l.valeurs[c.key]) : '')) : cellule(c)(l)),
            })),
            { key: 'controle', header: 'Contrôle', render: (l) => (l.total ? null : <Controle ligne={l} />) },
          ]} />
        <p className="border-t px-3 py-2 text-xs text-slate-600">
          Taux, totaux, écarts et montants non payés sont recalculés par le SIG-DEP. Cellule encadrée : valeur modifiée par rapport aux données reprises (survol : valeur d’origine).
          {code === 'III' || code === 'IV' ? ' Payé et non payé : d’après les états de la Direction des Ressources Humaines, joints au dossier.' : ''}
          {peut ? ' Cliquez sur une ligne pour la compléter.' : ''}
        </p>
      </Card>
      {a.ecartees.length > 0 && (
        <Card title={`Lignes écartées (${a.ecartees.length})`} bodyClass="p-0">
          <SimpleTable label="Lignes écartées" dense rows={a.ecartees}
            columns={[
              { key: 'libelle', header: cols[0].label, render: (l) => l.valeurs[cols[0].key] },
              { key: 'x', header: '', render: (l) => (peut ? <Button size="sm" icon={RotateCcw} onClick={() => ecarter(l, false)}>Rétablir</Button> : null) },
            ]} />
        </Card>
      )}
      {peut && a.lignes.some((l) => !l.ajoutee) && (
        <details className="rounded border border-slate-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Écarter ou supprimer une ligne</summary>
          <ul className="mt-2 space-y-1">
            {a.lignes.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span>{l.valeurs[cols[0].key]}</span>
                {l.ajoutee
                  ? <Button size="sm" variant="danger" onClick={() => supprimer(l)}>Supprimer</Button>
                  : <Button size="sm" onClick={() => ecarter(l, true)}>Écarter</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Dossier d’évaluation des politiques sectorielles et budgétaires (cahier, §§ 34 et 51) :
 * synthèse des contrôles, pièces (convocation, états de la DRH), annexes I à V.
 */
function attente(e) {
  return {
    PREPARATION: 'En préparation au Bureau Suivi-Évaluation.', A_CORRIGER: 'Retourné au Bureau Suivi-Évaluation pour correction.',
    SOUMIS: 'En attente de vérification par le Chef de la Division Programme et Suivi.', VERIFIE: 'En attente de validation et de signature de la lettre par le Directeur.',
    VALIDE: `Lettre ${e.numero_lettre} signée : dossier à transmettre au Secrétaire Général par le Directeur ou le Secrétariat de Direction.`,
    TRANSMIS: `Transmis au Secrétaire Général le ${fmtDate(e.transmis_at)} (lettre ${e.numero_lettre}) : dossier archivé, projections reportées dans le CDS-MT.`,
  }[e.statut];
}

export default function EvaluationDetail() {
  const { id } = useParams();
  const state = useApi(`/evaluations/${id}`, [id]);
  const [onglet, choisir] = useOnglet('synthese', { valeurs: ['synthese', 'note', 'lettre', 'I', 'II', 'III', 'IV', 'V'] });
  const [edition, setEdition] = useState(null);
  const [entete, setEntete] = useState(false);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const etape = async (chemin, message, opts) => {
    let body;
    if (opts) {
      const r = await confirm(opts);
      if (!r) return;
      if (typeof r === 'string') body = { motif: r };
    }
    await runAction(() => api.post(`/evaluations/${id}/${chemin}`, body), message).then(() => state.reload()).catch(() => {});
  };
  const telecharger = (chemin, nom) => download(`/evaluations/${id}/${chemin}`, nom).catch((x) => toast.error(errorMessage(x)));
  return (
    <Loadable state={state}>
      {(e) => {
        const parAnnexe = (code) => e.anomalies.filter((a) => a.annexe === code && a.gravite === 'ERREUR').length;
        const ouvrir = (code, ligneId) => {
          choisir(code);
          const l = e.annexes[code].lignes.find((x) => x.id === ligneId);
          if (l && e.droits.annexes[code]) setEdition({ code, ligne: l });
        };
        const modifierEntete = async (corps) => { await runAction(() => api.put(`/evaluations/${e.id}`, corps), 'Dossier modifié.'); setEntete(false); state.reload(); };
        return (
          <>
            <PageHeader title={`Évaluation des politiques ${e.annee}`}
              subtitle={<span className="flex flex-wrap items-center gap-2">{e.reference}<StatusBadge value={e.statut} /></span>}
              breadcrumb={[{ label: 'Évaluation des politiques', to: '/evaluations' }, { label: String(e.annee) }]}
              menu={[
                e.droits.modifier && { label: 'Convocation et projection', icon: Pencil, onClick: () => setEntete(true) },
                can('exports.generer') && { label: 'Dossier complet (PDF)', icon: FileDown, onClick: () => telecharger('export/pdf', `evaluation-${e.annee}.pdf`) },
                can('exports.generer') && { label: 'Annexes (Excel)', icon: FileSpreadsheet, onClick: () => telecharger('export/xlsx', `evaluation-${e.annee}-annexes.xlsx`) },
                can('exports.generer') && { label: e.numero_lettre ? 'Lettre de transmission (PDF)' : 'Projet de lettre (PDF)', icon: FileDown, onClick: () => telecharger('lettre/pdf', `lettre-transmission-${e.annee}.pdf`) },
              ]} />
            <WorkflowPanel circuit={circuitEvaluation(e)} attente={attente(e)}
              message={<>
                {e.statut === 'A_CORRIGER' && <InfoAlert tone="warning"><b>À corriger</b> : {e.observations}</InfoAlert>}
                {e.droits.soumettre && e.bloquants.length > 0 && (
                  <InfoAlert tone="warning"><b>Avant de soumettre</b> : <ul className="ml-4 list-disc">{e.bloquants.map((b) => <li key={b}>{b}</li>)}</ul></InfoAlert>
                )}
              </>}
              actions={[
                e.droits.soumettre && <Button key="so" variant="primary" icon={Send} disabled={e.bloquants.length > 0} onClick={() => etape('soumettre', 'Dossier soumis au Chef de la Division Programme et Suivi.')}>Soumettre</Button>,
                e.droits.verifier && <Button key="ve" variant="success" icon={CheckCircle2} onClick={() => etape('verifier', 'Dossier vérifié : transmis au Directeur.')}>Vérifié</Button>,
                e.droits.valider && <Button key="va" variant="success" icon={Signature} onClick={() => etape('valider', 'Dossier validé : la lettre de transmission est signée et numérotée.', { title: `Valider l’évaluation ${e.annee}`, message: 'La lettre de transmission recevra son numéro officiel ; le dossier deviendra intangible.', confirmLabel: 'Valider et signer' })}>Valider et signer</Button>,
                e.droits.retourner && <Button key="re" icon={Undo2} onClick={() => etape('retourner', 'Dossier retourné au Bureau Suivi-Évaluation.', { title: 'Retourner pour correction', message: 'Le dossier sera renvoyé au Bureau Suivi-Évaluation.', input: { label: 'Corrections demandées', required: true, min: 5 }, confirmLabel: 'Retourner', danger: true })}>Retourner</Button>,
                e.droits.transmettre && <Button key="tr" variant="primary" icon={Send} onClick={() => etape('transmettre', 'Dossier transmis au Secrétaire Général ; projections reportées dans le CDS-MT.', { title: 'Transmettre au Secrétaire Général', message: `Le dossier sera transmis avec la lettre ${e.numero_lettre}, archivé, et ses projections reportées dans le CDS-MT.`, confirmLabel: 'Transmettre' })}>Transmettre au SG</Button>,
              ]} />
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Erreurs à corriger" valeur={String(e.controle.erreurs)} tone={e.controle.erreurs ? 'rouge' : 'vert'} />
              <KpiTile label="Alertes à justifier" valeur={String(e.controle.alertes)} tone={e.controle.alertes ? 'jaune' : 'vert'} />
              <KpiTile label="Taux d’exécution (annexe I)" valeur={fmtPourcent(e.annexes.I.totaux.taux)} />
              <KpiTile label="Échéance" valeur={e.date_limite ? fmtDate(e.date_limite) : '—'} tone="gris" />
            </div>
            <Tabs label="Parties du dossier" value={onglet} onChange={choisir} compact={3}
              tabs={[{ value: 'synthese', label: 'Synthèse et contrôle' }, { value: 'note', label: 'Note de présentation' }, ...['I', 'II', 'III', 'IV', 'V'].map((c) => ({ value: c, label: `Annexe ${c}`, count: parAnnexe(c) })), { value: 'lettre', label: 'Lettre de transmission' }]} />
            {onglet === 'note' ? <NotePresentation key={`note-${e.updated_at}`} e={e} onSaved={state.reload} />
              : onglet === 'lettre' ? <LettreTransmission key={`lettre-${e.updated_at}`} e={e} onSaved={state.reload} />
                : onglet === 'synthese' ? (
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                  <Card title="Contrôle du dossier" bodyClass="p-0">
                    {e.anomalies.length ? (
                      <SimpleTable label="Anomalies du dossier" dense rowKey="cle" rows={e.anomalies.map((a, i) => ({ ...a, cle: i }))}
                        onRowClick={(a) => ouvrir(a.annexe, a.ligne_id)}
                        columns={[
                          { key: 'annexe', header: 'Annexe', render: (a) => <span className="whitespace-nowrap">Annexe {a.annexe}</span> },
                          { key: 'gravite', header: 'Gravité', render: (a) => <Badge tone={a.gravite === 'ERREUR' ? 'danger' : 'attention'}>{a.gravite === 'ERREUR' ? 'Erreur' : 'Alerte'}</Badge> },
                          { key: 'libelle', header: 'Ligne', render: (a) => a.libelle || '—' },
                          { key: 'message', header: 'Anomalie', render: (a) => <span className="block min-w-[16rem] whitespace-normal">{a.message}</span> },
                        ]} />
                    ) : <div className="p-4"><InfoAlert>Aucune anomalie : les taux et totaux sont cohérents.</InfoAlert></div>}
                  </Card>
                  <Card title="Synthèse des annexes" bodyClass="p-0">
                    <SimpleTable label="Synthèse des annexes" dense rowKey="code" rows={Object.values(e.annexes)} onRowClick={(a) => choisir(a.code)}
                      columns={[
                        { key: 'titre', header: 'Annexe' },
                        { key: 'lignes', header: 'Lignes', align: 'right', render: (a) => a.lignes.length },
                        { key: 'resume', header: 'Totaux', render: (a) => (
                          <span className="text-xs">{
                            a.code === 'I' ? `Prévision ${fmtCdf(a.totaux.prevision)} · exécution ${fmtCdf(a.totaux.execution)} (${fmtPourcent(a.totaux.taux)})`
                              : a.code === 'II' ? `${e.projection.join(', ')} : ${fmtCdf(a.totaux.total)}`
                                : a.code === 'V' ? `Dotation ${fmtCdf(a.totaux.dotation)} · engagé ${fmtCdf(a.totaux.engage)} · payé ${fmtCdf(a.totaux.paye)}`
                                  : `Organique ${a.totaux.organique} · affecté ${a.totaux.affecte} · payé ${a.totaux.paye} · non payé ${a.totaux.non_paye}`
                          }</span>
                        ) },
                      ]} />
                  </Card>
                </div>
                <div className="space-y-4">
                  <Card title="Convocation">
                    <KeyValues cols={1} items={[
                      ['Référence', e.convocation_reference], ['Date', fmtDate(e.convocation_date)], ['Échéance', fmtDate(e.date_limite)],
                      ['Projection (annexe II)', `${e.projection[0]} à ${e.projection[2]}`],
                    ]} />
                  </Card>
                  <Card title="Pièces du dossier"><p className="mb-2 text-xs text-slate-600">Convocation du Ministère du Budget et états de la Direction des Ressources Humaines (primes et salaires).</p><Attachments type="EVALUATION" id={e.id} canUpload={e.droits.pieces} /></Card>
                  <Card title="Historique"><Timeline items={e.historique} /></Card>
                </div>
              </div>
            ) : <Annexe e={e} code={onglet} reload={state.reload} onEdit={(code, ligne) => setEdition({ code, ligne })} />}
            {edition && <LigneForm evaluation={e} annexe={edition.code} ligne={edition.ligne} onClose={() => setEdition(null)} onDone={() => { setEdition(null); state.reload(); }} />}
            {entete && (
              <EvaluationForm initial={{ annee: e.annee, convocation_reference: e.convocation_reference, convocation_date: e.convocation_date, date_limite: e.date_limite || '', annee_projection: e.annee_projection }}
                onClose={() => setEntete(false)} onSubmit={({ annee: _a, ...corps }) => modifierEntete(corps)} />
            )}
          </>
        );
      }}
    </Loadable>
  );
}
