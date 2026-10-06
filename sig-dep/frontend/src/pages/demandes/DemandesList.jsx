import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, DataTable, Badge, PrioriteBadge, InfoAlert, Modal, Field, Select, runAction } from '../../components/ui';
import { COLORS } from '../../lib/labels';
import { fmtDate, fmtDateTime } from '../../lib/format';

export const ETATS_DEMANDE = {
  ENVOYEE: ['En attente de réponse', COLORS.jaune], REPONDUE: ['Répondue', COLORS.vert], CLOSE: ['Close', COLORS.gris],
};

function NouvelleDemande({ onClose, onCreated }) {
  const [f, setF] = useState({ objet: '', question: '', priorite: 'NORMALE', echeance: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const envoyer = async () => {
    const r = await runAction(() => api.post('/demandes-information', { ...f, echeance: f.echeance || null }), 'Demande adressée au Directeur.');
    onCreated(r.data.id);
  };
  return (
    <Modal open size="lg" title="Demande d’information au Directeur" onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" disabled={f.objet.trim().length < 3 || f.question.trim().length < 3} onClick={envoyer}><Send size={16} /> Envoyer</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Objet" required className="sm:col-span-2"><input className="input" value={f.objet} onChange={up('objet')} /></Field>
        <Field label="Question" required className="sm:col-span-2"><textarea className="input" rows={6} value={f.question} onChange={up('question')} /></Field>
        <Field label="Priorité"><select className="input" value={f.priorite} onChange={up('priorite')}><option value="BASSE">Basse</option><option value="NORMALE">Normale</option><option value="HAUTE">Haute</option><option value="URGENTE">Urgente</option></select></Field>
        <Field label="Réponse attendue pour le"><input type="date" className="input" min={new Date().toISOString().slice(0, 10)} value={f.echeance} onChange={up('echeance')} /></Field>
      </div>
    </Modal>
  );
}

/** Demandes d’information du Secrétaire Général au Directeur. */
export default function DemandesList() {
  const can = useAuth((s) => s.can);
  const [statut, setStatut] = useState('');
  const [nouvelle, setNouvelle] = useState(false);
  const state = useApi(`/demandes-information${statut ? `?statut=${statut}` : ''}`, [statut]);
  const navigate = useNavigate();
  const sg = can('demandes_info.emettre');
  return (
    <>
      <PageHeader title="Demandes d’information" subtitle={sg ? 'Vos questions au Directeur et ses réponses.' : 'Questions du Secrétaire Général auxquelles le Directeur répond.'}
        breadcrumb={[{ label: 'Activités' }, { label: 'Demandes d’information' }]}
        actions={sg && <button type="button" className="btn-primary" onClick={() => setNouvelle(true)}><Plus size={16} /> Nouvelle demande</button>} />
      <InfoAlert>Une demande d’information ne crée aucune tâche interne : le Directeur y répond directement, pièces jointes à l’appui. Le Secrétaire Général ne voit que la réponse, jamais les brouillons de la Direction.</InfoAlert>
      <Loadable state={state}>
        {(d) => (
          <div className="mt-4">
            <DataTable rows={d.data} onRowClick={(x) => navigate(`/demandes-information/${x.id}`)} empty="Aucune demande d’information."
              toolbar={<Select value={statut} onChange={setStatut} placeholder="Tous les statuts" options={Object.entries(ETATS_DEMANDE).map(([k, v]) => [k, v[0]])} />}
              columns={[
                { key: 'reference', header: 'Référence', render: (x) => <span className="font-mono text-xs">{x.reference}</span> },
                { key: 'objet', header: 'Objet', render: (x) => <div><div className="font-medium">{x.objet}</div><div className="text-xs text-slate-500">{fmtDateTime(x.created_at)}</div></div> },
                { key: 'priorite', header: 'Priorité', render: (x) => <PrioriteBadge value={x.priorite} /> },
                { key: 'echeance', header: 'Échéance', render: (x) => <span className={x.en_retard ? 'font-semibold text-red-700' : ''}>{fmtDate(x.echeance)}{x.en_retard ? ' (dépassée)' : ''}</span> },
                { key: 'statut', header: 'Statut', render: (x) => <Badge className={ETATS_DEMANDE[x.statut][1]}>{ETATS_DEMANDE[x.statut][0]}</Badge> },
              ]} />
          </div>
        )}
      </Loadable>
      {nouvelle && <NouvelleDemande onClose={() => setNouvelle(false)} onCreated={(id) => navigate(`/demandes-information/${id}`)} />}
    </>
  );
}
