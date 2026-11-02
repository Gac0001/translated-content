import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Pencil, Trash2, UserMinus, UserPlus } from 'lucide-react';
import api from '../../lib/api';
import {
  useApi, Loadable, PageHeader, Card, Badge, Button, IconButton, KeyValues, SimpleTable, FormModal, Field, InfoAlert, runAction, useConfirm,
} from '../../components/ui';
import { Attachments, Timeline } from '../../components/shared';
import { aujourdhui, fmtDate } from '../../lib/format';
import GroupeForm from './GroupeForm';

const ROLES = { COORDONNATEUR: 'Coordonnateur', MEMBRE: 'Membre', RAPPORTEUR: 'Rapporteur' };

function AjoutMembre({ groupe, onClose, onDone }) {
  const refs = useApi('/actes/referentiels');
  const [f, setF] = useState({ agent_id: '', role: 'MEMBRE' });
  const membres = new Set(groupe.membres.filter((m) => !m.date_fin).map((m) => m.agent_id));
  const enregistrer = async () => {
    await runAction(() => api.post(`/groupes/${groupe.id}/membres`, { agent_id: Number(f.agent_id), role: f.role }), 'Membre ajouté.');
    onDone();
  };
  return (
    <FormModal open title="Ajouter un membre" onClose={onClose} onSubmit={enregistrer} dirty={!!f.agent_id} disabled={!f.agent_id} submitLabel="Ajouter">
      <Field label="Agent de la Direction" required>
        <select className="input" value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })}>
          <option value="">— Choisir —</option>
          {(refs.data?.personnes || []).filter((p) => !membres.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.nom}{p.structure ? ` · ${p.structure}` : ''}</option>)}
        </select>
      </Field>
      <Field label="Rôle dans le groupe" required>
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Field>
      <p className="text-xs text-slate-600">Les représentants d’autres services s’ajoutent comme participants externes.</p>
    </FormModal>
  );
}

function AjoutParticipant({ groupe, onClose, onDone }) {
  const [f, setF] = useState({ nom: '', service: '', fonction: '', contact: '' });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const enregistrer = async () => { await runAction(() => api.post(`/groupes/${groupe.id}/participants`, f), 'Participant externe ajouté.'); onDone(); };
  return (
    <FormModal open title="Ajouter un participant externe" onClose={onClose} onSubmit={enregistrer} dirty={!!f.nom} disabled={f.nom.trim().length < 3} submitLabel="Ajouter">
      <Field label="Nom" required><input className="input" value={f.nom} onChange={up('nom')} /></Field>
      <Field label="Service ou organisme représenté"><input className="input" value={f.service} onChange={up('service')} /></Field>
      <Field label="Fonction"><input className="input" value={f.fonction} onChange={up('fonction')} /></Field>
      <Field label="Contact professionnel"><input className="input" value={f.contact} onChange={up('contact')} /></Field>
    </FormModal>
  );
}

export default function GroupeDetail() {
  const { id } = useParams();
  const state = useApi(`/groupes/${id}`, [id]);
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const fini = () => { setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(g) => {
        const actifs = g.membres.filter((m) => !m.date_fin);
        const retirer = async (m) => {
          if (!(await confirm({ title: 'Retirer le membre', message: `Retirer ${m.nom_complet} du groupe ? L’historique est conservé.`, danger: true, confirmLabel: 'Retirer' }))) return;
          await runAction(() => api.post(`/groupes/${g.id}/membres/${m.id}/retirer`), 'Membre retiré.');
          state.reload();
        };
        const retirerParticipant = async (p) => {
          if (!(await confirm({ title: 'Retirer le participant', message: `Retirer ${p.nom} ?`, danger: true, confirmLabel: 'Retirer' }))) return;
          await runAction(() => api.delete(`/groupes/${g.id}/participants/${p.id}`), 'Participant retiré.');
          state.reload();
        };
        const cloturer = async () => {
          const motif = await confirm({ title: 'Clôturer le groupe', message: 'Le groupe passera en lecture seule ; ses membres en sortent à la date du jour. Les dossiers restent consultables.', input: { label: 'Motif de la clôture', required: true, min: 5 }, confirmLabel: 'Clôturer', danger: true });
          if (!motif) return;
          await runAction(() => api.post(`/groupes/${g.id}/cloturer`, { date_fin: aujourdhui(), motif }), 'Groupe clôturé.');
          state.reload();
        };
        const modifier = async (corps) => { await runAction(() => api.put(`/groupes/${g.id}`, corps), 'Groupe modifié.'); fini(); };
        return (
          <>
            <PageHeader title={g.nom} subtitle={<span className="flex flex-wrap items-center gap-2">{g.code}<Badge tone={g.statut === 'ACTIF' ? 'succes' : 'neutre'}>{g.statut === 'ACTIF' ? 'Actif' : 'Clos'}</Badge></span>}
              breadcrumb={[{ label: 'Groupes de travail', to: '/groupes' }, { label: g.code }]}
              actions={g.droits.gerer && <Button icon={Pencil} onClick={() => setModal('modifier')}>Modifier</Button>}
              menu={[g.droits.gerer && { label: 'Clôturer le groupe', icon: Lock, danger: true, onClick: cloturer }]} />
            {g.statut === 'CLOS' && <div className="mb-4"><InfoAlert>Groupe clos le {fmtDate(g.date_fin)} : {g.motif_cloture}</InfoAlert></div>}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card title="Groupe">
                  <KeyValues items={[
                    ['Objet', g.objet], ['Acte de création', g.acte ? `${g.acte.numero} — ${g.acte.reference}` : g.acte_reference],
                    ['Période', `depuis le ${fmtDate(g.date_debut)}${g.date_fin ? ` jusqu’au ${fmtDate(g.date_fin)}` : ''}`],
                  ]} />
                  <p className="mt-3 text-xs text-slate-600">Un groupe de travail ne compte pas dans l’effectif ; l’appartenance ne modifie ni l’affectation, ni le grade, ni le rôle de ses membres.</p>
                </Card>
                <Card title={`Membres (${actifs.length})`} bodyClass="p-0" actions={g.droits.gerer && <Button icon={UserPlus} onClick={() => setModal('membre')}>Ajouter</Button>}>
                  <SimpleTable label="Membres du groupe" dense rows={g.membres} empty="Aucun membre."
                    rowClassName={(m) => (m.date_fin ? 'text-slate-500' : '')}
                    columns={[
                      { key: 'nom', header: 'Agent', render: (m) => <span className="font-medium">{m.nom_complet}</span> },
                      { key: 'role', header: 'Rôle', render: (m) => <Badge tone={m.role === 'COORDONNATEUR' ? 'marine' : m.role === 'RAPPORTEUR' ? 'info' : 'neutre'}>{m.role_libelle}</Badge> },
                      { key: 'structure', header: 'Structure', render: (m) => <span className="text-xs">{m.structure}{m.grade ? ` · grade ${m.grade}` : ''}</span> },
                      { key: 'periode', header: 'Période', render: (m) => <span className="text-xs">{fmtDate(m.date_debut)}{m.date_fin ? ` → ${fmtDate(m.date_fin)}` : ''}</span> },
                      { key: 'x', header: '', render: (m) => (g.droits.gerer && !m.date_fin ? <IconButton label={`Retirer ${m.nom_complet}`} icon={UserMinus} size={15} className="p-1 text-red-700" onClick={() => retirer(m)} /> : null) },
                    ]} />
                </Card>
                <Card title={`Participants externes (${g.participants.length})`} bodyClass="p-0" actions={g.droits.gerer && <Button icon={UserPlus} onClick={() => setModal('participant')}>Ajouter</Button>}>
                  <SimpleTable label="Participants externes" dense rows={g.participants} empty="Aucun participant externe."
                    columns={[
                      { key: 'nom', header: 'Nom' }, { key: 'service', header: 'Service ou organisme', render: (p) => p.service || '—' },
                      { key: 'fonction', header: 'Fonction', render: (p) => p.fonction || '—' }, { key: 'contact', header: 'Contact', render: (p) => p.contact || '—' },
                      { key: 'x', header: '', render: (p) => (g.droits.gerer ? <IconButton label={`Retirer ${p.nom}`} icon={Trash2} size={15} className="p-1 text-red-700" onClick={() => retirerParticipant(p)} /> : null) },
                    ]} />
                </Card>
              </div>
              <div className="space-y-4">
                {g.droits.dossiers && <Card title="Dossiers du groupe"><Attachments type="GROUPE" id={g.id} canUpload={g.droits.deposer} /></Card>}
                <Card title="Historique"><Timeline items={g.historique} /></Card>
              </div>
            </div>
            {modal === 'membre' && <AjoutMembre groupe={g} onClose={() => setModal(null)} onDone={fini} />}
            {modal === 'participant' && <AjoutParticipant groupe={g} onClose={() => setModal(null)} onDone={fini} />}
            {modal === 'modifier' && <GroupeForm initial={{ nom: g.nom, objet: g.objet, acte_reference: g.acte_reference || '', date_debut: g.date_debut, date_fin: g.date_fin || '' }} onClose={() => setModal(null)} onSubmit={modifier} />}
          </>
        );
      }}
    </Loadable>
  );
}
