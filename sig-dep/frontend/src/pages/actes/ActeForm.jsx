import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, Field, InfoAlert, runAction } from '../../components/ui';

const VIDE = { type: 'INTERIM', reference: '', date_acte: '', autorite: '', objet: '', motif: '', agent_id: '', poste_id: '', permissions: [], date_debut: '', date_fin: '' };
const AIDE = {
  INTERIM: 'Désigne un intérimaire sur un poste de commandement pour une période déterminée. Il exerce le rôle du poste dans son seul périmètre ; le titulaire est suspendu de ce rôle pendant la période. Le grade permanent de l’intérimaire n’est pas modifié.',
  DESIGNATION: 'Accorde temporairement des opérations administratives désignables à une personne (ex. enregistrement du courrier). Les droits expirent d’eux-mêmes à la date de fin.',
  NOMINATION: 'Enregistre la nomination d’une personne. L’acte validé fonde ensuite l’attribution du rôle correspondant et l’affectation dans le module Personnel.',
  AFFECTATION: 'Enregistre une décision d’affectation, appliquée ensuite dans le module Personnel.',
  FIN_FONCTION: 'Enregistre la fin de fonction d’une personne ; il fonde le retrait d’un rôle d’autorité.',
  AUTRE: 'Tout autre acte administratif à conserver dans le registre.',
};

function Formulaire({ refs, initial, id }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const temporaire = ['INTERIM', 'DESIGNATION'].includes(f.type);
  const togglePerm = (c) => setF((x) => ({ ...x, permissions: x.permissions.includes(c) ? x.permissions.filter((p) => p !== c) : [...x.permissions, c] }));
  const postesProposes = refs.postes;
  const enregistrer = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      ...f,
      agent_id: f.agent_id ? Number(f.agent_id) : null,
      poste_id: f.poste_id ? Number(f.poste_id) : null,
      permissions: f.type === 'DESIGNATION' ? f.permissions : [],
      date_debut: temporaire || f.date_debut ? f.date_debut || null : null,
      date_fin: temporaire || f.date_fin ? f.date_fin || null : null,
    };
    try {
      const r = await runAction(() => (id ? api.put(`/actes/${id}`, body) : api.post('/actes', body)), id ? 'Acte modifié.' : 'Acte enregistré en préparation : joignez la copie signée puis soumettez-le.');
      navigate(`/actes/${r.data.id}`);
    } catch { /* message affiché */ } finally { setBusy(false); }
  };
  return (
    <form onSubmit={enregistrer} className="space-y-4" noValidate>
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
          <Field label={f.type === 'INTERIM' ? 'Intérimaire' : f.type === 'DESIGNATION' ? 'Bénéficiaire' : 'Personne concernée'} required={temporaire}>
            <select className="input" value={f.agent_id} onChange={up('agent_id')}>
              <option value="">— Choisir —</option>
              {refs.personnes.map((p) => <option key={p.id} value={p.id}>{p.nom} · {p.matricule}{p.structure ? ` · ${p.structure}` : ''}</option>)}
            </select>
          </Field>
          {f.type !== 'DESIGNATION' && (
            <Field label="Poste" required={f.type === 'INTERIM'} hint={f.type === 'INTERIM' ? 'Poste de commandement exercé par intérim' : 'Facultatif'}>
              <select className="input" value={f.poste_id} onChange={up('poste_id')}>
                <option value="">— Choisir —</option>
                {postesProposes.map((p) => <option key={p.id} value={p.id}>{p.code_organique ? `${p.code_organique} · ` : ''}{p.libelle}{p.titulaire ? ` (titulaire : ${p.titulaire})` : ' (vacant)'}</option>)}
              </select>
            </Field>
          )}
        </div>
        {f.type === 'DESIGNATION' && (
          <fieldset className="mt-3">
            <legend className="label">Opérations désignées</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {refs.designables.map((p) => <label key={p.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.permissions.includes(p.code)} onChange={() => togglePerm(p.code)} /> {p.libelle}</label>)}
            </div>
          </fieldset>
        )}
      </Card>
      <Card title="Période">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date de début" required={temporaire}><input type="date" className="input" value={f.date_debut || ''} onChange={up('date_debut')} /></Field>
          <Field label="Date de fin" required={temporaire}><input type="date" className="input" value={f.date_fin || ''} onChange={up('date_fin')} /></Field>
        </div>
        {temporaire && <p className="mt-2 text-xs text-slate-500">Les droits prennent effet à la date de début et expirent automatiquement après la date de fin.</p>}
      </Card>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={busy}>{id ? 'Enregistrer les modifications' : 'Enregistrer en préparation'}</button>
      </div>
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
        agent_id: a.agent_id ? String(a.agent_id) : '', poste_id: a.poste_id ? String(a.poste_id) : '', permissions: a.permissions || [],
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
