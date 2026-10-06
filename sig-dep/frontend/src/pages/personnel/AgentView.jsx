import { Link } from 'react-router-dom';
import { FileCheck2 } from 'lucide-react';
import { download } from '../../lib/api';
import { Card, KeyValues, StatusBadge, Badge, RangBadge, toast, ZoneDefilante } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import AgentPhoto from './AgentPhoto';

/** Fiche complète d’un Agent (utilisée par la fiche Personnel et le profil). */
export default function AgentView({ a, photoVersion, extraActions }) {
  const rang = a.niveau === 'BUREAU' ? 'BUREAU' : a.niveau === 'DIVISION' ? 'DIVISION' : a.niveau === 'DIRECTION' ? 'DIRECTION' : null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Identité" className="lg:col-span-2">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="shrink-0"><AgentPhoto agentId={a.id} hasPhoto={a.has_photo} size={120} version={photoVersion} />{extraActions}</div>
          <div className="flex-1">
            <KeyValues items={[
              ['Nom', a.nom], ['Postnom', a.postnom], ['Prénom', a.prenom], ['Sexe', a.sexe === 'F' ? 'Féminin' : a.sexe === 'M' ? 'Masculin' : 'Non renseigné'],
              ['Matricule', a.matricule], ['Date de naissance', fmtDate(a.date_naissance)], a.lieu_naissance && ['Lieu de naissance', a.lieu_naissance], ['Grade', a.grade], ['Fonction', a.fonction],
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
      <Card title="Historique des affectations" className="lg:col-span-3" bodyClass="p-0">
        <ZoneDefilante label="Historique des affectations">
          <table className="min-w-full">
            <thead><tr><th className="th">Période</th><th className="th">Structure</th><th className="th">Poste</th><th className="th">Motif</th><th className="th">État</th></tr></thead>
            <tbody>
              {a.historique_affectations.map((h) => (
                <tr key={h.id}>
                  <td className="td whitespace-nowrap">{fmtDate(h.date_debut)} → {h.date_fin ? fmtDate(h.date_fin) : 'en cours'}</td>
                  <td className="td">{h.bureau_nom ? `${h.bureau_nom}${h.est_secretariat_direction ? ' (rattaché au Directeur)' : h.division_nom ? ` — ${h.division_nom}` : ''}` : h.division_nom || 'Direction'}</td>
                  <td className="td">{h.poste || '—'}</td>
                  <td className="td text-xs">{h.motif}{h.motif_cloture ? <div className="text-slate-500">Clôture : {h.motif_cloture}</div> : null}</td>
                  <td className="td">{h.est_active ? <Badge tone="succes">Active</Badge> : <Badge>Clôturée</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!a.historique_affectations.length && <p className="p-4 text-sm text-slate-500">Aucune affectation.</p>}
        </ZoneDefilante>
      </Card>
    </div>
  );
}
