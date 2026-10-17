import { useState } from 'react';
import { FileDown, Pencil, Sparkles } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { Card, Field, Button, KeyValues, UnsavedChangesGuard, runAction, toast } from '../../components/ui';
import { FormulaireEtapes, PageControle, renseigne } from '../../components/FormulaireEtapes';

const Texte = ({ t }) => (t ? <p className="whitespace-pre-line text-sm">{t}</p> : <p className="text-sm italic text-slate-600">Non rédigé.</p>);

/**
 * Note de présentation du dossier (contexte, présentation du Ministère, résumé, perspectives,
 * attentes), rédigée par étapes ; le résumé chiffré proposé à partir des annexes peut être repris.
 */
export function NotePresentation({ e, onSaved }) {
  const [edition, setEdition] = useState(false);
  const [initial] = useState(() => Object.fromEntries(e.rubriques.map(([k]) => [k, e.note?.[k] || ''])));
  const [n, setN] = useState(initial);
  const [etape, setEtape] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const modifie = JSON.stringify(n) !== JSON.stringify(initial);
  if (!edition) {
    return (
      <Card title="Note de présentation" actions={e.droits.modifier && <Button icon={Pencil} onClick={() => setEdition(true)}>Rédiger</Button>}>
        <div className="space-y-4">
          {e.rubriques.map(([k, l], i) => <section key={k}><h3 className="mb-1 text-sm font-semibold text-dep-800">{i + 1}. {l}</h3><Texte t={e.note?.[k]} /></section>)}
        </div>
      </Card>
    );
  }
  const etapes = [
    ...e.rubriques.map(([k, l], i) => ({ key: k, numero: i + 1, label: l, ok: renseigne(n[k]) ? 1 : 0, total: 1 })),
    { key: 'controle', numero: e.rubriques.length + 1, label: 'Contrôle', ok: 0, total: 0 },
  ];
  const courante = e.rubriques[etape];
  const enregistrer = async () => {
    setEnCours(true);
    try { await runAction(() => api.put(`/evaluations/${e.id}/note`, n), 'Note de présentation enregistrée.'); setEdition(false); onSaved(); } catch { /* message affiché */ } finally { setEnCours(false); }
  };
  return (
    <>
      <UnsavedChangesGuard when={modifie && !enCours} />
      <FormulaireEtapes etapes={etapes} etape={etape} onEtape={setEtape} navigation="Rubriques de la note de présentation"
        onEnregistrer={enregistrer} enregistrement={enCours} onAnnuler={() => setEdition(false)} libelleEnregistrer="Enregistrer la note"
        resume={`${etapes.reduce((t, x) => t + x.ok, 0)} rubrique(s) rédigée(s) sur ${e.rubriques.length}.`}>
        {courante ? (
          <Card title={`${etape + 1}. ${courante[1]}`} actions={courante[0] === 'resume' && (
            <Button icon={Sparkles} onClick={() => setN({ ...n, resume: e.resume_propose })}>Reprendre le résumé chiffré</Button>
          )}>
            <Field label={courante[1]} hint={courante[0] === 'resume' ? 'Le résumé proposé reprend les totaux des annexes ; il peut être complété.' : undefined}>
              <textarea className="input" rows={courante[0] === 'resume' ? 12 : 9} value={n[courante[0]]} onChange={(ev) => setN({ ...n, [courante[0]]: ev.target.value })} />
            </Field>
          </Card>
        ) : (
          <Card title={`${etapes.length}. Contrôle`}>
            <PageControle manquantes={e.rubriques.map(([k, l], i) => ({ etape: i, label: l, k })).filter((m) => !renseigne(n[m.k]))} etapes={etapes} onAller={setEtape}
              incoherences={e.bloquants.filter((b) => !/^Note de présentation/.test(b)).map((b) => ({ bloquant: true, message: b }))} />
          </Card>
        )}
      </FormulaireEtapes>
    </>
  );
}

const CHAMPS_LETTRE = [
  ['Destinataire et objet', [['destinataire', 'Destinataire', true], ['adresse', 'Adresse'], ['objet', 'Objet', true], ['references', 'Références']]],
  ['Corps de la lettre', [['formule_appel', 'Formule d’appel'], ['corps', 'Corps de la lettre', true, true], ['formule_finale', 'Formule finale']]],
  ['Signature, pièces et copies', [['signataire_nom', 'Nom du signataire (sinon : le Directeur qui signe)'], ['pieces', 'Pièces transmises (une par ligne)', false, true, true], ['copies', 'Copies pour information (une par ligne)', false, true, true]]],
];

/**
 * Lettre de transmission au Secrétaire Général : préparée avec le dossier, signée par le Directeur
 * à la validation, qui lui attribue son numéro officiel (séquence de la correspondance).
 */
export function LettreTransmission({ e, onSaved }) {
  const [edition, setEdition] = useState(false);
  const [initial] = useState(() => ({ ...e.lettre }));
  const [l, setL] = useState(initial);
  const [etape, setEtape] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const modifie = JSON.stringify(l) !== JSON.stringify(initial);
  const apercu = () => download(`/evaluations/${e.id}/lettre/pdf`, `lettre-transmission-${e.annee}.pdf`).catch((x) => toast.error(errorMessage(x)));
  if (!edition) {
    return (
      <Card title={e.numero_lettre ? `Lettre de transmission ${e.numero_lettre}` : 'Lettre de transmission (projet)'}
        actions={<div className="flex flex-wrap gap-2">
          {e.droits.modifier && <Button icon={Pencil} onClick={() => setEdition(true)}>Préparer</Button>}
          <Button icon={FileDown} onClick={apercu}>{e.numero_lettre ? 'Lettre signée (PDF)' : 'Aperçu (PDF)'}</Button>
        </div>}>
        <KeyValues cols={1} items={[
          ['Numéro', e.numero_lettre || 'Attribué à la signature du Directeur'], ['Destinataire', [e.lettre.destinataire, e.lettre.adresse].filter(Boolean).join(', ')],
          ['Objet', e.lettre.objet], ['Références', e.lettre.references],
        ]} />
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
          {e.lettre.formule_appel && <p className="mb-2 text-sm">{e.lettre.formule_appel}</p>}
          <Texte t={e.lettre.corps} />
          {e.lettre.formule_finale && <p className="mt-2 text-sm">{e.lettre.formule_finale}</p>}
        </div>
        <p className="mt-3 text-sm font-medium">Pièces transmises</p>
        <ol className="ml-5 list-decimal text-sm">{(e.lettre.pieces || []).map((p) => <li key={p}>{p}</li>)}</ol>
        {(e.lettre.copies || []).length > 0 && <><p className="mt-2 text-sm font-medium">Copies pour information</p><ol className="ml-5 list-decimal text-sm">{e.lettre.copies.map((p) => <li key={p}>{p}</li>)}</ol></>}
      </Card>
    );
  }
  const valeur = (k, liste) => (liste ? (l[k] || []).join('\n') : l[k] || '');
  const changer = (k, liste) => (ev) => setL({ ...l, [k]: liste ? ev.target.value.split('\n').map((x) => x.trimStart()) : ev.target.value });
  const etapes = CHAMPS_LETTRE.map(([label, champs], i) => {
    const obligatoires = champs.filter((c) => c[2]);
    return { key: label, numero: i + 1, label, ok: obligatoires.filter(([k]) => renseigne(l[k])).length, total: obligatoires.length };
  });
  const enregistrer = async () => {
    setEnCours(true);
    const corps = { ...l, pieces: (l.pieces || []).map((x) => x.trim()).filter(Boolean), copies: (l.copies || []).map((x) => x.trim()).filter(Boolean) };
    try { await runAction(() => api.put(`/evaluations/${e.id}/lettre`, corps), 'Lettre de transmission enregistrée.'); setEdition(false); onSaved(); } catch { /* message affiché */ } finally { setEnCours(false); }
  };
  const [, champs] = CHAMPS_LETTRE[etape];
  return (
    <>
      <UnsavedChangesGuard when={modifie && !enCours} />
      <FormulaireEtapes etapes={etapes} etape={etape} onEtape={setEtape} navigation="Étapes de la lettre de transmission"
        onEnregistrer={enregistrer} enregistrement={enCours} onAnnuler={() => setEdition(false)} libelleEnregistrer="Enregistrer la lettre"
        peutEnregistrer={['destinataire', 'objet', 'corps'].every((k) => renseigne(l[k]))}
        aide="Le numéro officiel et la date sont attribués à la signature du Directeur, lors de la validation du dossier.">
        <Card title={`${etape + 1}. ${CHAMPS_LETTRE[etape][0]}`}>
          <div className="space-y-3">
            {champs.map(([k, label, requis, long, liste]) => (
              <Field key={k} label={label} required={requis}>
                {long ? <textarea className="input" rows={liste ? 5 : 10} value={valeur(k, liste)} onChange={changer(k, liste)} /> : <input className="input" value={valeur(k)} onChange={changer(k)} />}
              </Field>
            ))}
          </div>
        </Card>
      </FormulaireEtapes>
    </>
  );
}
