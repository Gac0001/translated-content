import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import api from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, Field, InfoAlert, DataTable, Badge, NumberInput, ActionBar, runAction } from '../../components/ui';

function Armoirie({ version }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let lien = null;
    api.get('/cartes/modele/armoirie', { responseType: 'blob' }).then((r) => { lien = URL.createObjectURL(r.data); setSrc(lien); }).catch(() => setSrc(null));
    return () => { if (lien) URL.revokeObjectURL(lien); };
  }, [version]);
  return src
    ? <img src={src} alt="Bloc-armoirie" className="h-28 w-28 rounded-full border border-slate-200 bg-white object-contain p-1" />
    : <div className="flex h-28 w-28 items-center justify-center rounded-full border border-dashed border-slate-300 text-center text-xs text-slate-500">Aucune armoirie : sceau provisoire</div>;
}

function Formulaire({ m, onSaved }) {
  const [initial] = useState(() => ({
    intitule: m.intitule.join('\n'), adresse: m.adresse || '', site_web: m.site_web || '', couleur_bandeau: m.couleur_bandeau, couleur_accent: m.couleur_accent,
    titre_verso: m.titre_verso, mention_verso: m.mention_verso, validite_annees: m.validite_annees, verification_matricule: m.verification_matricule, note: '',
  }));
  const [f, setF] = useState(initial);
  const [enCours, setEnCours] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enregistrer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    try {
      await runAction(() => api.put('/cartes/modele', { ...f, intitule: f.intitule.split('\n').map((l) => l.trim()).filter(Boolean), validite_annees: Number(f.validite_annees) }), 'Nouvelle version du modèle enregistrée.');
      onSaved();
    } catch { setEnCours(false); /* erreur déjà signalée */ }
  };
  return (
    <form id="form-modele" onSubmit={enregistrer} className="grid gap-3 sm:grid-cols-2" noValidate>
      <Field label="Intitulé officiel (une ligne par ligne imprimée)" required className="sm:col-span-2" hint="Imprimé en capitales grasses, taille homogène (charte graphique) : ministère, secrétariat général, direction."><textarea className="input font-medium" rows={3} value={f.intitule} onChange={up('intitule')} /></Field>
      <Field label="Adresse (bandeau du recto)"><input className="input" value={f.adresse} onChange={up('adresse')} /></Field>
      <Field label="Site web (verso)"><input className="input" value={f.site_web} onChange={up('site_web')} /></Field>
      <Field label="Couleur du bandeau"><input type="color" className="input h-10" value={f.couleur_bandeau} onChange={up('couleur_bandeau')} /></Field>
      <Field label="Couleur du titre du verso"><input type="color" className="input h-10" value={f.couleur_accent} onChange={up('couleur_accent')} /></Field>
      <Field label="Titre du verso" required><input className="input" value={f.titre_verso} onChange={up('titre_verso')} /></Field>
      <Field label="Validité (années)" required hint="De 1 à 10 ans"><NumberInput value={Number(f.validite_annees) || null} min={1} max={10} onChange={(v) => setF({ ...f, validite_annees: v ?? f.validite_annees })} /></Field>
      <Field label="Mention du verso" required className="sm:col-span-2"><textarea className="input" rows={2} value={f.mention_verso} onChange={up('mention_verso')} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.verification_matricule} onChange={up('verification_matricule')} /> Autoriser la vérification publique par matricule (en plus du QR code)</label>
      <Field label="Note de version" className="sm:col-span-2"><input className="input" value={f.note} onChange={up('note')} placeholder="Ex. adresse mise à jour" /></Field>
      <div className="sm:col-span-2"><ActionBar form="form-modele" dirty={JSON.stringify(f) !== JSON.stringify(initial)} saving={enCours} onCancel={() => setF(initial)} saveLabel="Enregistrer une nouvelle version" /></div>
    </form>
  );
}

/** Modèle graphique des cartes de service (Admin Système) : versionné, sans pouvoir de validation. */
export default function ModeleCarte() {
  const state = useApi('/cartes/modele');
  const [version, setVersion] = useState(0);
  const deposer = async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    const fd = new FormData(); fd.append('armoirie', fichier);
    await runAction(() => api.post('/cartes/modele/armoirie', fd), 'Bloc-armoirie enregistré (nouvelle version du modèle).');
    e.target.value = ''; setVersion((v) => v + 1); state.reload();
  };
  return (
    <>
      <PageHeader title="Modèle de carte de service" subtitle="Charte graphique du Gouvernement (p. 43) : Bloc-armoirie, Ligne d’État, intitulé officiel ; recto avec photo, verso « Laissez passer » et QR code."
        breadcrumb={[{ label: 'Administration' }, { label: 'Modèle de carte' }]} />
      <InfoAlert>L’Admin Système configure le modèle ; il ne prépare, ne valide ni ne délivre aucune carte. Chaque modification crée une version : les cartes déjà validées gardent la leur.</InfoAlert>
      <Loadable state={state}>
        {(d) => (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Bloc-armoirie">
                <div className="flex flex-col items-center gap-3">
                  <Armoirie version={version} />
                  <p className="text-center text-xs text-slate-600">Déposez le Bloc-armoirie officiel de la charte (PNG à fond transparent, au moins 600 × 600 pixels).</p>
                  <label className="btn-secondary cursor-pointer focus-within:ring-2 focus-within:ring-dep-400"><Upload size={16} aria-hidden /> Déposer l’armoirie<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={deposer} /></label>
                </div>
              </Card>
              <Card title={`Version en vigueur : ${d.actif.version}`} className="lg:col-span-2"><Formulaire key={d.actif.id} m={d.actif} onSaved={state.reload} /></Card>
            </div>
            <DataTable rows={d.versions} searchable={false} label="Versions du modèle" columns={[
              { key: 'version', header: 'Version', render: (m) => <span>{m.version} {m.actif && <Badge className="ml-1 bg-emerald-50 text-emerald-800 ring-emerald-200">En vigueur</Badge>}</span> },
              { key: 'created_at', header: 'Date', render: (m) => `${fmtDateTime(m.created_at)}${m.auteur ? ` par ${m.auteur}` : ''}` },
              { key: 'validite_annees', header: 'Validité', render: (m) => `${m.validite_annees} ans` },
              { key: 'note', header: 'Note', render: (m) => m.note || '—' },
            ]} />
          </div>
        )}
      </Loadable>
    </>
  );
}
