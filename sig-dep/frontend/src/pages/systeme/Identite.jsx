import { useEffect, useState } from 'react';
import { FileDown, Upload } from 'lucide-react';
import api, { download } from '../../lib/api';
import { aujourdhui, fmtDate, fmtDateTime } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, Field, InfoAlert, KeyValues, SimpleTable, Badge, ActionBar, FormSection, runCritique, signalerErreur } from '../../components/ui';

const CHAMPS = ['ministere', 'sigle', 'secretariat_general', 'direction', 'secretaire_general_titre', 'adresse', 'courriel', 'site_web', 'qr_contenu', 'format_reference', 'format_reference_sg'];

/** Image du sceau d’une version (lue avec l’authentification). */
function Sceau({ version, aSceau }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let lien = null;
    if (aSceau) api.get(`/systeme/identite/${version}/sceau`, { responseType: 'blob' }).then((r) => { lien = URL.createObjectURL(r.data); setSrc(lien); }).catch(() => setSrc(null));
    else setSrc(null);
    return () => { if (lien) URL.revokeObjectURL(lien); };
  }, [version, aSceau]);
  return src
    ? <img src={src} alt="Sceau aux armoiries" className="h-24 w-24 rounded-full border border-slate-200 bg-white object-contain p-1" />
    : <div className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed border-slate-300 p-2 text-center text-xs text-slate-600">Aucun sceau : en-tête textuel</div>;
}

const lireBase64 = (fichier) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
  r.readAsDataURL(fichier);
});

/** Proposition d’une nouvelle version (confirmée par le Directeur avant d’être enregistrée). */
function NouvelleVersion({ courante, onSaved }) {
  const [initial] = useState(() => ({ ...Object.fromEntries(CHAMPS.map((k) => [k, courante[k] || ''])), date_application: aujourdhui(), motif: '' }));
  const [f, setF] = useState(initial);
  const [sceau, setSceau] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const choisirSceau = async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    if (fichier.size > 1_500_000) { signalerErreur(new Error('Image du sceau trop lourde (1,5 Mo au plus).')); e.target.value = ''; return; }
    setSceau({ nom: fichier.name, base64: await lireBase64(fichier) });
  };
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    try {
      const r = await runCritique(() => api.post('/systeme/identite', { ...f, sceau_base64: sceau?.base64 || null }), 'Nouvelle version de l’identité enregistrée.');
      if (r) onSaved();
    } catch { /* erreur déjà signalée */ } finally { setEnCours(false); }
  };
  const dirty = !!sceau || JSON.stringify(f) !== JSON.stringify(initial);
  return (
    <form id="form-identite" onSubmit={enregistrer} className="space-y-4" noValidate>
      <InfoAlert>Opération critique : votre demande est d’abord <b>confirmée par le Directeur</b> (Gouvernance), puis vous l’enregistrez à nouveau à l’identique. Les documents déjà signés gardent l’identité en vigueur à leur date de signature.</InfoAlert>
      <FormSection title="En-tête" cols={2}>
        <Field label="Ministère (en capitales)" required className="sm:col-span-2"><input className="input" value={f.ministere} onChange={up('ministere')} /></Field>
        <Field label="Sigle" required hint="Repris dans les références, ex. MIN-ECN"><input className="input font-mono" value={f.sigle} onChange={up('sigle')} /></Field>
        <Field label="Applicable à partir du" required><input type="date" className="input" value={f.date_application} onChange={up('date_application')} /></Field>
        <Field label="Secrétariat Général" required><input className="input" value={f.secretariat_general} onChange={up('secretariat_general')} /></Field>
        <Field label="Direction" required><input className="input" value={f.direction} onChange={up('direction')} /></Field>
        <Field label="Titre du Secrétaire Général (variante SG)" required><input className="input" value={f.secretaire_general_titre} onChange={up('secretaire_general_titre')} /></Field>
        <Field label="Sceau aux armoiries (PNG ou JPEG, 1,5 Mo au plus)" hint={sceau ? `Nouveau sceau : ${sceau.nom}` : 'Sans nouveau fichier, le sceau actuel est conservé.'}>
          <label className="btn-secondary w-fit cursor-pointer"><Upload size={16} aria-hidden /> Choisir une image<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={choisirSceau} /></label>
        </Field>
      </FormSection>
      <FormSection title="Pied de page" cols={2}>
        <Field label="Adresse" required className="sm:col-span-2"><input className="input" value={f.adresse} onChange={up('adresse')} /></Field>
        <Field label="Courriel" required><input type="email" className="input" value={f.courriel} onChange={up('courriel')} /></Field>
        <Field label="Site web" required><input className="input" value={f.site_web} onChange={up('site_web')} /></Field>
        <Field label="Contenu du QR code" required className="sm:col-span-2" hint="Adresse publique uniquement : aucune donnée personnelle."><input className="input" value={f.qr_contenu} onChange={up('qr_contenu')} /></Field>
      </FormSection>
      <FormSection title="Références des correspondances" description="Variables : {seq} numéro annuel, {sigle}, {signataire} et {redacteur} (initiales), {annee}. Le numéro est attribué à la signature." cols={1}>
        <Field label="Format (signature du Directeur)" required><input className="input font-mono" value={f.format_reference} onChange={up('format_reference')} /></Field>
        <Field label="Format (signature du Secrétaire Général)" required><input className="input font-mono" value={f.format_reference_sg} onChange={up('format_reference_sg')} /></Field>
        <Field label="Motif (acte ou décision)" required hint="10 caractères au moins."><textarea className="input" rows={2} value={f.motif} onChange={up('motif')} /></Field>
      </FormSection>
      <ActionBar form="form-identite" dirty={dirty} saving={enCours} onCancel={() => { setF(initial); setSceau(null); }} saveLabel="Proposer la nouvelle version" />
    </form>
  );
}

/** Identité du Ministère : en-tête et pied de page de tous les documents produits (Admin Système, Directeur en lecture). */
export default function Identite() {
  const state = useApi('/systeme/identite');
  const can = useAuth((s) => s.can);
  const peutModifier = can('systeme.configurer');
  const apercu = (variante) => download(`/systeme/identite/apercu.pdf?variante=${variante}`, `apercu-entete-${variante}.pdf`).catch(signalerErreur);
  return (
    <>
      <PageHeader title="Identité et en-tête" subtitle="En-tête, pied de page, sceau et format des références de tous les documents produits (PDF, Word, Excel)."
        breadcrumb={[{ label: 'Sécurité et système' }, { label: 'Identité et en-tête' }]}
        actions={<>
          <button type="button" className="btn-secondary" onClick={() => apercu('DEP')}><FileDown size={16} aria-hidden /> Aperçu Direction</button>
          <button type="button" className="btn-secondary" onClick={() => apercu('SG')}><FileDown size={16} aria-hidden /> Aperçu Secrétaire Général</button>
        </>} />
      <Loadable state={state}>
        {({ courante, versions }) => (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4">
              <Card title={`Version en vigueur : ${courante.version}`}>
                <div className="mb-3 flex justify-center"><Sceau version={courante.version} aSceau={courante.aSceau} /></div>
                <KeyValues cols={1} items={[
                  ['Ministère', courante.ministere], ['Sigle', courante.sigle], ['Secrétariat Général', courante.secretariat_general],
                  ['Direction', courante.direction], ['Adresse', courante.adresse], ['Courriel', courante.courriel], ['Site web', courante.site_web],
                  ['Référence (Directeur)', <code key="r" className="break-all text-xs">{courante.format_reference}</code>], ['Référence (SG)', <code key="s" className="break-all text-xs">{courante.format_reference_sg}</code>],
                  ['Applicable depuis', fmtDate(courante.date_application)],
                ]} />
              </Card>
              <Card title="Historique des versions" bodyClass="p-0">
                <SimpleTable label="Historique des versions de l’identité" dense rowKey="version" rows={versions} columns={[
                  { key: 'version', label: 'Version', render: (v) => <span className="flex items-center gap-1.5">{v.version}{v.version === courante.version && <Badge tone="vert">en vigueur</Badge>}</span> },
                  { key: 'date_application', label: 'Applicable le', render: (v) => fmtDate(v.date_application) },
                  { key: 'motif', label: 'Motif', render: (v) => <span title={`${v.created_by_nom || ''} — ${fmtDateTime(v.created_at)}`}>{v.motif || '—'}</span> },
                ]} />
              </Card>
            </div>
            <div className="lg:col-span-2">
              {peutModifier
                ? <Card title="Nouvelle version"><NouvelleVersion key={courante.version + versions.length} courante={courante} onSaved={state.reload} /></Card>
                : <InfoAlert>Les modifications sont proposées par l’Admin Système et soumises à votre confirmation (Gouvernance).</InfoAlert>}
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}
