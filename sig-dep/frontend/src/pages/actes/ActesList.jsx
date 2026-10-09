import { Link, useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { useApi, PageHeader, DataTable, Badge, StatusBadge, InfoAlert, Select, useListParams } from '../../components/ui';
import { TYPES_ACTE, EFFETS_ACTE, STATUTS } from '../../lib/labels';
import { fmtDate } from '../../lib/format';

const STATUTS_ACTE = ['BROUILLON', 'SOUMIS', 'VALIDE', 'REFUSE', 'REVOQUE', 'EXPIRE', 'REMPLACE'];

/** Registre des actes administratifs : nominations, affectations, intérims, désignations, fins de fonction. */
export default function ActesList() {
  const { valeurs: v, set } = useListParams({ type: '', statut: '', en_vigueur: '' });
  const qs = new URLSearchParams(Object.entries({ type: v.type, statut: v.statut, en_vigueur: v.en_vigueur }).filter(([, x]) => x)).toString();
  const state = useApi(`/actes${qs ? `?${qs}` : ''}`, [qs]);
  const navigate = useNavigate();
  const actifs = !!(qs || v.q);
  const effacer = <button type="button" className="btn-ghost btn-sm" onClick={() => set({ type: '', statut: '', en_vigueur: '', q: '' })}><X size={14} aria-hidden /> Effacer les filtres</button>;
  return (
    <>
      <PageHeader title="Actes administratifs" subtitle="Nominations, affectations, intérims, désignations et fins de fonction : chaque droit temporaire repose sur un acte enregistré."
        breadcrumb={[{ label: 'Administration' }, { label: 'Actes administratifs' }]}
        actions={state.data?.droits?.preparer && <Link to="/actes/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Enregistrer un acte</Link>} />
      <InfoAlert>
        Un acte est préparé par le Bureau Secrétariat de Direction avec la copie de l’acte signé, puis validé par le Directeur. Les actes relatifs au poste de Directeur
        sont enregistrés par l’Admin Système et validés par le Secrétaire Général. Un acte validé ne se modifie plus : il se corrige par un rectificatif ou se révoque.
      </InfoAlert>
          <div className="mt-4">
            <DataTable rows={state.data?.data || []} loading={state.loading} error={state.error} onRetry={state.reload} label="Registre des actes administratifs"
              controle={{ q: v.q, page: v.page, tri: v.tri }} onControle={set} onRowClick={(a) => navigate(`/actes/${a.id}`)}
              toolbar={<>
                <Select label="Type d’acte" value={v.type} onChange={(x) => set({ type: x })} placeholder="Tous les types" options={Object.entries(TYPES_ACTE)} />
                <Select label="Statut" value={v.statut} onChange={(x) => set({ statut: x })} placeholder="Tous les statuts" options={STATUTS_ACTE.map((s) => [s, STATUTS[s]?.[0] || s])} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v.en_vigueur} onChange={(e) => set({ en_vigueur: e.target.checked ? '1' : '' })} /> En vigueur aujourd’hui</label>
                {actifs && effacer}
              </>}
              empty={actifs ? 'Aucun acte pour ces critères.' : 'Aucun acte enregistré.'} emptyAction={actifs && effacer}
              columns={[
                { key: 'numero', header: 'N°', sortable: true, render: (a) => <span className="font-mono text-xs">{a.numero}</span> },
                { key: 'type', header: 'Type', render: (a) => a.typeLibelle },
                { key: 'objet', header: 'Objet', render: (a) => <div><div className="font-medium">{a.objet}</div><div className="text-xs text-slate-500">{a.reference} · {fmtDate(a.date_acte)}</div></div>, search: (a) => `${a.objet} ${a.reference}` },
                { key: 'personne', header: 'Personne concernée', render: (a) => a.personne || '—' },
                { key: 'periode', header: 'Période', render: (a) => (a.date_debut ? `${fmtDate(a.date_debut)} → ${fmtDate(a.date_fin)}` : '—') },
                { key: 'statut', header: 'Statut', render: (a) => <div className="flex flex-wrap gap-1"><StatusBadge value={a.statut} />{a.effet && <Badge className={EFFETS_ACTE[a.effet][1]}>{EFFETS_ACTE[a.effet][0]}</Badge>}</div> },
                { key: 'validation_par', header: 'Validation', render: (a) => (a.validation_par === 'SECRETAIRE_GENERAL' ? 'Secrétaire Général' : 'Directeur') },
              ]} />
          </div>
    </>
  );
}
