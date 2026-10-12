import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi, Loadable, Card, IconButton, KpiTile, SimpleTable, BarList, EmptyState, InfoAlert } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { aujourdhui, fmtDate, fmtNombre } from '../../lib/format';
import { MOTIFS } from './commun';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const libelleMois = (m) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const decalerMois = (m, n) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const pct = (v) => (v === null || v === undefined ? '—' : `${fmtNombre(v, 1)} %`);
const motifsTexte = (m) => Object.entries(m || {}).map(([k, v]) => `${MOTIFS[k]} : ${v}`).join(' · ') || '—';
const colonnes = [
  { key: 'renseignes', header: 'Agent-jours', align: 'right' },
  { key: 'presents', header: 'Présents', align: 'right' },
  { key: 'retards', header: 'Retards', align: 'right', render: (r) => (r.retards ? <span className="whitespace-nowrap">{r.retards} ({r.minutes_retard} min)</span> : '—') },
  { key: 'absents', header: 'Absences', align: 'right' },
  { key: 'motifs', header: 'Absences par motif', render: (r) => <span className="text-xs">{motifsTexte(r.motifs)}</span> },
  { key: 'taux', header: 'Taux de présence', align: 'right', render: (r) => pct(r.taux) },
  { key: 'ponctualite', header: 'Ponctualité', align: 'right', render: (r) => pct(r.taux_ponctualite) },
];

/**
 * Synthèse mensuelle des présences (listes transmises, valeurs rectifiées comprises) : indicateurs,
 * taux par structure, absences par motif, détail par agent (sauf pour le Secrétaire Général) et par jour.
 */
export default function Synthese() {
  const [mois, setMois] = useState(() => aujourdhui().slice(0, 7));
  const state = useApi(`/presences/synthese?mois=${mois}`, [mois]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Mois précédent" icon={ChevronLeft} onClick={() => setMois(decalerMois(mois, -1))} />
        <input type="month" className="input w-auto" aria-label="Mois de la synthèse" value={mois} max={aujourdhui().slice(0, 7)} onChange={(e) => e.target.value && setMois(e.target.value)} />
        <IconButton label="Mois suivant" icon={ChevronRight} disabled={mois >= aujourdhui().slice(0, 7)} onClick={() => setMois(decalerMois(mois, 1))} />
        <h2 className="font-display text-lg font-semibold capitalize text-dep-700">{libelleMois(mois)}</h2>
        <div className="ml-auto"><ExportButtons base="/presences/synthese/export" query={`?mois=${mois}`} print={false} /></div>
      </div>
      <Loadable state={state}>
        {(d) => (!d.global.renseignes ? (
          <EmptyState title="Aucune liste transmise ce mois-ci">La synthèse se calcule sur les listes transmises au Directeur avec le rapport hebdomadaire.</EmptyState>
        ) : (
          <>
            <InfoAlert>
              {d.portee === 'Direction' ? 'Ensemble de la Direction' : `Votre ${d.portee}`} — listes transmises de {d.jours_couverts} jour(s) sur {d.jours_ouvrables} jour(s) ouvrable(s)
              {Object.keys(d.feries).length > 0 && `, ${Object.keys(d.feries).length} jour(s) férié(s)`} ; valeurs rectifiées comprises.
            </InfoAlert>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Taux de présence" valeur={pct(d.global.taux)} tone="vert" aide="Agent-jours de présence sur les agent-jours renseignés" />
              <KpiTile label="Ponctualité" valeur={pct(d.global.taux_ponctualite)} aide="Présences sans retard sur l’ensemble des présences" />
              <KpiTile label="Retards" valeur={String(d.global.retards)} unite={`(${d.global.minutes_retard} min)`} tone="jaune" />
              <KpiTile label="Absences" valeur={String(d.global.absents)} tone="rouge" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Taux de présence par structure" className="lg:col-span-2">
                <BarList label="Taux de présence par structure" rows={d.structures.map((s) => ({
                  key: s.code, label: `${s.code} ${s.libelle}`, value: s.taux, indent: s.code.split('.').length > 2,
                  detail: [['Effectif', s.effectif], ['Agent-jours', s.renseignes], ['Retards', s.retards], ['Absences', s.absents], ['Ponctualité', pct(s.taux_ponctualite)]],
                }))} />
              </Card>
              <Card title="Absences par motif" bodyClass="p-0">
                <SimpleTable label="Absences par motif" dense rowKey="motif" empty="Aucune absence."
                  rows={Object.entries(d.global.motifs).sort((a, b) => b[1] - a[1]).map(([motif, n]) => ({ motif, n }))}
                  columns={[{ key: 'motif', header: 'Motif', render: (r) => MOTIFS[r.motif] }, { key: 'n', header: 'Agent-jours', align: 'right' }]} />
              </Card>
            </div>
            <Card title="Par structure" bodyClass="p-0">
              <SimpleTable label="Synthèse par structure" rowKey="code" rows={d.structures}
                footer={[{ code: 'total', libelle: 'Ensemble', effectif: d.agents ? d.agents.length : d.structures.reduce((t, s) => t + s.effectif, 0), ...d.global }]}
                columns={[
                  { key: 'libelle', header: 'Structure', render: (s) => (s.code === 'total' ? s.libelle : <span><b>{s.code}</b> {s.libelle}</span>) },
                  { key: 'effectif', header: 'Effectif', align: 'right' },
                  ...colonnes,
                ]} />
            </Card>
            {d.agents && (
              <Card title="Par agent" bodyClass="p-0">
                <SimpleTable label="Synthèse par agent" rowKey="agent_id" rows={d.agents} figee
                  columns={[
                    { key: 'nom', header: 'Nom, postnom et prénom', render: (a) => <span className="whitespace-nowrap font-medium">{a.nom_complet}</span> },
                    { key: 'structure', header: 'Structure', render: (a) => a.structure_code },
                    { key: 'grade', header: 'Grade', render: (a) => a.grade_code || '—' },
                    ...colonnes,
                  ]} />
              </Card>
            )}
            <Card title="Par jour" bodyClass="p-0">
              <SimpleTable label="Synthèse par jour" dense rowKey="date" rows={d.jours}
                columns={[{ key: 'date', header: 'Date', render: (j) => fmtDate(j.date) }, ...colonnes.filter((c) => c.key !== 'motifs')]} />
            </Card>
          </>
        ))}
      </Loadable>
    </div>
  );
}
