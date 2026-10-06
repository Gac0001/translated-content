import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Lock, MapPin, Pencil, X } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, StatusBadge, Badge, Modal, Field, InfoAlert, Empty, runAction } from '../../components/ui';

const TYPES = { AUDIENCE: 'Audience', REUNION: 'Réunion', DEPLACEMENT: 'Déplacement', CEREMONIE: 'Cérémonie', AUTRE: 'Autre' };
const TZ = 'Africa/Kinshasa';
const iso = (d) => d.toISOString().slice(0, 10);
const lundi = (d) => { const x = new Date(d); const j = (x.getDay() + 6) % 7; x.setDate(x.getDate() - j); x.setHours(0, 0, 0, 0); return x; };
const ajouter = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const versLocal = (v) => {
  if (!v) return '';
  const d = new Date(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const heure = (v) => new Date(v).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const jourCle = (v) => new Date(v).toLocaleDateString('fr-CA', { timeZone: TZ });

function EvenementModal({ ev, onClose, onSaved }) {
  const [f, setF] = useState({
    type: ev?.type || 'AUDIENCE', titre: ev?.titre || '', debut: versLocal(ev?.debut), fin: versLocal(ev?.fin), lieu: ev?.lieu || '',
    interlocuteur: ev?.interlocuteur || '', notes: ev?.notes || '', confidentiel: !!ev?.confidentiel, statut: ev?.statut === 'CONFIRME' ? 'CONFIRME' : 'PREVU',
  });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enregistrer = async () => {
    const body = { ...f, debut: new Date(f.debut).toISOString(), fin: f.fin ? new Date(f.fin).toISOString() : null, lieu: f.lieu || null, interlocuteur: f.interlocuteur || null, notes: f.notes || null };
    await runAction(() => (ev ? api.put(`/agenda/${ev.id}`, body) : api.post('/agenda', body)), ev ? 'Rendez-vous mis à jour.' : 'Ajouté à l’agenda du Directeur.');
    onSaved();
  };
  return (
    <Modal open size="lg" title={ev ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={f.titre.trim().length < 3 || !f.debut} onClick={enregistrer}>Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" required><select className="input" value={f.type} onChange={up('type')}>{Object.entries(TYPES).filter(([k]) => k !== 'REUNION').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="État"><select className="input" value={f.statut} onChange={up('statut')}><option value="PREVU">Prévu</option><option value="CONFIRME">Confirmé</option></select></Field>
        <Field label="Objet" required className="sm:col-span-2"><input className="input" value={f.titre} onChange={up('titre')} /></Field>
        <Field label="Début" required><input type="datetime-local" className="input" value={f.debut} onChange={up('debut')} /></Field>
        <Field label="Fin"><input type="datetime-local" className="input" value={f.fin} min={f.debut} onChange={up('fin')} /></Field>
        <Field label="Lieu"><input className="input" value={f.lieu} onChange={up('lieu')} /></Field>
        <Field label="Interlocuteur"><input className="input" value={f.interlocuteur} onChange={up('interlocuteur')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="input" rows={3} value={f.notes} onChange={up('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.confidentiel} onChange={up('confidentiel')} /> Confidentiel</label>
      </div>
    </Modal>
  );
}

/** Agenda du Directeur, tenu par le Bureau Secrétariat de Direction (vue par semaine). */
export default function Agenda() {
  const [debut, setDebut] = useState(lundi(new Date()));
  const fin = ajouter(debut, 6);
  const state = useApi(`/agenda?du=${iso(debut)}&au=${iso(fin)}`, [iso(debut)]);
  const [edition, setEdition] = useState(null);
  const statut = async (ev, s, msg) => { await runAction(() => api.post(`/agenda/${ev.id}/statut`, { statut: s }), msg); state.reload(); };
  const jours = Array.from({ length: 7 }, (_, i) => ajouter(debut, i));
  return (
    <>
      <PageHeader title="Agenda du Directeur" subtitle="Audiences, réunions et déplacements ; rappels la veille et une heure avant."
        breadcrumb={[{ label: 'Pilotage' }, { label: 'Agenda' }]}
        actions={state.data?.droits?.gerer && <button type="button" className="btn-primary" onClick={() => setEdition('nouveau')}><CalendarPlus size={16} /> Nouveau rendez-vous</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => setDebut(ajouter(debut, -7))} aria-label="Semaine précédente"><ChevronLeft size={16} /></button>
        <button type="button" className="btn-secondary" onClick={() => setDebut(lundi(new Date()))}>Cette semaine</button>
        <button type="button" className="btn-secondary" onClick={() => setDebut(ajouter(debut, 7))} aria-label="Semaine suivante"><ChevronRight size={16} /></button>
        <span className="text-sm font-medium text-slate-700">Semaine du {debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au {fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
      <InfoAlert>Les réunions présidées par le Directeur s’inscrivent automatiquement à la convocation et suivent leurs reports ou annulations.</InfoAlert>
      <Loadable state={state}>
        {(d) => (
          <div className="mt-4 space-y-3">
            {jours.map((j) => {
              const evs = d.data.filter((e) => jourCle(e.debut) === iso(j));
              const aujourdhui = iso(j) === new Date().toLocaleDateString('fr-CA', { timeZone: TZ });
              return (
                <Card key={iso(j)} title={`${j.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${aujourdhui ? ' — aujourd’hui' : ''}`} bodyClass="p-0">
                  {evs.length ? (
                    <ul className="divide-y divide-slate-100">
                      {evs.map((e) => (
                        <li key={e.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start ${e.statut === 'ANNULE' ? 'opacity-60' : ''}`}>
                          <div className="w-28 shrink-0 font-semibold tabular-nums text-dep-800">{heure(e.debut)}{e.fin ? ` – ${heure(e.fin)}` : ''}</div>
                          <div className="min-w-0 flex-1 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`font-medium ${e.statut === 'ANNULE' ? 'line-through' : ''}`}>{e.reunion_id ? <Link className="text-dep-700 hover:underline" to={`/reunions/${e.reunion_id}`}>{e.titre}</Link> : e.titre}</span>
                              <Badge>{TYPES[e.type]}</Badge><StatusBadge value={e.statut} />
                              {e.confidentiel && <Lock size={14} className="text-slate-500" aria-label="Confidentiel" />}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                              {e.lieu && <span className="inline-flex items-center gap-1"><MapPin size={12} />{e.lieu}</span>}
                              {e.interlocuteur && <span>Avec : {e.interlocuteur}</span>}
                              {e.reunion_reference && <span>{e.reunion_reference}</span>}
                            </div>
                            {e.notes && <p className="mt-1 whitespace-pre-line text-slate-600">{e.notes}</p>}
                          </div>
                          {d.droits.gerer && !e.reunion_id && !['ANNULE', 'TENU'].includes(e.statut) && (
                            <div className="flex shrink-0 gap-1">
                              <button type="button" className="btn-ghost px-2" aria-label="Modifier" onClick={() => setEdition(e)}><Pencil size={15} /></button>
                              {e.statut === 'PREVU' && <button type="button" className="btn-ghost px-2" aria-label="Confirmer" onClick={() => statut(e, 'CONFIRME', 'Rendez-vous confirmé.')}><Check size={15} /></button>}
                              <button type="button" className="btn-ghost px-2 text-red-700" aria-label="Annuler" onClick={() => statut(e, 'ANNULE', 'Rendez-vous annulé.')}><X size={15} /></button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : <div className="px-4 py-2"><Empty message="Aucun rendez-vous." /></div>}
                </Card>
              );
            })}
          </div>
        )}
      </Loadable>
      {edition && <EvenementModal ev={edition === 'nouveau' ? null : edition} onClose={() => setEdition(null)} onSaved={() => { setEdition(null); state.reload(); }} />}
    </>
  );
}
