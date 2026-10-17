import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarCheck, Plus, Save, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import {
  useApi, Loadable, PageHeader, Card, Button, IconButton, SimpleTable, Tabs, useOnglet, Field, NumberInput, EmptyState, KpiTile, StatusBadge, Badge, runAction, useConfirm,
} from '../../components/ui';
import { aujourdhui, fmtDate, fmtDateTime } from '../../lib/format';
import { StatutSemaine, StatutRectificatif, EtatPresence, MOTIFS, resumeBilan } from './commun';
import Synthese from './Synthese';

function Semaines({ data }) {
  const navigate = useNavigate();
  return (
    <Card bodyClass="p-0">
      <SimpleTable label="Rapports hebdomadaires" rows={data} onRowClick={(s) => navigate(`/presences/semaines/${s.id}`)} empty="Aucun rapport hebdomadaire."
        columns={[
          { key: 'reference', header: 'Référence', render: (s) => <span className="font-medium">{s.reference}</span> },
          { key: 'semaine', header: 'Semaine', render: (s) => `du ${fmtDate(s.semaine_debut)} au ${fmtDate(s.semaine_fin)}` },
          { key: 'statut', header: 'Statut', render: (s) => <StatutSemaine value={s.statut} /> },
          { key: 'bilan', header: 'Agent-jours', render: (s) => <span className="text-sm">{resumeBilan(s.bilan)}</span> },
          { key: 'rect', header: 'Rectificatifs à valider', align: 'right', render: (s) => (s.rectificatifs_en_attente ? <Badge tone="attention">{s.rectificatifs_en_attente}</Badge> : '—') },
          { key: 'transmis', header: 'Transmis le', render: (s) => fmtDateTime(s.transmis_at) },
        ]} />
    </Card>
  );
}

function Rectificatifs() {
  const navigate = useNavigate();
  const state = useApi('/presences/rectificatifs');
  return (
    <Loadable state={state}>
      {(d) => (
        <Card bodyClass="p-0">
          <SimpleTable label="Rectificatifs" rows={d.data} onRowClick={(r) => navigate(`/presences/semaines/${r.semaine_id}`)} empty="Aucun rectificatif."
            columns={[
              { key: 'reference', header: 'Référence', render: (r) => <span className="font-medium">{r.reference}</span> },
              { key: 'liste', header: 'Liste', render: (r) => `${r.categorie === 'CADRES' ? 'Cadres' : 'Agents'} du ${fmtDate(r.date)}` },
              { key: 'motif', header: 'Motif' },
              { key: 'auteur', header: 'Proposé par', render: (r) => `${r.auteur} · ${fmtDateTime(r.cree_at)}` },
              { key: 'statut', header: 'Statut', render: (r) => <StatutRectificatif value={r.statut} /> },
            ]} />
        </Card>
      )}
    </Loadable>
  );
}

function Parametres() {
  const state = useApi('/presences/parametres');
  const confirm = useConfirm();
  const [h, setH] = useState(null);
  const [ferie, setFerie] = useState({ date: '', libelle: '' });
  useEffect(() => { if (state.data) setH(state.data.horaires); }, [state.data]);
  const enregistrer = async () => { await runAction(() => api.put('/presences/parametres', h), 'Horaires enregistrés.'); state.reload(); };
  const ajouter = async () => { await runAction(() => api.post('/presences/feries', ferie), 'Jour férié ajouté.'); setFerie({ date: '', libelle: '' }); state.reload(); };
  const retirer = async (f) => {
    if (!(await confirm({ title: 'Retirer le jour férié', message: `Retirer « ${f.libelle} » du ${fmtDate(f.date)} ?`, danger: true, confirmLabel: 'Retirer' }))) return;
    await runAction(() => api.delete(`/presences/feries/${f.id}`), 'Jour férié retiré.');
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Horaires de référence">
            {h && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Heure d’arrivée"><input type="time" className="input" value={h.arrivee} onChange={(e) => setH({ ...h, arrivee: e.target.value })} /></Field>
                  <Field label="Heure de départ"><input type="time" className="input" value={h.depart} onChange={(e) => setH({ ...h, depart: e.target.value })} /></Field>
                  <Field label="Tolérance (minutes)"><NumberInput value={h.tolerance} min={0} max={120} onChange={(v) => setH({ ...h, tolerance: v ?? 0 })} /></Field>
                </div>
                <p className="text-xs text-slate-600">Un agent arrivé au-delà de l’heure d’arrivée augmentée de la tolérance est compté en retard. Les horaires s’appliquent aux listes ouvertes à partir de leur modification.</p>
                <Button variant="primary" icon={Save} onClick={enregistrer}>Enregistrer les horaires</Button>
              </div>
            )}
          </Card>
          <Card title="Jours fériés" bodyClass="p-0">
            <div className="flex flex-wrap items-end gap-2 border-b p-3">
              <Field label="Date"><input type="date" className="input" value={ferie.date} onChange={(e) => setFerie({ ...ferie, date: e.target.value })} /></Field>
              <Field label="Libellé" className="min-w-[12rem] flex-1"><input className="input" value={ferie.libelle} onChange={(e) => setFerie({ ...ferie, libelle: e.target.value })} /></Field>
              <Button icon={Plus} disabled={!ferie.date || ferie.libelle.trim().length < 2} onClick={ajouter}>Ajouter</Button>
            </div>
            <SimpleTable label="Jours fériés" dense rows={d.feries} empty="Aucun jour férié déclaré." columns={[
              { key: 'date', header: 'Date', render: (f) => fmtDate(f.date) },
              { key: 'libelle', header: 'Libellé' },
              { key: 'x', header: '', render: (f) => <IconButton label={`Retirer ${f.libelle}`} icon={Trash2} size={15} className="p-1 text-red-700" onClick={() => retirer(f)} /> },
            ]} />
          </Card>
        </div>
      )}
    </Loadable>
  );
}

/** Présences personnelles de l’agent connecté (rapports transmis, rectificatifs compris). */
export function MesPresences() {
  const state = useApi('/presences/moi');
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <KpiTile label="Jours renseignés" valeur={String(d.bilan.renseignes)} />
            <KpiTile label="Présences" valeur={String(d.bilan.presents)} tone="vert" />
            <KpiTile label="Retards" valeur={String(d.bilan.retards)} tone="jaune" />
            <KpiTile label="Absences" valeur={String(d.bilan.absents)} tone="rouge" />
          </div>
          <Card bodyClass="p-0">
            <SimpleTable label="Mes présences" rows={d.data} rowKey="liste_id" empty="Aucune présence transmise pour le moment."
              columns={[
                { key: 'date', header: 'Date', render: (l) => fmtDate(l.date) },
                { key: 'etat', header: 'État', render: (l) => <EtatPresence value={l.etat} /> },
                { key: 'ha', header: 'H-A', render: (l) => l.heure_arrivee || '—' },
                { key: 'hd', header: 'H-D', render: (l) => l.heure_depart || '—' },
                { key: 'retard', header: 'Retard', align: 'right', render: (l) => (l.retard_minutes ? `${l.retard_minutes} min` : '—') },
                { key: 'motif', header: 'Motif', render: (l) => (l.motif ? MOTIFS[l.motif] : '—') },
                { key: 'ref', header: 'Rapport', render: (l) => <span className="text-xs">{l.reference}{l.rectifiee && ' (rectifié)'}</span> },
              ]} />
          </Card>
        </div>
      )}
    </Loadable>
  );
}

/** Page « Mes présences », ouverte à tout agent (sans droit de consultation des présences). */
export function PageMesPresences() {
  return (
    <>
      <PageHeader title="Mes présences" subtitle="Présences des rapports hebdomadaires transmis au Directeur" breadcrumb={[{ label: 'Mes présences' }]} />
      <MesPresences />
    </>
  );
}

function Anciennes() {
  const navigate = useNavigate();
  const state = useApi('/presences/anciennes');
  return (
    <Loadable state={state}>
      {(d) => (
        <Card bodyClass="p-0">
          <p className="border-b p-3 text-sm text-slate-700">Listes hebdomadaires par Bureau tenues avant la version 1.38, conservées en lecture seule.</p>
          <SimpleTable label="Anciennes listes" rows={d.data} onRowClick={(s) => navigate(`/presences/anciennes/${s.id}`)} empty="Aucune ancienne liste."
            columns={[
              { key: 'reference', header: 'Référence', render: (s) => <span className="font-medium">{s.reference}</span> },
              { key: 'semaine', header: 'Semaine', render: (s) => `S${s.numero_semaine} · ${fmtDate(s.semaine_debut)}` },
              { key: 'structure', header: 'Structure', render: (s) => (s.structure_type === 'DIRECTION' ? 'Direction' : s.bureau_nom) },
              { key: 'statut', header: 'Statut', render: (s) => <StatusBadge value={s.statut} /> },
            ]} />
        </Card>
      )}
    </Loadable>
  );
}

export default function Presences() {
  const can = useAuth((s) => s.can);
  const state = useApi('/presences/semaines');
  const droits = state.data?.droits || {};
  const onglets = [
    { value: 'semaines', label: 'Rapports hebdomadaires' },
    droits.consulter && { value: 'synthese', label: 'Synthèse mensuelle' },
    droits.global && { value: 'rectificatifs', label: 'Rectificatifs' },
    (droits.gerer || droits.directeur) && { value: 'parametres', label: 'Horaires et jours fériés' },
    { value: 'moi', label: 'Mes présences' },
    { value: 'anciennes', label: 'Anciennes listes' },
  ].filter(Boolean);
  const [onglet, choisir] = useOnglet('semaines', { valeurs: onglets.map((o) => o.value) });
  return (
    <>
      <PageHeader title="Présences" subtitle="Listes journalières des Cadres et des Agents, rapport hebdomadaire au Directeur (annexe 11)" breadcrumb={[{ label: 'Présences' }]}
        actions={can('presences.preparer_direction') && droits.gerer && <Link className="btn-primary" to={`/presences/jour/${aujourdhui()}`}><CalendarCheck size={16} aria-hidden /> Présences du jour</Link>} />
      <Tabs tabs={onglets} value={onglet} onChange={choisir} label="Présences" />
      {onglet === 'semaines' && (
        <Loadable state={state}>
          {(d) => (d.data.length || !d.droits.gerer ? <Semaines data={d.data} /> : (
            <EmptyState icon={CalendarCheck} title="Aucun rapport pour le moment" action={<Link className="btn-primary" to={`/presences/jour/${aujourdhui()}`}>Saisir les présences du jour</Link>}>
              Le rapport de la semaine se crée à l’ouverture des premières listes journalières.
            </EmptyState>
          ))}
        </Loadable>
      )}
      {onglet === 'synthese' && <Synthese />}
      {onglet === 'rectificatifs' && <Rectificatifs />}
      {onglet === 'parametres' && <Parametres />}
      {onglet === 'moi' && <MesPresences />}
      {onglet === 'anciennes' && <Anciennes />}
    </>
  );
}
