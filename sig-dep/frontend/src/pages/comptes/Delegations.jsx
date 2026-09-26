import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, InfoAlert, Field, runAction, useConfirm, DataTable, Badge } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

export default function Delegations() {
  const state = useApi('/users/delegations');
  const confirm = useConfirm();
  const [perm, setPerm] = useState('');
  const [motif, setMotif] = useState('');
  const add = async (chefId) => {
    await runAction(() => api.post(`/users/${chefId}/delegations`, { permission: perm, motif }), 'Délégation accordée.');
    setPerm(''); setMotif(''); state.reload();
  };
  const revoke = async (d) => {
    if (!(await confirm({ title: 'Révoquer la délégation', message: `Révoquer « ${d.libelle} » ?`, danger: true }))) return;
    await runAction(() => api.delete(`/users/delegations/${d.id}`), 'Délégation révoquée.');
    state.reload();
  };
  return (
    <>
      <PageHeader title="Délégations du Directeur" breadcrumb={[{ label: 'Comptes', to: '/comptes' }, { label: 'Délégations' }]} />
      <InfoAlert>Le Directeur peut autoriser le Chef du Bureau Secrétariat de Direction à effectuer certaines opérations administratives (préparer les comptes, suivre le personnel, préparer les présences, enregistrer les courriers, transmettre les dossiers). Ces délégations ne lui confèrent jamais le rang ni les pouvoirs d’un Chef de Division.</InfoAlert>
      <Loadable state={state}>
        {(d) => (
          <div className="mt-4 space-y-4">
            {d.chefSecretariat ? (
              <Card title={`Nouvelle délégation — ${d.chefSecretariat.username}`}>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Field label="Opération déléguée"><select className="input" value={perm} onChange={(e) => setPerm(e.target.value)}><option value="">— Choisir —</option>{d.delegables.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select></Field>
                  <Field label="Motif / référence"><input className="input" value={motif} onChange={(e) => setMotif(e.target.value)} /></Field>
                  <button type="button" className="btn-primary" disabled={!perm || motif.trim().length < 3} onClick={() => add(d.chefSecretariat.id)}><Plus size={16} /> Accorder</button>
                </div>
              </Card>
            ) : <InfoAlert tone="warning">Aucun Chef du Bureau Secrétariat de Direction n’est actuellement affecté.</InfoAlert>}
            <DataTable rows={d.data} columns={[
              { key: 'libelle', header: 'Opération' }, { key: 'username', header: 'Bénéficiaire' },
              { key: 'motif', header: 'Motif' }, { key: 'granted_at', header: 'Accordée le', render: (x) => `${fmtDateTime(x.granted_at)} par ${x.granted_by_username}` },
              { key: 'etat', header: 'État', render: (x) => (x.revoked_at ? <Badge>Révoquée le {fmtDateTime(x.revoked_at)}</Badge> : <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-200">Active</Badge>) },
              { key: 'a', header: '', render: (x) => !x.revoked_at && <button type="button" className="text-red-600" onClick={() => revoke(x)} aria-label="Révoquer"><Trash2 size={16} /></button> },
            ]} />
          </div>
        )}
      </Loadable>
    </>
  );
}
