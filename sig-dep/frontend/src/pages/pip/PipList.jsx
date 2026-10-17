import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileUp, Plus } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, useListParams, queryString, ListPage, StatusBadge, Modal, Field, Alert, KeyValues, Button, runAction } from '../../components/ui';
import { ExportButtons } from '../../components/shared';
import { fmtCdf, fmtDate, fmtMontant } from '../../lib/format';
import { STATUTS } from '../../lib/labels';

/** Import d’une fiche remplie au modèle du Ministère du Plan : lecture, relecture, puis création du brouillon. */
function ImportFiche({ onClose }) {
  const navigate = useNavigate();
  const [fichier, setFichier] = useState(null);
  const [analyse, setAnalyse] = useState(null);
  const [busy, setBusy] = useState(false);
  const lire = async () => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('fichier', fichier);
      setAnalyse((await runAction(() => api.post('/pip/import/analyser', fd))).data);
    } catch { /* message affiché */ } finally { setBusy(false); }
  };
  const creer = async () => {
    setBusy(true);
    try {
      const r = await runAction(() => api.post('/pip', { donnees: analyse.donnees, importe: analyse.fichier }), 'Fiche importée : brouillon créé.');
      navigate(`/pip/${r.data.id}/modifier`);
    } catch { setBusy(false); }
  };
  const id = analyse?.donnees.identification;
  return (
    <Modal open title="Importer une fiche de projet (Excel)" onClose={onClose} size="lg"
      footer={<>
        <Button onClick={onClose}>Annuler</Button>
        {analyse ? <Button variant="primary" loading={busy} onClick={creer}>Créer le brouillon</Button> : <Button variant="primary" loading={busy} disabled={!fichier} onClick={lire}>Lire le classeur</Button>}
      </>}>
      {!analyse ? (
        <Field label="Classeur au modèle du Ministère du Plan (.xlsx, six feuilles)" hint="Les rubriques sont repérées par leur libellé : des lignes ajoutées ou retirées sont acceptées.">
          <input type="file" accept=".xlsx" className="input" onChange={(e) => setFichier(e.target.files[0] || null)} />
        </Field>
      ) : (
        <div className="space-y-3">
          <KeyValues cols={2} items={[
            ['Libellé', id.libelle], ['Étape', id.etape], ['Service', id.service], ['Province', id.province],
            ['Coût du projet', fmtCdf(analyse.synthese.coutTotal)], ['Plan de financement', fmtCdf(analyse.synthese.financementTotal)],
          ]} />
          {analyse.alertes.map((a) => <Alert key={a} tone="attention" statique>{a}</Alert>)}
          {analyse.incoherences.map((x) => <Alert key={x.message} tone={x.bloquant ? 'danger' : 'attention'} statique>{x.message}</Alert>)}
          {analyse.missing.length > 0
            ? <Alert tone="info" statique>{analyse.missing.length} rubrique(s) obligatoire(s) à compléter après l’import : {analyse.missing.slice(0, 6).join(' ; ')}{analyse.missing.length > 6 ? '…' : ''}</Alert>
            : <Alert tone="succes" statique>Toutes les rubriques obligatoires sont renseignées.</Alert>}
          <p className="text-sm text-slate-600">Le brouillon s’ouvrira en modification pour relecture avant soumission.</p>
        </div>
      )}
    </Modal>
  );
}

export default function PipList() {
  const [importer, setImporter] = useState(false);
  const can = useAuth((s) => s.can);
  const navigate = useNavigate();
  const liste = useListParams({ statut: '' });
  const query = queryString({ statut: liste.valeurs.statut });
  const state = useApi(`/pip${query}`);
  return (
    <ListPage title="Projets PIP" subtitle="Fiches de projets du Programme d’Investissements Publics — modèle du Ministère du Plan." breadcrumb={[{ label: 'Projets PIP' }]}
      liste={liste} state={state} onRowClick={(p) => navigate(`/pip/${p.id}`)}
      actions={<>
        <ExportButtons base="/pip/export" formats={['xlsx']} print={false} query={query} />
        {can('pip.rediger') && <button type="button" className="btn-secondary" onClick={() => setImporter(true)}><FileUp size={16} aria-hidden /> Importer une fiche</button>}
        {can('pip.rediger') && <Link to="/pip/nouveau" className="btn-primary"><Plus size={16} aria-hidden /> Nouvelle fiche PIP</Link>}
        {importer && <ImportFiche onClose={() => setImporter(false)} />}
      </>}
      filtres={[{ key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: [['BROUILLON', 'Brouillon'], ['EN_VERIFICATION', 'En vérification'], ['A_CORRIGER', 'À corriger'], ['VERIFIE', 'Vérifiée'], ['VALIDE', 'Validée'], ['ARCHIVE', 'Archivée']] }]}
      columns={[
        { key: 'code', header: 'Code', sortable: true, render: (p) => <span className="whitespace-nowrap font-medium">{p.code}</span> },
        { key: 'intitule', header: 'Intitulé du projet', primary: true, sortable: true, render: (p) => <span>{p.intitule}<span className="block text-xs font-normal text-slate-500">{p.secteur}</span></span> },
        { key: 'cout_total', header: 'Coût total', sortValue: (p) => (p.cout_total === null ? null : Number(p.cout_total)), render: (p) => <span className="whitespace-nowrap tabular-nums">{fmtMontant(p.cout_total, p.devise)}</span> },
        { key: 'duree', header: 'Durée', sortValue: (p) => (p.duree_mois ? Number(p.duree_mois) : null), render: (p) => (p.duree_mois ? `${p.duree_mois} mois` : '—') },
        { key: 'date_debut', header: 'Démarrage', sortable: true, render: (p) => fmtDate(p.date_debut) },
        { key: 'auteur_nom', header: 'Élaborée par', sortable: true, render: (p) => <span>{p.auteur_nom}<span className="block text-xs text-slate-500">{p.bureau_nom || p.division_nom || 'Direction'}</span></span> },
        { key: 'statut', header: 'Statut', sortValue: (p) => STATUTS[p.statut]?.[0], render: (p) => <StatusBadge value={p.statut} feminin /> },
      ]} />
  );
}
