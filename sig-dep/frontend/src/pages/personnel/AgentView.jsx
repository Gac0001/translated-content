import { Link } from 'react-router-dom';
import { FileCheck2 } from 'lucide-react';
import { download } from '../../lib/api';
import { Card, KeyValues, StatusBadge, Badge, RangBadge, toast, SimpleTable } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import AgentPhoto from './AgentPhoto';

const LIBELLES_CARRIERE = { AFFECTATION: 'Affectation', GRADE: 'Grade', NOMINATION: 'Nomination', INTERIM: 'Intérim', DESIGNATION: 'Désignation', FIN_FONCTION: 'Fin de fonction' };
const TONS_CARRIERE = { AFFECTATION: 'info', GRADE: 'succes', NOMINATION: 'marine', INTERIM: 'attention', DESIGNATION: 'violet', FIN_FONCTION: 'neutre' };

/** Fiche complète d’un Agent (utilisée par la fiche Personnel et le profil). */
export default function AgentView({ a, photoVersion, extraActions }) {
  const rang = a.niveau === 'BUREAU' ? 'BUREAU' : a.niveau === 'DIVISION' ? 'DIVISION' : a.niveau === 'DIRECTION' ? 'DIRECTION' : null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Identité" className="lg:col-span-2">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="shrink-0"><AgentPhoto agentId={a.id} hasPhoto={a.has_photo} size={120} version={photoVersion} />{extraActions}</div>
          <div className="flex-1">
            {a.donnees_masquees && <p className="mb-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">Données personnelles (naissance, adresse, téléphone, carte IGAP, commission) réservées à l’agent, au Directeur et au Secrétariat de Direction.</p>}
            <KeyValues items={[
              ['Nom', a.nom], ['Postnom', a.postnom], ['Prénom', a.prenom], ['Sexe', a.sexe === 'F' ? 'Féminin' : a.sexe === 'M' ? 'Masculin' : 'Non renseigné'],
              ['Matricule', a.matricule], ['Date de naissance', fmtDate(a.date_naissance)], a.lieu_naissance && ['Lieu de naissance', a.lieu_naissance], ['Grade', a.grade ? `${a.grade_code_officiel ? `${a.grade_code_officiel} — ` : ''}${a.grade}` : '—'], ['Fonction', a.fonction],
              ['Date de mise en service', fmtDate(a.date_mise_en_service)], ['N° carte IGAP', a.numero_carte_igap],
              a.commission_attachment_id && ['Commission d’affectation', <button key="c" type="button" className="inline-flex items-center gap-1 link" onClick={() => download(`/agents/${a.id}/commission`, 'commission.pdf').catch(() => toast.error('Téléchargement impossible.'))}><FileCheck2 size={14} /> Télécharger</button>],
              ['Liste déclarative', a.liste_declarative ? (a.enrole_at ? `Inscrit — enrôlé le ${fmtDate(a.enrole_at)}` : 'Inscrit — non enrôlé') : 'Non inscrit'],
              ['Téléphone', a.telephone], ['Adresse électronique', a.email], ['Adresse', a.adresse], ['Statut', <StatusBadge key="s" value={a.statut} />],
            ]} />
          </div>
        </div>
      </Card>
      <Card title="Affectation actuelle">
        <KeyValues cols={1} items={[
          ['Direction', a.direction],
          ['Division', a.division || (a.niveau ? 'Aucune' : '—')],
          ['Bureau', a.bureau_nom ? <span key="b">{a.bureau_nom} {a.rattachement && <Badge tone="ambre" className="mt-1">{a.rattachement}</Badge>}</span> : '—'],
          ['Rang de la structure', rang ? <RangBadge key="r" rang={rang} /> : '—'],
          ['Poste organique', a.poste],
          ['Date d’affectation', fmtDate(a.date_affectation)],
          ['Supérieur hiérarchique', a.superieur ? (a.superieur.agent ? <span key="sup">{a.superieur.titre} — <Link className="link" to={`/personnel/${a.superieur.agent.id}`}>{a.superieur.agent.nomComplet}</Link></span> : `${a.superieur.titre} (poste vacant)`) : '—'],
          ['Compte', a.username ? `${a.username} (${a.roles.map((r) => r.libelle).join(', ')})` : 'Aucun compte'],
        ]} />
      </Card>
      <Card title="Attributions de la structure" className="lg:col-span-2">
        {a.attributions_structure.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{a.attributions_structure.map((x) => <li key={x.id}>{x.libelle}</li>)}</ul> : <p className="text-sm text-slate-500">—</p>}
      </Card>
      <Card title="Responsabilités du poste">
        {a.responsabilites_poste.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{a.responsabilites_poste.map((x) => <li key={x.id}>{x.libelle}</li>)}</ul> : <p className="text-sm text-slate-500">—</p>}
      </Card>
      <Card title="Carrière" className="lg:col-span-3" bodyClass="p-0">
        <SimpleTable label="Carrière" rowKey="cle" empty="Aucun événement de carrière."
          rows={(a.carriere || []).map((e, i) => ({ ...e, cle: `${e.type}-${e.date}-${i}` }))}
          columns={[
            { key: 'date', header: 'Date', render: (e) => <span className="whitespace-nowrap">{fmtDate(e.date)}</span> },
            { key: 'type', header: 'Événement', render: (e) => <Badge tone={TONS_CARRIERE[e.type]}>{LIBELLES_CARRIERE[e.type] || e.type}</Badge> },
            { key: 'titre', header: 'Objet', render: (e) => <span>{e.titre}{e.en_cours && <Badge tone="succes" className="ml-2">En cours</Badge>}</span> },
            { key: 'detail', header: 'Détail', render: (e) => <span className="text-xs">{e.detail}</span> },
            { key: 'acte', header: 'Acte', render: (e) => (e.acte_id ? <Link className="link whitespace-nowrap" to={`/actes/${e.acte_id}`}>{e.acte_numero}</Link> : '—') },
          ]} />
      </Card>
    </div>
  );
}
