import { Link } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, FileDown, ShieldCheck, Clock, ListChecks, MinusCircle, UserCheck, UserPlus } from 'lucide-react';
import api, { download } from '../../lib/api';
import { fmtDateTime, nomComplet } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useApi, useConfirm, runAction, toast, PageHeader, Card, Stat, Loadable, InfoAlert, DataTable, Badge, Progress } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { COLORS } from '../../lib/labels';

const STATUT = {
  NON_VALIDEE: ['Non validée', COLORS.neutre],
  VALIDEE: ['Validée', COLORS.succes],
  A_REVALIDER: ['À revalider', COLORS.attention],
};
const CHAMPS = { matricule: 'matricule', grade_id: 'grade', division_id: 'Division', bureau_id: 'Bureau' };

const structure = (a) => (a.bureau_nom
  ? <>{a.bureau_nom}{a.est_secretariat_direction ? <span className="block text-xs text-slate-500">Rattaché au Directeur</span> : a.division_nom && <span className="block text-xs text-slate-500">{a.division_nom}</span>}</>
  : a.division_nom || (a.niveau === 'DIRECTION' ? 'Direction (Directeur)' : <span className="text-amber-700">Sans affectation</span>));

/** Mise en service des comptes : étapes Directeur → validation → Secrétariat → autres structures. */
export function Progression({ p }) {
  const can = useAuth((s) => s.can);
  const pct = (x) => (x.total ? Math.round((100 * x.avecCompte) / x.total) : 0);
  const etapes = [
    { ok: p.directeur, titre: 'Compte du Directeur', detail: p.directeur ? 'Créé' : 'À créer par l’Admin', action: !p.directeur && can('compte.creer_initial') && { to: '/comptes/nouveau', label: 'Créer le compte' } },
    {
      ok: p.statutListe === 'VALIDEE', titre: 'Liste déclarative validée',
      detail: p.validation ? `${p.statutListe === 'VALIDEE' ? 'Validée' : 'À revalider'} — ${fmtDateTime(p.validation.valide_at)}` : (p.secretariat.total + p.autres.total ? 'En attente du Directeur' : 'Liste vide : le Directeur importe la liste officielle'),
      action: p.statutListe !== 'VALIDEE' && (p.secretariat.total + p.autres.total === 0
        ? can('personnel.gerer', 'personnel.suivre') && { to: '/personnel/import', label: 'Importer la liste' }
        : can('liste.valider') && { to: '/liste-declarative', label: 'Vérifier et valider' }),
    },
    { ok: p.secretariat.total > 0 && p.secretariat.avecCompte === p.secretariat.total, titre: 'Bureau Secrétariat de Direction', detail: `${p.secretariat.avecCompte} / ${p.secretariat.total} compte(s) — enrôlés par l’Admin sur autorisation du Directeur${p.secretariat.autorises ? ` (${p.secretariat.autorises} autorisé(s) en attente)` : ''}`, pct: pct(p.secretariat) },
    { ok: p.autres.total > 0 && p.autres.avecCompte === p.autres.total, titre: 'Divisions et autres Bureaux', detail: `${p.autres.avecCompte} / ${p.autres.total} compte(s) — enrôlés par le Secrétariat`, pct: pct(p.autres) },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {etapes.map((e, i) => (
        <li key={i} className={`rounded-md border p-3 ${e.ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200'}`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            {e.ok ? <CheckCircle2 size={16} className="text-emerald-700" /> : <Clock size={16} className="text-slate-400" />}
            <span>{i + 1}. {e.titre}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">{e.detail}</p>
          {e.pct !== undefined && <div className="mt-2"><Progress value={e.pct} /></div>}
          {e.action && <Link to={e.action.to} className="mt-2 inline-block text-xs font-medium text-dep-700 hover:underline">{e.action.label} →</Link>}
        </li>
      ))}
    </ol>
  );
}

export default function ListeDeclarative() {
  const state = useApi('/liste-declarative');
  const confirm = useConfirm();
  const can = useAuth((s) => s.can);
  const d = state.data;

  const valider = async () => {
    const r = await confirm({
      title: 'Valider la liste déclarative',
      message: `Vous certifiez que les ${d.agents.length} agent(s) de la liste sont affectés à la Direction d’Études et Planification, avec la matricule, le grade et la structure indiqués. L’enrôlement de leurs comptes pourra alors commencer.`,
      confirmLabel: 'Valider la liste', input: { label: 'Observation (facultative)' },
    });
    if (r === false) return;
    await runAction(() => api.post('/liste-declarative/valider', { commentaire: r || undefined }), 'Liste déclarative validée.');
    state.reload();
  };
  const autorisation = async (a, autorise) => {
    if (autorise && !(await confirm({ title: 'Autoriser l’enrôlement', message: `Autoriser l’Admin Système à créer le compte de ${nomComplet(a)} (Bureau Secrétariat de Direction) ?`, confirmLabel: 'Autoriser' }))) return;
    await runAction(() => api.post(`/liste-declarative/agents/${a.agent_id}/${autorise ? 'autoriser-enrolement' : 'retirer-autorisation'}`), autorise ? 'Enrôlement autorisé.' : 'Autorisation retirée.');
    state.reload();
  };
  const inscription = async (a, action) => {
    if (action === 'retirer' && !(await confirm({ title: 'Retirer de la liste', message: `Retirer ${nomComplet(a)} de la liste déclarative ? La liste devra être revalidée.`, danger: true, confirmLabel: 'Retirer' }))) return;
    await runAction(() => api.post(`/liste-declarative/agents/${a.agent_id}/${action}`), action === 'retirer' ? 'Agent retiré de la liste.' : 'Agent inscrit.');
    state.reload();
  };

  const columns = [
    { key: 'nom', header: 'Agent', search: (a) => `${nomComplet(a)} ${a.matricule}`, render: (a) => <Link to={`/personnel/${a.agent_id}`} className="font-medium text-dep-800 hover:underline" onClick={(e) => e.stopPropagation()}>{[a.nom, a.postnom, a.prenom].filter(Boolean).join(' ')}</Link> },
    { key: 'matricule', header: 'Matricule', className: 'whitespace-nowrap' },
    { key: 'grade_code', header: 'Grade', render: (a) => a.grade_code || <span className="text-amber-700">À renseigner</span> },
    { key: 'structure', header: 'Structure', search: (a) => `${a.bureau_nom || ''} ${a.division_nom || ''}`, render: structure },
    { key: 'poste', header: 'Poste' },
    {
      key: 'ecart', header: 'Validation', render: (a) => (a.valide
        ? <Badge tone="succes">Validé</Badge>
        : a.ecart === 'MODIFIE' ? <Badge tone="attention" title={`Modifié : ${(a.champsModifies || []).map((c) => CHAMPS[c]).join(', ')}`}>Modifié ({(a.champsModifies || []).map((c) => CHAMPS[c]).join(', ')})</Badge>
          : a.ecart === 'AJOUTE' ? <Badge tone="attention">Ajouté</Badge>
            : <Badge>En attente</Badge>),
    },
    {
      key: 'compte', header: 'Compte', render: (a) => (a.user_id
        ? <span className="inline-flex items-center gap-1 text-emerald-800"><UserCheck size={15} /> {a.username}</span>
        : a.est_secretariat_direction && a.enrolement_autorise_at
          ? <span className="inline-flex flex-wrap items-center gap-1"><Badge tone="info">Autorisé pour l’Admin</Badge>
            {d?.actions.valider && <button type="button" className="text-xs text-slate-500 underline" onClick={(e) => { e.stopPropagation(); autorisation(a, false); }}>Retirer</button>}</span>
          : a.est_secretariat_direction && d?.actions.valider && a.valide
            ? <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={(e) => { e.stopPropagation(); autorisation(a, true); }}><ShieldCheck size={14} /> Autoriser l’enrôlement par l’Admin</button>
            : <span className="text-slate-500">Non enrôlé</span>),
    },
    ...(d?.actions.gerer ? [{
      key: 'act', header: '', className: 'text-right', render: (a) => !a.user_id && (
        <button type="button" className="btn-ghost text-red-700" onClick={() => inscription(a, 'retirer')} title="Retirer de la liste" aria-label={`Retirer ${nomComplet(a)} de la liste`}><MinusCircle size={16} aria-hidden /></button>
      ),
    }] : []),
  ];

  return (
    <>
      <PageHeader title="Liste déclarative des agents" subtitle="Agents affectés à la Direction d’Études et Planification, validés par le Directeur avant la création de leurs comptes."
        breadcrumb={[{ label: 'Administration' }, { label: 'Liste déclarative' }]}
        actions={d && <>
          {d.actions.valider && d.statut !== 'VALIDEE' && <button type="button" className="btn-success" onClick={valider} disabled={!d.agents.length}><BadgeCheck size={16} /> Valider la liste</button>}
          {can('personnel.gerer', 'personnel.suivre') && <Link to="/personnel/import" className="btn-secondary"><ListChecks size={16} /> Importer</Link>}
          {can('compte.enroler') && <Link to="/comptes/enrolement" className="btn-secondary"><UserPlus size={16} /> Enrôlement</Link>}
          {d.statut === 'VALIDEE' && <button type="button" className="btn-primary" onClick={() => download('/liste-declarative/export/pdf', 'liste-officielle.pdf').catch(() => toast.error('Génération impossible.'))}><FileDown size={16} /> Liste officielle (PDF)</button>}
          <ExportButtons base="/liste-declarative/export" print={false} />
        </>} />
      <Loadable state={state}>
        {() => (
          <div className="space-y-5">
            {d.statut === 'NON_VALIDEE' && <InfoAlert tone="warning">La liste n’a pas encore été validée{d.actions.valider ? ' : vérifiez-la puis cliquez sur « Valider la liste ».' : ' par le Directeur.'} Aucun compte d’agent ne peut être créé avant cette validation.</InfoAlert>}
            {d.statut === 'A_REVALIDER' && <InfoAlert tone="warning">La liste a changé depuis sa dernière validation ({d.ecarts.ajoutes} ajout(s), {d.ecarts.modifies} modification(s), {d.ecarts.retires.length} retrait(s)). Les agents concernés ne peuvent pas être enrôlés avant une nouvelle validation{d.actions.valider ? '' : ' par le Directeur'}.</InfoAlert>}
            {d.statut === 'VALIDEE' && <InfoAlert>Liste validée le {fmtDateTime(d.validation.valide_at)}{d.validation.valide_par_nom ? ` par ${d.validation.valide_par_nom}` : ''}. Les agents peuvent être enrôlés.</InfoAlert>}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Statut de la liste" value={<Badge className={STATUT[d.statut][1]}>{STATUT[d.statut][0]}</Badge>} icon={ListChecks} />
              <Stat label="Agents inscrits" value={d.agents.length} icon={ListChecks} tone="gris" />
              <Stat label="Comptes créés" value={d.agents.filter((a) => a.user_id).length} icon={UserCheck} tone="vert" />
              <Stat label="Sans compte" value={d.agents.filter((a) => !a.user_id).length} icon={UserPlus} tone="jaune" />
            </div>

            <Card title="Mise en service des comptes"><Progression p={d.progression} /></Card>

            {d.ecarts.retires.length > 0 && (
              <Card title="Retirés depuis la dernière validation">
                <ul className="list-disc pl-5 text-sm">{d.ecarts.retires.map((r) => <li key={r.agent_id}>{[r.nom, r.postnom, r.prenom].filter(Boolean).join(' ')} — {r.matricule}</li>)}</ul>
              </Card>
            )}

            <DataTable columns={columns} rows={d.agents} rowKey="agent_id" pageSize={50} empty="La liste est vide : importez la liste des agents ou inscrivez-les depuis le module Personnel." />

            <Card title="Historique des validations">
              {d.historique.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {d.historique.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                      <span className="font-medium">{fmtDateTime(h.valide_at)}</span>
                      <span>{h.valide_par_nom || h.username} ({h.valide_par_role === 'DIRECTEUR' ? 'Directeur' : 'Admin'})</span>
                      <span className="text-slate-600">{h.nb_agents} agent(s)</span>
                      {h.commentaire && <span className="w-full text-slate-500">« {h.commentaire} »</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-slate-500">Aucune validation pour le moment.</p>}
            </Card>
          </div>
        )}
      </Loadable>
    </>
  );
}
