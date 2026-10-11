import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApi, Loadable, Card, DataTable, Badge, Stat } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { Criticite, RisqueModal, STATUTS_RISQUE, NIVEAUX } from './Banque';

/** Registre des risques des projets, des programmes et des PTBA. */
export default function Risques({ annee, programmes }) {
  const state = useApi('/programmation/risques');
  const banque = useApi('/programmation/banque');
  const ptba = useApi(`/ptba?exercice=${annee}`, [annee]);
  const [edition, setEdition] = useState(null);
  const objets = [
    ['Projets de la banque', (banque.data?.data || []).map((p) => [`PIP:${p.id}`, `${p.code} — ${p.intitule}`])],
    ['Programmes', programmes.map((p) => [`PROGRAMME:${p.id}`, `Programme ${p.code} — ${p.libelle}`])],
    [`PTBA ${annee}`, (ptba.data?.data || []).map((p) => [`PTBA:${p.id}`, `PTBA ${p.service_sigle}`])],
  ].filter(([, o]) => o.length);
  return (
    <Loadable state={state}>
      {(d) => {
        const ouverts = d.data.filter((r) => r.statut === 'OUVERT');
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Risques ouverts" value={ouverts.length} />
              <Stat label="Dont critiques" value={ouverts.filter((r) => r.criticite >= 6).length} tone={ouverts.some((r) => r.criticite >= 6) ? 'rouge' : 'dep'} />
              <Stat label="Maîtrisés ou clos" value={d.data.length - ouverts.length} tone="vert" />
            </div>
            <Card title="Registre des risques" bodyClass="p-0" actions={d.droits.suivre && <button type="button" className="btn-primary" onClick={() => setEdition({})}><Plus size={16} /> Risque</button>}>
              <DataTable rows={d.data} onRowClick={d.droits.suivre ? (r) => setEdition(r) : undefined} empty="Aucun risque enregistré."
                columns={[
                  { key: 'libelle', header: 'Risque', render: (r) => <div><div className="font-medium">{r.libelle}</div><div className="text-xs text-slate-500">{r.objet}</div></div>, search: (r) => `${r.libelle} ${r.objet}` },
                  { key: 'criticite', header: 'Criticité', render: (r) => <Criticite p={r.probabilite} i={r.impact} /> },
                  { key: 'probabilite', header: 'Probabilité / impact', render: (r) => `${NIVEAUX[r.probabilite]} / ${NIVEAUX[r.impact]}` },
                  { key: 'mesures', header: 'Mesures', render: (r) => <span className="line-clamp-2 text-xs">{r.mesures || '—'}</span> },
                  { key: 'responsable', header: 'Responsable', render: (r) => <>{r.responsable || '—'}{r.echeance && <div className="text-xs text-slate-500">{fmtDate(r.echeance)}</div>}</> },
                  { key: 'statut', header: 'Statut', render: (r) => <Badge tone={r.statut === 'OUVERT' ? 'attention' : r.statut === 'MAITRISE' ? 'info' : 'neutre'}>{STATUTS_RISQUE[r.statut]}</Badge> },
                ]} />
            </Card>
            {edition && <RisqueModal risque={edition} objets={objets} onClose={() => setEdition(null)} onSaved={() => { setEdition(null); state.reload(); }} />}
          </div>
        );
      }}
    </Loadable>
  );
}
