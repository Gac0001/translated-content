import { useState } from 'react';
import { BarChart3, FileSpreadsheet, FileText, FolderOpen, Plus, Printer, Trash2 } from 'lucide-react';
import {
  PageHeader, Card, Tabs, useOnglet, SimpleTable, EmptyState, KpiTile, WorkQueue, FilterBar, NumberInput, MoneyInput,
  EditableGrid, FormSection, FormModal, ActionBar, Field, StatusBadge, Badge, toast,
} from '../components/ui';
import { fmtCdf, fmtNombre, fmtPourcent } from '../lib/format';

// Catalogue des composants communs de l’interface (référence pour la refonte et la formation).
// Toutes les valeurs sont fictives ; la page n’appelle pas l’API.
const ANNEES = [{ key: '2027', label: '2027' }, { key: '2028', label: '2028' }, { key: '2029', label: '2029' }];
const NATURES = [
  { key: 'remu', label: 'Rémunérations' },
  { key: 'fonc', label: 'Fonctionnement' },
  { key: 'inter', label: 'Interventions' },
  { key: 'inv', label: 'Investissements' },
  { key: 'inv_ext', label: 'dont ressources extérieures', niveau: 1, lectureSeule: true },
];
const PLAFONDS = { fonc: { 2027: 1200000000, 2028: 1250000000, 2029: 1300000000 } };

function Saisie() {
  const [valeurs, setValeurs] = useState({ remu: { 2027: 850000000, 2028: 870000000, 2029: 890000000 }, fonc: { 2027: 1100000000, 2028: 1320000000, 2029: 1280000000 }, inter: {}, inv: { 2027: 400000000 }, inv_ext: { 2027: 150000000 } });
  const [modifie, setModifie] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [montant, setMontant] = useState(2500000);
  const [taux, setTaux] = useState(12.5);
  const maj = (l, c, v) => { setValeurs((s) => ({ ...s, [l]: { ...s[l], [c]: v } })); setModifie(true); };
  const enregistrer = async () => { setEnCours(true); await new Promise((r) => setTimeout(r, 600)); setEnCours(false); setModifie(false); toast.success('Enregistré (démonstration).'); };
  return (
    <div className="space-y-4">
      <Card title="Champs numériques (NumberInput, MoneyInput)">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Montant" hint="Saisie libre : « 2 500 000 » ou « 2500000 »."><MoneyInput value={montant} onChange={setMontant} /></Field>
          <Field label="Taux d’exécution" hint="Entre 0 et 100, une décimale."><NumberInput value={taux} onChange={setTaux} decimales={1} min={0} max={100} suffixe="%" /></Field>
          <Field label="Valeurs lues"><p className="py-2 text-sm tabular-nums">{fmtCdf(montant)} · {fmtPourcent(taux)}</p></Field>
        </div>
      </Card>
      <Card title="Grille de saisie (EditableGrid) — prévisions par nature, en CDF" bodyClass="p-0">
        <EditableGrid label="Prévisions par nature" entete="Nature" lignes={NATURES} colonnes={ANNEES} valeurs={valeurs} onChange={maj} totaux="tous" unite="CDF"
          alerte={(l, c, v) => (PLAFONDS[l]?.[c] && v > PLAFONDS[l][c] ? `Dépasse le plafond de ${fmtNombre(PLAFONDS[l][c])}` : null)} />
        <p className="px-4 py-2 text-xs text-slate-500">Entrée ou flèches haut / bas : cellule suivante ou précédente de la même année. La ligne « dont » est calculée.</p>
      </Card>
      <ActionBar dirty={modifie} saving={enCours} onSave={enregistrer} onCancel={() => setModifie(false)} />
    </div>
  );
}

function Formulaires() {
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ intitule: '', budget: null });
  const modifie = !!f.intitule || f.budget !== null;
  return (
    <Card title="Fenêtre de formulaire (FormModal, FormSection)" actions={<button type="button" className="btn-primary" onClick={() => setOuvert(true)}><Plus size={16} aria-hidden /> Nouveau projet</button>}>
      <p className="text-sm text-slate-600">Entrée enregistre ; fermer une saisie modifiée demande confirmation ; le bouton est désactivé pendant l’enregistrement.</p>
      <FormModal open={ouvert} title="Nouveau projet (démonstration)" dirty={modifie} size="lg"
        onClose={() => { setOuvert(false); setF({ intitule: '', budget: null }); }}
        onSubmit={async () => {
          if (!f.intitule.trim()) throw new Error('L’intitulé est obligatoire.');
          await new Promise((r) => setTimeout(r, 500));
          toast.success('Projet enregistré (démonstration).');
          setOuvert(false); setF({ intitule: '', budget: null });
        }}>
        <FormSection title="Identification" description="Les informations reprises dans la banque des projets.">
          <Field label="Intitulé" required className="sm:col-span-2"><input className="input" value={f.intitule} onChange={(e) => setF({ ...f, intitule: e.target.value })} /></Field>
        </FormSection>
        <FormSection title="Financement" cols={2}>
          <Field label="Coût total"><MoneyInput value={f.budget} onChange={(v) => setF({ ...f, budget: v })} /></Field>
          <Field label="Source"><select className="input"><option>Ressources propres</option><option>Ressources extérieures</option></select></Field>
        </FormSection>
      </FormModal>
    </Card>
  );
}

const LIGNES = [
  { id: 1, province: 'Kinshasa', abonnes: 1250400, part: 41.2, statut: 'VALIDE' },
  { id: 2, province: 'Haut-Katanga', abonnes: 512300, part: 16.9, statut: 'VALIDE' },
  { id: 3, province: 'Nord-Kivu', abonnes: 301800, part: 9.9, statut: 'SOUMIS' },
];

function Affichage() {
  const [filtres, setFiltres] = useState({ province: '', statut: '' });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Abonnés à Internet" valeur={fmtNombre(3034500)} evolution={{ valeur: 1, texte: '+8,4 %', favorable: true }} reference="vs 2025" cible="3 500 000" progression={87} />
        <KpiTile label="Taux d’exécution du PTBA" valeur="62" unite="%" evolution={{ valeur: -1, texte: '−5 pts', favorable: false }} reference="vs T2" tone="jaune" />
        <KpiTile label="Crédits consommés" valeur={fmtNombre(1.84, 2)} unite="Md CDF" aide="Sur 3,1 Md CDF ouverts" />
        <KpiTile label="Réponses contrôlées" valeur="18 / 24" progression={75} cible="24 acteurs" tone="vert" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <WorkQueue title="PTBA à vérifier" voirTout="/planification" items={[
          { id: 1, titre: 'PTBA 2027 — Service des infrastructures (démo)', detail: 'Soumis par le Bureau Programme', to: '/planification', badge: <StatusBadge value="SOUMIS" />, echeance: '2026-10-02' },
          { id: 2, titre: 'PTBA 2027 — Service des études (démo)', detail: 'Soumis', to: '/planification', echeance: '2026-12-15' },
        ]} />
        <WorkQueue title="Réponses à contrôler" voirTout="/donnees" total={7} items={[
          { id: 1, titre: 'Fleuve Fibre SA — Campagne T3', detail: 'Saisie par le Bureau Documentation', to: '/donnees', badge: <Badge tone="attention">2 alertes</Badge> },
        ]} />
        <WorkQueue title="Bulletins à viser" vide="Aucun bulletin en attente de visa." />
      </div>
      <Card title="Tableau simple (SimpleTable) avec barre de filtres (FilterBar)" bodyClass="p-0">
        <div className="px-4 pt-4">
          <FilterBar valeurs={filtres} onChange={(k, v) => setFiltres({ ...filtres, [k]: v })} onReset={() => setFiltres({ province: '', statut: '' })}
            filtres={[{ key: 'province', label: 'Province', placeholder: 'Toutes provinces', options: LIGNES.map((l) => [l.province, l.province]) }, { key: 'statut', label: 'Statut', placeholder: 'Tous statuts', options: [['VALIDE', 'Validé'], ['SOUMIS', 'Soumis']] }]} />
        </div>
        <SimpleTable label="Abonnés par province" figee
          rows={LIGNES.filter((l) => (!filtres.province || l.province === filtres.province) && (!filtres.statut || l.statut === filtres.statut))}
          columns={[
            { key: 'province', header: 'Province' },
            { key: 'abonnes', header: 'Abonnés', align: 'right', render: (r) => fmtNombre(r.abonnes) },
            { key: 'part', header: 'Part', align: 'right', render: (r) => fmtPourcent(r.part) },
            { key: 'statut', header: 'Statut', render: (r) => (r.statut ? <StatusBadge value={r.statut} /> : '') },
          ]}
          footer={[{ id: 't', province: 'Total', abonnes: 2064500, part: 68 }]} empty="Aucune province pour ces critères." />
      </Card>
      <Card title="État vide (EmptyState)">
        <EmptyState icon={FolderOpen} title="Aucun document de programmation pour 2027"
          action={<button type="button" className="btn-primary"><Plus size={16} aria-hidden /> Nouveau document</button>}>
          Le PAP, le RAP et le CDMT de l’exercice apparaîtront ici. Commencez par le CBMT : ses plafonds encadrent les crédits.
        </EmptyState>
      </Card>
    </div>
  );
}

export default function Composants() {
  const [onglet, choisir] = useOnglet('saisie', { valeurs: ['saisie', 'formulaires', 'affichage', 'onglets'] });
  return (
    <>
      <PageHeader title="Catalogue des composants" subtitle="Composants communs de l’interface, avec des données fictives : référence pour les écrans et la formation."
        breadcrumb={[{ label: 'Catalogue des composants' }]}
        actions={<button type="button" className="btn-primary"><Plus size={16} aria-hidden /> Action principale</button>}
        menu={[
          { label: 'Excel', icon: FileSpreadsheet, onClick: () => toast.info('Export Excel (démonstration).') },
          { label: 'PDF', icon: FileText, onClick: () => toast.info('Export PDF (démonstration).') },
          { label: 'Imprimer', icon: Printer, onClick: () => window.print() },
          { label: 'Supprimer', icon: Trash2, danger: true, onClick: () => toast.info('Suppression (démonstration).') },
        ]} />
      <Tabs label="Familles de composants" value={onglet} onChange={choisir} tabs={[
        { value: 'saisie', label: 'Saisie chiffrée' }, { value: 'formulaires', label: 'Formulaires' }, { value: 'affichage', label: 'Affichage et tableaux de bord' }, { value: 'onglets', label: 'Onglets et en-tête' },
      ]} compact={3} />
      {onglet === 'saisie' && <Saisie />}
      {onglet === 'formulaires' && <Formulaires />}
      {onglet === 'affichage' && <Affichage />}
      {onglet === 'onglets' && (
        <Card title="Onglets (Tabs + useOnglet) et en-tête (PageHeader)">
          <EmptyState icon={BarChart3} title="Onglet conservé dans l’adresse">
            L’onglet choisi figure dans l’adresse (<code>?onglet=onglets</code>) : il est retrouvé au retour d’une fiche, au rechargement et dans un lien partagé.
            Sur téléphone, au-delà de quatre onglets, une liste déroulante remplace la barre ; les actions secondaires de l’en-tête sont regroupées sous « Actions ».
          </EmptyState>
        </Card>
      )}
    </>
  );
}
