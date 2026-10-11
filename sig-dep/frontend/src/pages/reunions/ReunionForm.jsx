import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, PageHeader, Card, Field, InfoAlert, ActionBar, runAction } from '../../components/ui';

/** Valeur d’un champ « date et heure » (heure locale du navigateur) ↔ date ISO. */
const versLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const versIso = (local) => (local ? new Date(local).toISOString() : null);

/** Préparation ou modification d’une réunion : ordre du jour, participants, invités extérieurs. */
export default function ReunionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const existante = useApi(id ? `/reunions/${id}` : null, [id]);
  const invitables = useApi('/reunions/invitables');
  const [f, setF] = useState({ objet: '', debut: '', fin: '', lieu: '', confidentialite: 'ORDINAIRE', pour_directeur: false, redacteur_user_id: '' });
  const [points, setPoints] = useState([{ titre: '', rapporteur: '' }]);
  const [participants, setParticipants] = useState([]);
  const [externes, setExternes] = useState([]);
  const [filtre, setFiltre] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [initial, setInitial] = useState(() => JSON.stringify({ f: { objet: '', debut: '', fin: '', lieu: '', confidentialite: 'ORDINAIRE', pour_directeur: false, redacteur_user_id: '' }, points: [{ titre: '', rapporteur: '' }], participants: [], externes: [] }));
  useEffect(() => {
    const r = existante.data;
    if (!r) return;
    const v = {
      f: { objet: r.objet, debut: versLocal(r.debut), fin: versLocal(r.fin), lieu: r.lieu || '', confidentialite: r.confidentialite, pour_directeur: false, redacteur_user_id: r.redacteur_user_id ? String(r.redacteur_user_id) : '' },
      points: r.ordre_du_jour.length ? r.ordre_du_jour.map((p) => ({ titre: p.titre, rapporteur: p.rapporteur || '' })) : [{ titre: '', rapporteur: '' }],
      participants: r.participants.filter((p) => p.user_id).map((p) => p.user_id),
      externes: r.participants.filter((p) => !p.user_id).map((p) => ({ nom: p.nom_externe, qualite: p.qualite_externe || '' })),
    };
    setF(v.f); setPoints(v.points); setParticipants(v.participants); setExternes(v.externes);
    setInitial(JSON.stringify(v));
  }, [existante.data]);
  const modifie = JSON.stringify({ f, points, participants, externes }) !== initial;
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const liste = useMemo(() => (invitables.data?.data || []).filter((n) => n.userId !== user.id && (!filtre || `${n.nomComplet} ${n.structure} ${n.roleLibelle}`.toLowerCase().includes(filtre.toLowerCase()))), [invitables.data, filtre, user.id]);
  const pourDirecteur = can('reunions.preparer_direction') && user.primaryRole !== 'DIRECTEUR';
  const enregistrer = async () => {
    if (f.objet.trim().length < 3) throw new Error('L’objet doit comporter au moins 3 caractères.');
    if (!f.debut) throw new Error('La date et l’heure de début sont obligatoires.');
    if (f.fin && f.fin < f.debut) throw new Error('La fin de la réunion précède son début.');
    const body = {
      objet: f.objet, debut: versIso(f.debut), fin: versIso(f.fin), lieu: f.lieu || null, confidentialite: f.confidentialite,
      ordre_du_jour: points.filter((p) => p.titre.trim()).map((p) => ({ titre: p.titre.trim(), rapporteur: p.rapporteur.trim() || null })),
      participants, externes: externes.filter((e) => e.nom.trim()).map((e) => ({ nom: e.nom.trim(), qualite: e.qualite.trim() || null })),
      redacteur_user_id: f.redacteur_user_id ? Number(f.redacteur_user_id) : null,
    };
    if (!id) body.pour_directeur = f.pour_directeur;
    setEnCours(true);
    let r;
    try { r = await runAction(() => (id ? api.put(`/reunions/${id}`, body) : api.post('/reunions', body)), id ? 'Réunion mise à jour.' : 'Réunion préparée : vérifiez-la puis envoyez les convocations.'); } catch (e) { setEnCours(false); throw e; }
    setInitial(JSON.stringify({ f, points, participants, externes })); // la navigation qui suit n’est plus protégée
    navigate(`/reunions/${r.data.id}`);
  };
  return (
    <>
      <PageHeader title={id ? 'Modifier la réunion' : 'Préparer une réunion'} breadcrumb={[{ label: 'Réunions', to: '/reunions' }, { label: id ? 'Modification' : 'Nouvelle' }]} />
      <div className="space-y-4">
        {id && existante.data?.statut === 'CONVOQUEE' && <InfoAlert tone="warning">Réunion déjà convoquée : les participants seront prévenus de la modification ; un changement de date est enregistré comme un report.</InfoAlert>}
        <Card title="Réunion">
          <div className="grid gap-4 sm:grid-cols-2">
            {!id && pourDirecteur && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-0.5" checked={f.pour_directeur} onChange={up('pour_directeur')} />
                <span><b>Réunion présidée par le Directeur</b> : préparée par le Bureau Secrétariat de Direction, inscrite à l’agenda du Directeur ; vous en rédigez le compte rendu.</span>
              </label>
            )}
            <Field label="Objet" required className="sm:col-span-2"><input className="input" value={f.objet} onChange={up('objet')} /></Field>
            <Field label="Début" required><input type="datetime-local" className="input" value={f.debut} onChange={up('debut')} /></Field>
            <Field label="Fin"><input type="datetime-local" className="input" value={f.fin} min={f.debut} onChange={up('fin')} /></Field>
            <Field label="Lieu"><input className="input" value={f.lieu} onChange={up('lieu')} /></Field>
            <Field label="Confidentialité"><select className="input" value={f.confidentialite} onChange={up('confidentialite')}><option value="ORDINAIRE">Ordinaire</option><option value="CONFIDENTIEL">Confidentiel</option><option value="SECRET">Secret</option></select></Field>
            {user.primaryRole === 'DIRECTEUR' && (
              <Field label="Rédacteur du compte rendu" className="sm:col-span-2" hint="Par défaut, vous-même ; désignez par exemple un membre du Bureau Secrétariat de Direction.">
                <select className="input" value={f.redacteur_user_id} onChange={up('redacteur_user_id')}>
                  <option value="">— Moi-même —</option>
                  {(invitables.data?.data || []).filter((n) => n.userId !== user.id).map((n) => <option key={n.userId} value={n.userId}>{n.nomComplet} — {n.roleLibelle} · {n.structure}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Card>
        <Card title="Ordre du jour" actions={<button type="button" className="btn-secondary" onClick={() => setPoints([...points, { titre: '', rapporteur: '' }])}><Plus size={16} aria-hidden /> Point</button>}>
          <ol className="space-y-2">
            {points.map((p, i) => (
              <li key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="w-6 text-sm font-semibold text-slate-500">{i + 1}.</span>
                <input className="input flex-1" placeholder="Point à l’ordre du jour" aria-label={`Point ${i + 1} de l’ordre du jour`} value={p.titre} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, titre: e.target.value } : x)))} />
                <input className="input sm:w-64" placeholder="Rapporteur (facultatif)" aria-label={`Rapporteur du point ${i + 1}`} value={p.rapporteur} onChange={(e) => setPoints(points.map((x, j) => (j === i ? { ...x, rapporteur: e.target.value } : x)))} />
                <button type="button" className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={`Retirer le point ${i + 1}`} onClick={() => setPoints(points.filter((_, j) => j !== i))}><Trash2 size={16} aria-hidden /></button>
              </li>
            ))}
          </ol>
        </Card>
        <Card title={`Participants (${participants.length})`}>
          <input type="search" className="input mb-3" placeholder="Filtrer par nom, structure ou fonction…" aria-label="Filtrer les participants" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
          <div className="grid max-h-80 gap-1 overflow-y-auto sm:grid-cols-2">
            {liste.map((n) => (
              <label key={n.userId} className="flex items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5" checked={participants.includes(n.userId)} onChange={(e) => setParticipants(e.target.checked ? [...participants, n.userId] : participants.filter((x) => x !== n.userId))} />
                <span>{n.nomComplet} <span className="text-xs text-slate-500">— {n.roleLibelle} · {n.structure}</span></span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Invités extérieurs" actions={<button type="button" className="btn-secondary" onClick={() => setExternes([...externes, { nom: '', qualite: '' }])}><Plus size={16} aria-hidden /> Invité</button>}>
          {!externes.length && <p className="text-sm text-slate-500">Aucun invité extérieur.</p>}
          <div className="space-y-2">
            {externes.map((e, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <input className="input flex-1" placeholder="Nom" aria-label={`Nom de l’invité ${i + 1}`} value={e.nom} onChange={(ev) => setExternes(externes.map((x, j) => (j === i ? { ...x, nom: ev.target.value } : x)))} />
                <input className="input flex-1" placeholder="Qualité / institution" aria-label={`Qualité de l’invité ${i + 1}`} value={e.qualite} onChange={(ev) => setExternes(externes.map((x, j) => (j === i ? { ...x, qualite: ev.target.value } : x)))} />
                <button type="button" className="rounded p-2 text-red-600 hover:bg-red-50" aria-label={`Retirer l’invité ${i + 1}`} onClick={() => setExternes(externes.filter((_, j) => j !== i))}><Trash2 size={16} aria-hidden /></button>
              </div>
            ))}
          </div>
        </Card>
        <ActionBar dirty={modifie || !id} guard={modifie} saving={enCours} onSave={enregistrer} onCancel={() => navigate(id ? `/reunions/${id}` : '/reunions')} saveLabel={id ? 'Enregistrer' : 'Préparer la réunion'} />
      </div>
    </>
  );
}
