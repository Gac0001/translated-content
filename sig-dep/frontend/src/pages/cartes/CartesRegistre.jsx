import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdCard, Printer, Upload, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, Tabs, DataTable, Badge, InfoAlert, Field, Select, runAction, toast, useConfirm } from '../../components/ui';
import { ETATS_CARTE, MOTIFS_EMISSION } from './libelles';

const Etat = ({ s }) => <Badge className={ETATS_CARTE[s][1]}>{ETATS_CARTE[s][0]}</Badge>;

async function imprimerPlanche(ids) {
  const r = await api.post('/cartes/planche', { ids }, { responseType: 'blob' });
  const href = URL.createObjectURL(r.data);
  window.open(href, '_blank');
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

function Registre() {
  const [statut, setStatut] = useState('');
  const state = useApi(`/cartes${statut ? `?statut=${statut}` : ''}`, [statut]);
  const [choix, setChoix] = useState(new Set());
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const toggle = (id) => setChoix((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const planche = async () => {
    try { await imprimerPlanche([...choix]); toast.success('Planche générée : imprimez en recto-verso (bord long).'); setChoix(new Set()); state.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">{Object.entries(d.parStatut).map(([s, n]) => <Badge key={s} className={ETATS_CARTE[s][1]}>{ETATS_CARTE[s][0]} : {n}</Badge>)}</div>
          <DataTable rows={d.data} onRowClick={(c) => navigate(`/cartes/${c.id}`)}
            toolbar={(
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statut} onChange={setStatut} placeholder="Tous les états" options={Object.entries(ETATS_CARTE).map(([v, [l]]) => [v, l])} />
                {can('cartes.preparer') && <button type="button" className="btn-secondary" disabled={!choix.size} onClick={planche}><Printer size={16} /> Planche A4 ({choix.size})</button>}
              </div>
            )}
            columns={[
              ...(can('cartes.preparer') ? [{ key: 'sel', header: '', render: (c) => (['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(c.statut)
                ? <input type="checkbox" aria-label={`Sélectionner ${c.numero}`} checked={choix.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.id)} /> : null) }] : []),
              { key: 'numero', header: 'N°', render: (c) => <span className="font-mono text-xs">{c.numero || '—'}</span> },
              { key: 'titulaire', header: 'Titulaire', render: (c) => <div><div className="font-medium">{c.titulaire}</div><div className="text-xs text-slate-500">{c.matricule}</div></div>, search: (c) => `${c.titulaire} ${c.matricule}` },
              { key: 'motif', header: 'Motif', render: (c) => MOTIFS_EMISSION[c.motif_emission] },
              { key: 'statut', header: 'État', render: (c) => <Etat s={c.statut} /> },
              { key: 'validite', header: 'Validité', render: (c) => (c.date_expiration ? `${fmtDate(c.date_delivrance)} → ${fmtDate(c.date_expiration)}` : '—') },
              { key: 'impressions', header: 'Impressions', render: (c) => c.nb_impressions || '—' },
            ]} />
        </div>
      )}
    </Loadable>
  );
}

function Preparer() {
  const state = useApi('/cartes/agents');
  const navigate = useNavigate();
  const preparer = async (a, motif) => {
    const r = await runAction(() => api.post('/cartes', { agent_id: a.id, motif_emission: motif }), 'Carte en préparation.');
    navigate(`/cartes/${r.data.id}`);
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <DataTable rows={d.data} columns={[
          { key: 'nom', header: 'Agent', render: (a) => <div><div className="font-medium">{[a.prenom, a.nom, a.postnom].filter(Boolean).join(' ')}</div><div className="text-xs text-slate-500">{a.matricule}</div></div>, search: (a) => `${a.nom} ${a.prenom} ${a.matricule}` },
          { key: 'structure', header: 'Affectation' },
          { key: 'photo', header: 'Photo', render: (a) => (a.photo ? 'Oui' : <span className="text-orange-700">Manquante</span>) },
          { key: 'cartes', header: 'Carte', render: (a) => (a.cartes.length ? a.cartes.map((c) => <button key={c.id} type="button" className="mr-1" onClick={() => navigate(`/cartes/${c.id}`)}><Etat s={c.statut} /></button>) : <span className="text-slate-500">Aucune</span>) },
          { key: 'a', header: '', render: (a) => {
            const enPrep = a.cartes.some((c) => ['BROUILLON', 'A_COMPLETER', 'VERIFIEE'].includes(c.statut));
            const enCirc = a.cartes.some((c) => ['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'].includes(c.statut));
            if (enPrep) return null;
            return enCirc
              ? <button type="button" className="btn-secondary py-1" onClick={() => preparer(a, 'RENOUVELLEMENT')}>Renouveler</button>
              : <button type="button" className="btn-primary py-1" onClick={() => preparer(a, 'PREMIERE')}><IdCard size={14} /> Préparer</button>;
          } },
        ]} />
      )}
    </Loadable>
  );
}

function Verifications() {
  const state = useApi('/cartes/verifications');
  return (
    <Loadable state={state}>
      {(d) => (
        <>
          <InfoAlert>Vérifications publiques des 30 derniers jours (QR code ou matricule). Des recherches infructueuses répétées depuis une même adresse déclenchent une alerte de sécurité.</InfoAlert>
          <div className="mt-3"><DataTable rows={d.data} columns={[
            { key: 'created_at', header: 'Date', render: (v) => fmtDateTime(v.created_at) },
            { key: 'mode', header: 'Mode', render: (v) => (v.mode === 'QR' ? 'QR code' : 'Matricule') },
            { key: 'numero', header: 'Carte', render: (v) => v.numero || '—' },
            { key: 'resultat', header: 'Résultat', render: (v) => <Badge className={v.resultat === 'VALIDE' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}>{v.resultat}</Badge> },
            { key: 'ip', header: 'Adresse' },
          ]} /></div>
        </>
      )}
    </Loadable>
  );
}

function Signature() {
  const state = useApi('/cartes/specimen');
  const user = useAuth((s) => s.user);
  const confirm = useConfirm();
  const [f, setF] = useState({ signataire: user.agent ? [user.agent.prenom, user.agent.nom, user.agent.postnom].filter(Boolean).join(' ') : '', qualite: 'Le Directeur', motDePasse: '', fichier: null });
  const [cle, setCle] = useState(0);
  const deposer = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('signature', f.fichier); fd.append('signataire', f.signataire); fd.append('qualite', f.qualite); fd.append('motDePasse', f.motDePasse);
    await runAction(() => api.post('/cartes/specimen', fd), 'Spécimen de signature enregistré.');
    setF({ ...f, motDePasse: '', fichier: null }); setCle((k) => k + 1); state.reload();
  };
  const retirer = async () => {
    if (!(await confirm({ title: 'Retirer le spécimen', message: 'Les cartes déjà imprimées ne sont pas modifiées.', danger: true }))) return;
    await runAction(() => api.delete('/cartes/specimen'), 'Spécimen retiré.'); state.reload();
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Spécimen en vigueur">
            {d.specimen ? (
              <div className="space-y-2 text-sm">
                <SignatureImage key={d.specimen.id} />
                <div><b>{d.specimen.signataire}</b> — {d.specimen.qualite}</div>
                <div className="text-xs text-slate-500">Déposé le {fmtDateTime(d.specimen.created_at)}</div>
                <button type="button" className="btn-secondary text-red-700" onClick={retirer}><Trash2 size={14} /> Retirer</button>
              </div>
            ) : <p className="text-sm text-slate-600">Aucun spécimen : les cartes s’impriment avec la mention « Le Directeur » sans signature, jusqu’au dépôt du spécimen.</p>}
          </Card>
          <Card title="Déposer mon spécimen de signature">
            <form onSubmit={deposer} className="space-y-3">
              <InfoAlert>Signez en noir ou en bleu sur papier blanc, numérisez, puis déposez l’image (PNG à fond transparent de préférence). Le spécimen s’applique aux cartes que vous validez.</InfoAlert>
              <Field label="Image de la signature" required><input key={cle} type="file" accept="image/png,image/jpeg" className="input" onChange={(e) => setF({ ...f, fichier: e.target.files[0] || null })} /></Field>
              <Field label="Nom du signataire" required><input className="input" value={f.signataire} onChange={(e) => setF({ ...f, signataire: e.target.value })} /></Field>
              <Field label="Qualité" required><input className="input" value={f.qualite} onChange={(e) => setF({ ...f, qualite: e.target.value })} /></Field>
              <Field label="Votre mot de passe" required><input type="password" className="input" autoComplete="current-password" value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} /></Field>
              <button type="submit" className="btn-primary" disabled={!f.fichier || !f.motDePasse || f.signataire.trim().length < 3}><Upload size={16} /> Enregistrer</button>
            </form>
          </Card>
        </div>
      )}
    </Loadable>
  );
}

function SignatureImage() {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let lien = null;
    api.get('/cartes/specimen/image', { responseType: 'blob' }).then((r) => { lien = URL.createObjectURL(r.data); setSrc(lien); }).catch(() => {});
    return () => { if (lien) URL.revokeObjectURL(lien); };
  }, []);
  return src ? <img src={src} alt="Spécimen de signature" className="h-20 rounded border border-slate-200 bg-white object-contain p-1" /> : null;
}

/** Registre des cartes de service (Directeur, Bureau Secrétariat de Direction). */
export default function CartesRegistre() {
  const can = useAuth((s) => s.can);
  const onglets = [
    { value: 'registre', label: 'Registre' },
    can('cartes.preparer') && { value: 'preparer', label: 'Préparer' },
    { value: 'verifications', label: 'Vérifications publiques' },
    can('cartes.valider') && { value: 'signature', label: 'Ma signature' },
  ].filter(Boolean);
  const [tab, setTab] = useState('registre');
  return (
    <>
      <PageHeader title="Cartes de service" subtitle="Préparation par le Bureau Secrétariat de Direction, validation par le Directeur, impression, remise et suivi. Validité : 5 ans."
        breadcrumb={[{ label: 'Administration' }, { label: 'Cartes de service' }]} />
      <Tabs value={tab} onChange={setTab} tabs={onglets} />
      <div className="mt-4">
        {tab === 'registre' && <Registre />}
        {tab === 'preparer' && <Preparer />}
        {tab === 'verifications' && <Verifications />}
        {tab === 'signature' && <Signature />}
      </div>
    </>
  );
}
