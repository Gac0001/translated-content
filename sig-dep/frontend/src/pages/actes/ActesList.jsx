import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApi, Loadable, PageHeader, DataTable, Badge, StatusBadge, InfoAlert, Select } from '../../components/ui';
import { TYPES_ACTE, EFFETS_ACTE, STATUTS } from '../../lib/labels';
import { fmtDate } from '../../lib/format';

const STATUTS_ACTE = ['BROUILLON', 'SOUMIS', 'VALIDE', 'REFUSE', 'REVOQUE', 'EXPIRE', 'REMPLACE'];

/** Registre des actes administratifs : nominations, affectations, intérims, désignations, fins de fonction. */
export default function ActesList() {
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');
  const [vigueur, setVigueur] = useState(false);
  const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(statut ? { statut } : {}), ...(vigueur ? { en_vigueur: '1' } : {}) }).toString();
  const state = useApi(`/actes${qs ? `?${qs}` : ''}`, [qs]);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Actes administratifs" subtitle="Nominations, affectations, intérims, désignations et fins de fonction : chaque droit temporaire repose sur un acte enregistré."
        breadcrumb={[{ label: 'Administration' }, { label: 'Actes administratifs' }]}
        actions={state.data?.droits?.preparer && <Link to="/actes/nouveau" className="btn-primary"><Plus size={16} /> Enregistrer un acte</Link>} />
      <InfoAlert>
        Un acte est préparé par le Bureau Secrétariat de Direction avec la copie de l’acte signé, puis validé par le Directeur. Les actes relatifs au poste de Directeur
        sont enregistrés par l’Admin Système et validés par le Secrétaire Général. Un acte validé ne se modifie plus : il se corrige par un rectificatif ou se révoque.
      </InfoAlert>
      <Loadable state={state}>
        {(d) => (
          <div className="mt-4">
            <DataTable rows={d.data} onRowClick={(a) => navigate(`/actes/${a.id}`)}
              toolbar={(
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={type} onChange={setType} placeholder="Tous les types" options={Object.entries(TYPES_ACTE)} />
                  <Select value={statut} onChange={setStatut} placeholder="Tous les statuts" options={STATUTS_ACTE.map((s) => [s, STATUTS[s]?.[0] || s])} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vigueur} onChange={(e) => setVigueur(e.target.checked)} /> En vigueur aujourd’hui</label>
                </div>
              )}
              empty="Aucun acte enregistré."
              columns={[
                { key: 'numero', header: 'N°', render: (a) => <span className="font-mono text-xs">{a.numero}</span> },
                { key: 'type', header: 'Type', render: (a) => a.typeLibelle },
                { key: 'objet', header: 'Objet', render: (a) => <div><div className="font-medium">{a.objet}</div><div className="text-xs text-slate-500">{a.reference} · {fmtDate(a.date_acte)}</div></div>, search: (a) => `${a.objet} ${a.reference}` },
                { key: 'personne', header: 'Personne concernée', render: (a) => a.personne || '—' },
                { key: 'periode', header: 'Période', render: (a) => (a.date_debut ? `${fmtDate(a.date_debut)} → ${fmtDate(a.date_fin)}` : '—') },
                { key: 'statut', header: 'Statut', render: (a) => <div className="flex flex-wrap gap-1"><StatusBadge value={a.statut} />{a.effet && <Badge className={EFFETS_ACTE[a.effet][1]}>{EFFETS_ACTE[a.effet][0]}</Badge>}</div> },
                { key: 'validation_par', header: 'Validation', render: (a) => (a.validation_par === 'SECRETAIRE_GENERAL' ? 'Secrétaire Général' : 'Directeur') },
              ]} />
          </div>
        )}
      </Loadable>
    </>
  );
}
