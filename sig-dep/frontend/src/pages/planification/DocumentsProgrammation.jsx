import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, Card, DataTable, StatusBadge, FormModal, FormSection, Field, InfoAlert, toast } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export const TYPES_DOC = { PAP: 'Projet Annuel de Performance', RAP: 'Rapport Annuel de Performance', CDMT: 'Cadre de Dépenses à Moyen Terme', CBMT: 'Cadre Budgétaire à Moyen Terme (plafonds du Ministère)' };

/** Documents de programmation : PAP, RAP et CDMT, générés à partir du cadre de performance et des crédits. */
export default function DocumentsProgrammation({ annee }) {
  const state = useApi('/programmation/documents');
  const navigate = useNavigate();
  const [nouveau, setNouveau] = useState(null);
  const creer = async () => {
    const annee = Number(nouveau.annee);
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new Error('Exercice invalide : saisissez une année entre 2000 et 2100.');
    const d = await api.post('/programmation/documents', { type: nouveau.type, annee });
    toast.success('Document créé.');
    navigate(`/planification/documents/${d.data.id}`);
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-4">
          <InfoAlert>Le CBMT (cadrage du Ministère du Budget) fixe les plafonds du Ministère sur trois ans ; le PAP et le RAP sont produits au format Word, le CDMT au format Excel, à partir du cadre de performance, des crédits et des parties rédigées. Circuit : préparation (Bureau Programme), vérification (Chef du Bureau Programme), consolidation (Chef de la Division Programme et Suivi), validation (Directeur).</InfoAlert>
          <Card title="Documents de programmation" bodyClass="p-0" actions={d.droits.preparer && <button type="button" className="btn-primary" onClick={() => setNouveau({ type: 'PAP', annee: String(annee) })}><Plus size={16} aria-hidden /> Nouveau document</button>}>
            <DataTable rows={d.data} onRowClick={(x) => navigate(`/planification/documents/${x.id}`)} empty="Aucun document de programmation."
              columns={[
                { key: 'reference', header: 'Référence' },
                { key: 'type', header: 'Document', render: (x) => <><b>{x.type}</b> <span className="text-slate-500">{TYPES_DOC[x.type]}</span></> },
                { key: 'annee', header: 'Exercice', render: (x) => (x.type === 'CBMT' ? `${x.annee}-${x.annee + 2}` : x.annee) },
                { key: 'statut', header: 'Statut', render: (x) => <StatusBadge value={x.statut} /> },
                { key: 'updated_at', header: 'Mis à jour', render: (x) => fmtDateTime(x.updated_at), sortValue: (x) => x.updated_at },
              ]} />
          </Card>
          {nouveau && (
            <FormModal open title="Nouveau document de programmation" submitLabel="Créer" onClose={() => setNouveau(null)} onSubmit={creer}>
              <FormSection>
                <Field label="Document"><select className="input" value={nouveau.type} onChange={(e) => setNouveau({ ...nouveau, type: e.target.value })}>{Object.entries(TYPES_DOC).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></Field>
                <Field label="Exercice" hint={nouveau.type === 'CBMT' ? `Première année de la période : ${nouveau.annee}-${Number(nouveau.annee) + 2}.` : nouveau.type === 'RAP' ? 'Exercice dont on rend compte.' : nouveau.type === 'CDMT' ? `Projections ${Number(nouveau.annee) + 1}-${Number(nouveau.annee) + 3}.` : 'Exercice budgétaire du projet de loi de finances.'}><input className="input" type="number" min="2000" max="2100" value={nouveau.annee} onChange={(e) => setNouveau({ ...nouveau, annee: e.target.value })} /></Field>
              </FormSection>
            </FormModal>
          )}
        </div>
      )}
    </Loadable>
  );
}
