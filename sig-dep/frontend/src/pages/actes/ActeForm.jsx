import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Field, InfoAlert, ActionBar, runAction, toast } from '../../components/ui';

const VIDE = { type: 'INTERIM', reference: '', date_acte: '', autorite: '', objet: '', motif: '', agent_id: '', poste_id: '', grade_id: '', permissions: [], date_debut: '', date_fin: '' };
const PERMANENTS = ['NOMINATION', 'AFFECTATION', 'FIN_FONCTION', 'ELEVATION_GRADE'];
const COMMANDEMENT = ['DIRECTEUR', 'CHEF_DIVISION', 'CHEF_BUREAU'];
const AIDE = {
  INTERIM: 'Désigne un intérimaire sur un poste de commandement pour une période déterminée. Il exerce le rôle du poste dans son seul périmètre ; le titulaire est suspendu de ce rôle pendant la période. Le grade permanent de l’intérimaire n’est pas modifié.',
  DESIGNATION: 'Accorde temporairement des opérations administratives désignables à une personne (ex. enregistrement du courrier). Les droits expirent d’eux-mêmes à la date de fin.',
  NOMINATION: 'Nomme le titulaire d’un poste de commandement vacant ; l’agent doit avoir le grade requis par le poste. À la date d’effet : l’intérim en cours sur le poste prend fin, l’agent reçoit l’affectation, la fonction et le rôle du poste ; lui, son nouveau supérieur et le Directeur sont notifiés.',
  AFFECTATION: 'Affecte un agent sur un poste d’exécution. À la date d’effet : l’affectation précédente est clôturée, la nouvelle est ouverte et un éventuel rôle de commandement cesse.',
  FIN_FONCTION: 'Met fin à la fonction du titulaire d’un poste de commandement. À la date d’effet : l’agent reste dans la structure comme agent, son grade est conservé ; le poste devient vacant.',
  ELEVATION_GRADE: 'Élève un agent à un grade supérieur. À la date d’effet, le nouveau grade s’applique et l’ancien est conservé à l’historique ; la fonction, l’affectation et le rôle ne changent pas (un agent promu Chef de Bureau sans Bureau vacant reste « promu en attente de poste »).',
  AUTRE: 'Tout autre acte administratif à conserver dans le registre.',
};

function Formulaire({ refs, initial, id }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const modifie = JSON.stringify(f) !== JSON.stringify(initial);
  const navigate = useNavigate();
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const temporaire = ['INTERIM', 'DESIGNATION'].includes(f.type);
  const permanent = PERMANENTS.includes(f.type);
  const personne = refs.personnes.find((p) => String(p.id) === String(f.agent_id));
  const personnes = temporaire ? refs.personnes.filter((p) => p.compte) : refs.personnes;
  const posteChoisi = refs.postes.find((p) => String(p.id) === String(f.poste_id));
  const gradeRequisManquant = f.type === 'NOMINATION' && posteChoisi && personne && posteChoisi.grade_minimum_id && posteChoisi.grade_minimum_id !== personne.grade_id;
  const togglePerm = (c) => setF((x) => ({ ...x, permissions: x.permissions.includes(c) ? x.permissions.filter((p) => p !== c) : [...x.permissions, c] }));
  const postesProposes = refs.postes.filter((p) => {
    if (f.type === 'AFFECTATION') return p.role_associe === 'AGENT';
    if (f.type === 'FIN_FONCTION') return COMMANDEMENT.includes(p.role_associe) && (!f.agent_id || String(p.titulaire_agent_id) === String(f.agent_id));
    return COMMANDEMENT.includes(p.role_associe);
  });
  const gradesProposes = refs.grades.filter((g) => !personne || !personne.grade_id || g.niveau > (refs.grades.find((x) => x.id === personne.grade_id)?.niveau ?? -1));
  const enregistrer = async (e) => {
    e.preventDefault();
    const manque = [!f.reference.trim() && 'référence officielle', !f.date_acte && 'date de l’acte', !f.autorite.trim() && 'autorité signataire', !f.objet.trim() && 'objet',
      temporaire && !f.agent_id && (f.type === 'INTERIM' ? 'intérimaire' : 'bénéficiaire'), f.type === 'INTERIM' && !f.poste_id && 'poste',
      temporaire && !f.date_debut && 'date de début', temporaire && !f.date_fin && 'date de fin', f.type === 'DESIGNATION' && !f.permissions.length && 'opérations désignées',
      permanent && !f.agent_id && 'personne concernée', permanent && f.type !== 'ELEVATION_GRADE' && !f.poste_id && 'poste', f.type === 'ELEVATION_GRADE' && !f.grade_id && 'nouveau grade',
      permanent && !f.date_debut && 'date d’effet'].filter(Boolean);
    if (manque.length) { toast.error(`Champs obligatoires à compléter : ${manque.join(', ')}.`); return; }
    if (f.date_debut && f.date_fin && f.date_fin < f.date_debut) { toast.error('La date de fin précède la date de début.'); return; }
    setBusy(true);
    const body = {
      ...f,
      agent_id: f.agent_id ? Number(f.agent_id) : null,
      poste_id: f.poste_id && f.type !== 'ELEVATION_GRADE' ? Number(f.poste_id) : null,
      grade_id: f.type === 'ELEVATION_GRADE' && f.grade_id ? Number(f.grade_id) : null,
      permissions: f.type === 'DESIGNATION' ? f.permissions : [],
      date_debut: temporaire || f.date_debut ? f.date_debut || null : null,
      date_fin: permanent ? null : temporaire || f.date_fin ? f.date_fin || null : null,
    };
    try {
      const r = await runAction(() => (id ? api.put(`/actes/${id}`, body) : api.post('/actes', body)), id ? 'Acte modifié.' : 'Acte enregistré en préparation : joignez la copie signée puis soumettez-le.');
      navigate(`/actes/${r.data.id}`); // busy reste vrai : la navigation n’est pas bloquée
    } catch { setBusy(false); /* message affiché */ }
  };
  return (
    <form id="form-acte" onSubmit={enregistrer} className="space-y-4" noValidate>
      {refs.autoritePreparation === 'SECRETAIRE_GENERAL' && <InfoAlert tone="warning">En tant qu’Admin Système, vous n’enregistrez que les actes relatifs au poste de Directeur ; ils sont validés par le Secrétaire Général.</InfoAlert>}
      <Card title="Acte">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type d’acte" required>
            <select className="input" value={f.type} disabled={!!id} onChange={up('type')}>{Object.entries(refs.types).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field label="Référence officielle" required hint="Ex. Note de service n° 014/DEP/2026"><input className="input" value={f.reference} onChange={up('reference')} /></Field>
          <Field label="Date de l’acte" required><input type="date" className="input" value={f.date_acte} onChange={up('date_acte')} /></Field>
          <Field label="Autorité signataire" required hint="Ex. Le Directeur, Le Secrétaire Général"><input className="input" value={f.autorite} onChange={up('autorite')} /></Field>
          <Field label="Objet" required className="sm:col-span-2"><input className="input" value={f.objet} onChange={up('objet')} /></Field>
          <Field label="Motif" className="sm:col-span-2"><textarea className="input" rows={2} value={f.motif || ''} onChange={up('motif')} /></Field>
        </div>
        <p className="mt-3 text-sm text-slate-600">{AIDE[f.type]}</p>
      </Card>
      <Card title="Personne et poste">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={f.type === 'INTERIM' ? 'Intérimaire' : f.type === 'DESIGNATION' ? 'Bénéficiaire' : 'Personne concernée'} required={temporaire || permanent}>
            <select className="input" value={f.agent_id} onChange={up('agent_id')}>
              <option value="">— Choisir —</option>
              {personnes.map((p) => <option key={p.id} value={p.id}>{p.nom} · {p.matricule}{p.grade_code ? ` · grade ${p.grade_code}` : ''}{p.structure ? ` · ${p.structure}` : ''}</option>)}
            </select>
          </Field>
          {f.type === 'ELEVATION_GRADE' && (
            <Field label="Nouveau grade" required hint={personne ? `Grade actuel : ${personne.grade_code ? `${personne.grade_code} — ${personne.grade}` : 'non renseigné'}` : 'Grade supérieur au grade actuel'}>
              <select className="input" value={f.grade_id} onChange={up('grade_id')}>
                <option value="">— Choisir —</option>
                {gradesProposes.map((g) => <option key={g.id} value={g.id}>{g.code_officiel} — {g.libelle}</option>)}
              </select>
            </Field>
          )}
          {!['DESIGNATION', 'ELEVATION_GRADE'].includes(f.type) && (
            <Field label="Poste" required={f.type !== 'AUTRE'} hint={{ INTERIM: 'Poste de commandement exercé par intérim', NOMINATION: 'Poste de commandement vacant', AFFECTATION: 'Poste d’exécution de la structure d’affectation', FIN_FONCTION: 'Poste de commandement dont l’agent est titulaire' }[f.type] || 'Facultatif'}>
              <select className="input" value={f.poste_id} onChange={up('poste_id')}>
                <option value="">— Choisir —</option>
                {postesProposes.map((p) => <option key={p.id} value={p.id}>{p.code_organique ? `${p.code_organique} · ` : ''}{p.libelle}{COMMANDEMENT.includes(p.role_associe) ? (p.titulaire ? ` (titulaire : ${p.titulaire})` : ' (vacant)') : ''}{p.grade_requis ? ` · grade requis ${p.grade_requis}` : ''}</option>)}
              </select>
            </Field>
          )}
        </div>
        {gradeRequisManquant && <div className="mt-3"><InfoAlert tone="warning">L’agent n’a pas le grade requis par ce poste ({posteChoisi.grade_requis}) : procédez d’abord à son élévation en grade, sinon l’acte ne pourra pas être soumis.</InfoAlert></div>}
        {f.type === 'NOMINATION' && posteChoisi?.titulaire && <div className="mt-3"><InfoAlert tone="warning">Ce poste a un titulaire en fonction : établissez d’abord l’acte de fin de fonction.</InfoAlert></div>}
        {f.type === 'DESIGNATION' && (
          <fieldset className="mt-3">
            <legend className="label">Opérations désignées</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {refs.designables.map((p) => <label key={p.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.permissions.includes(p.code)} onChange={() => togglePerm(p.code)} /> {p.libelle}</label>)}
            </div>
          </fieldset>
        )}
      </Card>
      <Card title={permanent ? 'Date d’effet' : 'Période'}>
        {permanent ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date d’effet" required hint="Les effets s’appliquent à la validation si cette date est atteinte, sinon le jour venu."><input type="date" className="input" value={f.date_debut || ''} onChange={up('date_debut')} /></Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date de début" required={temporaire}><input type="date" className="input" value={f.date_debut || ''} onChange={up('date_debut')} /></Field>
            <Field label="Date de fin" required={temporaire}><input type="date" className="input" value={f.date_fin || ''} onChange={up('date_fin')} /></Field>
          </div>
        )}
        {temporaire && <p className="mt-2 text-xs text-slate-500">Les droits prennent effet à la date de début et expirent automatiquement après la date de fin.</p>}
      </Card>
      <ActionBar form="form-acte" dirty={modifie || !id} guard={modifie} saving={busy} onCancel={() => navigate(id ? `/actes/${id}` : '/actes')} saveLabel={id ? 'Enregistrer les modifications' : 'Enregistrer en préparation'} />
    </form>
  );
}

export default function ActeForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const refs = useApi('/actes/referentiels');
  const [initial, setInitial] = useState(id ? null : { ...VIDE, type: sp.get('type') || VIDE.type });
  useEffect(() => {
    if (!id) return;
    api.get(`/actes/${id}`).then((r) => {
      const a = r.data;
      setInitial({
        type: a.type, reference: a.reference, date_acte: a.date_acte || '', autorite: a.autorite, objet: a.objet, motif: a.motif || '',
        agent_id: a.agent_id ? String(a.agent_id) : '', poste_id: a.poste_id ? String(a.poste_id) : '', grade_id: a.grade_id ? String(a.grade_id) : '', permissions: a.permissions || [],
        date_debut: a.date_debut || '', date_fin: a.date_fin || '',
      });
    });
  }, [id]);
  return (
    <>
      <PageHeader title={id ? 'Modifier l’acte' : 'Enregistrer un acte administratif'} breadcrumb={[{ label: 'Actes administratifs', to: '/actes' }, { label: id ? 'Modification' : 'Nouvel acte' }]} />
      <Loadable state={refs}>{(r) => (initial ? <Formulaire refs={r} initial={initial} id={id} /> : null)}</Loadable>
    </>
  );
}
