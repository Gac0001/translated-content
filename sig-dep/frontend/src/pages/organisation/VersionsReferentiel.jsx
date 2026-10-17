import { useState } from 'react';
import { History } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, Card, Badge, Button, SimpleTable, FormModal, Field, Modal, InfoAlert, runAction } from '../../components/ui';
import { aujourdhui, fmtDate, fmtDateTime } from '../../lib/format';

const PARTIES = { grades: 'Grades', postes: 'Postes organiques', effectif_reference: 'Effectif de référence', effectif_structure: 'Postes d’emploi par structure' };
const NATURES = { AJOUT: ['Ajout', 'succes'], MODIFICATION: ['Modification', 'info'], RETRAIT: ['Retrait', 'danger'] };
const resume = (x) => (x ? Object.entries(x).filter(([k]) => !['code', 'actif'].includes(k)).map(([k, v]) => `${k} : ${v ?? '—'}`).join(' · ') : '—');

function Changements({ lignes }) {
  return (
    <SimpleTable label="Changements" dense rowKey="cle" rows={lignes.map((c, i) => ({ ...c, cle: `${c.partie}-${c.element}-${i}` }))} empty="Aucun changement."
      columns={[
        { key: 'partie', header: 'Partie', render: (c) => PARTIES[c.partie] || c.partie },
        { key: 'element', header: 'Élément' },
        { key: 'nature', header: 'Nature', render: (c) => <Badge tone={NATURES[c.nature][1]}>{NATURES[c.nature][0]}</Badge> },
        { key: 'detail', header: 'Détail', render: (c) => <span className="text-xs">{c.nature === 'RETRAIT' ? resume(c.avant) : resume(c.apres)}</span> },
      ]} />
  );
}

/**
 * Versions du référentiel (grades, postes d’emploi, effectif organique) : chaque version consignée
 * porte sa source et sa date d’application ; les modifications non encore consignées sont signalées.
 */
export default function VersionsReferentiel() {
  const state = useApi('/organisation/referentiel/versions');
  const [form, setForm] = useState(null);
  const [vue, setVue] = useState(null);
  const detail = useApi(vue ? `/organisation/referentiel/versions/${vue}` : null, [vue]);
  const consigner = async () => {
    await runAction(() => api.post('/organisation/referentiel/versions', form), 'Nouvelle version du référentiel consignée.');
    setForm(null);
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          {d.enAttente.length > 0 && (
            <Card title={`Modifications non consignées (${d.enAttente.length})`} bodyClass="p-0"
              actions={d.droits.consigner && <Button variant="primary" icon={History} onClick={() => setForm({ source: '', date_application: aujourdhui(), observation: '' })}>Consigner une version</Button>}>
              <div className="p-3"><InfoAlert tone="warning">Le référentiel a changé depuis la dernière version : consignez une version en indiquant l’acte qui fonde ces changements et sa date d’application.</InfoAlert></div>
              <Changements lignes={d.enAttente} />
            </Card>
          )}
          <Card title="Versions consignées" bodyClass="p-0">
            <SimpleTable label="Versions du référentiel" rows={d.data} onRowClick={(v) => setVue(v.id)}
              columns={[
                { key: 'numero', header: 'Version', render: (v) => <b>V{v.numero}</b> },
                { key: 'date_application', header: 'Application', render: (v) => fmtDate(v.date_application) },
                { key: 'source', header: 'Source' },
                { key: 'changements', header: 'Changements', align: 'right', render: (v) => (v.numero === 1 ? 'initiale' : v.changements) },
                { key: 'auteur', header: 'Consignée', render: (v) => <span className="text-xs">{fmtDateTime(v.created_at)}{v.auteur ? ` · ${v.auteur}` : ''}</span> },
              ]} />
          </Card>
          {form && (
            <FormModal open title="Consigner une version du référentiel" onClose={() => setForm(null)} onSubmit={consigner} dirty submitLabel="Consigner" disabled={form.source.trim().length < 5 || !form.date_application}>
              <Field label="Source (acte ou texte)" required hint="Ex. Arrêté n° … portant cadre organique"><input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
              <Field label="Date d’application" required><input type="date" className="input" value={form.date_application} onChange={(e) => setForm({ ...form, date_application: e.target.value })} /></Field>
              <Field label="Observation"><textarea className="input" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></Field>
            </FormModal>
          )}
          <Modal open={!!vue} title={detail.data ? `Version ${detail.data.numero} du référentiel` : 'Version du référentiel'} onClose={() => setVue(null)} size="lg">
            <Loadable state={detail}>
              {(v) => (
                <div className="space-y-3">
                  <p className="text-sm text-slate-700"><b>Source :</b> {v.source} · <b>Application :</b> {fmtDate(v.date_application)}{v.observation ? ` · ${v.observation}` : ''}</p>
                  {v.numero === 1 ? <p className="text-sm text-slate-600">Version initiale : {v.contenu.grades.length} grades, {v.contenu.postes.length} postes organiques, {v.contenu.effectif_structure.length} postes d’emploi par structure.</p> : <Changements lignes={v.changements} />}
                </div>
              )}
            </Loadable>
          </Modal>
        </div>
      )}
    </Loadable>
  );
}
