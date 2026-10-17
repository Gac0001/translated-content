import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, Card, Badge, Button, KpiTile, SimpleTable, FormModal, Field, NumberInput, runAction } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtDate } from '../../lib/format';

const TON = { CONFORME: 'succes', VACANCE: 'attention', SUREFFECTIF: 'orange' };

/** Modification d’un poste d’emploi (nombre prévu pour une structure et un grade), avec sa source. */
function PosteEmploi({ structures, colonnes, initial, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const enregistrer = async () => {
    const critere_type = f.critere === 'F-HUI' ? 'FONCTION' : 'GRADE';
    await runAction(() => api.put('/organisation/effectifs/structures', { structure_code: f.structure, critere_type, critere_code: f.critere, nombre: f.nombre ?? 0, source: f.source }), 'Poste d’emploi enregistré : consignez une nouvelle version du référentiel.');
    onSaved();
  };
  return (
    <FormModal open title="Poste d’emploi du cadre organique" onClose={onClose} onSubmit={enregistrer} dirty disabled={!f.structure || !f.critere || (f.source || '').trim().length < 5}>
      <Field label="Structure" required>
        <select className="input" value={f.structure} onChange={(e) => setF({ ...f, structure: e.target.value })}>
          <option value="">— Choisir —</option>
          {structures.map((s) => <option key={s.code} value={s.code}>{s.code_organique ? `${s.code_organique} · ` : ''}{s.nom}</option>)}
        </select>
      </Field>
      <Field label="Grade ou emploi" required>
        <select className="input" value={f.critere} onChange={(e) => setF({ ...f, critere: e.target.value })}>
          <option value="">— Choisir —</option>
          {colonnes.map((c) => <option key={c.critere} value={c.critere}>{c.libelle}</option>)}
        </select>
      </Field>
      <Field label="Nombre de postes prévus" required><NumberInput value={f.nombre} min={0} max={100} onChange={(v) => setF({ ...f, nombre: v })} /></Field>
      <Field label="Source (acte ou décision)" required hint="Ex. Arrêté portant cadre organique, note de service…"><input className="input" value={f.source || ''} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
    </FormModal>
  );
}

/**
 * Effectif organique et effectif réel par structure et par grade (cahier, §§ 10 et 11) : tableau
 * croisé, vacances, sureffectifs, promus en attente de poste et intérims actifs.
 */
export default function EffectifStructures() {
  const state = useApi('/organisation/effectifs/structures');
  const grades = useApi('/organisation/cadre');
  const can = useAuth((s) => s.can);
  const [edition, setEdition] = useState(null);
  return (
    <Loadable state={state}>
      {(d) => {
        const colonnesEdition = [
          ...(grades.data?.grades || []).filter((g) => g.code !== 'SG' && g.code !== 'HUI').map((g) => ({ critere: g.code, libelle: `${g.code_officiel} — ${g.libelle}` })),
          { critere: 'F-HUI', libelle: 'HUI — Huissier (fonction)' },
        ];
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-slate-700">Effectif organique (postes d’emploi du cadre organique) comparé à l’effectif réel : les Agents réellement affectés ne sont jamais refusés ; les écarts signalent les vacances et les sureffectifs. Les groupes de travail ne comptent pas dans l’effectif.</p>
              <div className="ml-auto flex gap-2">
                {can('cadre.gerer') && <Button icon={Pencil} onClick={() => setEdition({ structure: '', critere: '', nombre: 1, source: '' })}>Poste d’emploi</Button>}
                <ExportButtons base="/organisation/effectifs/export" print={false} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiTile label="Effectif organique" valeur={String(d.totaux.prevu)} />
              <KpiTile label="Effectif réel" valeur={String(d.totaux.reel)} tone="vert" />
              <KpiTile label="Vacances" valeur={String(d.totaux.vacances)} tone="jaune" />
              <KpiTile label="Sureffectifs" valeur={String(d.totaux.sureffectifs)} tone="rouge" />
              <KpiTile label="Promus en attente" valeur={String(d.totaux.promus)} tone="gris" />
              <KpiTile label="Intérims actifs" valeur={String(d.totaux.interims)} tone="gris" />
            </div>
            <Card title="Par structure et par grade (réel / organique)" bodyClass="p-0">
              <SimpleTable label="Effectif par structure et par grade" rowKey="code" dense figee rows={d.structures}
                footer={[{ code: 'total', nom: 'Ensemble de la Direction', prevu: d.totaux.prevu, reel: d.totaux.reel, vacances: d.totaux.vacances, sureffectifs: d.totaux.sureffectifs, detail: d.colonnes.map((c) => ({ critere: c.critere, prevu: d.structures.reduce((t, s) => t + (s.detail.find((x) => x.critere === c.critere)?.prevu || 0), 0), reel: d.structures.reduce((t, s) => t + (s.detail.find((x) => x.critere === c.critere)?.reel || 0), 0) })) }]}
                columns={[
                  { key: 'nom', header: 'Structure', render: (s) => <span className={`whitespace-nowrap ${s.niveau === 2 ? 'pl-4' : ''} ${s.niveau < 2 ? 'font-semibold' : ''}`}>{s.code_organique ? <span className="mr-1 text-xs text-slate-600">{s.code_organique}</span> : null}{s.nom}</span> },
                  ...d.colonnes.map((c) => ({
                    key: c.critere, header: <span title={c.libelle}>{c.libelle.split(' — ')[0]}</span>, align: 'center', render: (s) => {
                      const x = s.detail.find((y) => y.critere === c.critere);
                      if (!x || (!x.prevu && !x.reel)) return <span className="text-slate-500">·</span>;
                      const ecart = x.reel - x.prevu;
                      return <span className={`tabular-nums ${ecart > 0 ? 'font-semibold text-orange-800' : ecart < 0 ? 'font-semibold text-amber-800' : ''}`} title={`${c.libelle} : réel ${x.reel}, organique ${x.prevu}`}>{x.reel} / {x.prevu}</span>;
                    },
                  })),
                  { key: 'total', header: 'Total', align: 'center', render: (s) => <b className="tabular-nums">{s.reel} / {s.prevu}</b> },
                  { key: 'situation', header: 'Situation', render: (s) => (s.code === 'total' ? null : <span className="flex flex-wrap gap-1">{s.vacances > 0 && <Badge tone={TON.VACANCE}>{s.vacances} vacance(s)</Badge>}{s.sureffectifs > 0 && <Badge tone={TON.SUREFFECTIF}>{s.sureffectifs} sureffectif(s)</Badge>}{!s.vacances && !s.sureffectifs && <Badge tone={TON.CONFORME}>Conforme</Badge>}</span>) },
                ]} />
              <p className="border-t px-3 py-2 text-xs text-slate-600">Lecture : « 3 / 2 » = 3 agents en fonction pour 2 postes prévus. En gras : écart à l’effectif organique.</p>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Promus en attente de poste" bodyClass="p-0">
                <SimpleTable label="Promus en attente de poste" dense rows={d.promusEnAttente} empty="Aucun agent promu en attente de poste."
                  columns={[
                    { key: 'nom', header: 'Agent', render: (p) => <Link className="link" to={`/personnel/${p.id}`}>{[p.prenom, p.nom, p.postnom].filter(Boolean).join(' ')}</Link> },
                    { key: 'grade', header: 'Grade', render: (p) => `${p.code_officiel} — ${p.grade}` },
                    { key: 'depuis', header: 'Depuis', render: (p) => fmtDate(p.depuis) },
                  ]} />
              </Card>
              <Card title="Intérims actifs" bodyClass="p-0">
                <SimpleTable label="Intérims actifs" dense rowKey="acteId" rows={d.interimsActifs} empty="Aucun intérim en cours."
                  columns={[
                    { key: 'poste', header: 'Poste', render: (i) => <Link className="link" to={`/actes/${i.acteId}`}>{i.poste}</Link> },
                    { key: 'interimaire', header: 'Intérimaire' },
                    { key: 'fin', header: 'Jusqu’au', render: (i) => fmtDate(i.dateFin) },
                  ]} />
              </Card>
            </div>
            {edition && <PosteEmploi structures={d.structures} colonnes={colonnesEdition} initial={edition} onClose={() => setEdition(null)} onSaved={() => { setEdition(null); state.reload(); }} />}
          </div>
        );
      }}
    </Loadable>
  );
}
