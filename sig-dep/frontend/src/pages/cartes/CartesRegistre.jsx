import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IdCard, Printer, Upload, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useApi, Loadable, PageHeader, Card, Tabs, useOnglet, useListParams, DataTable, Badge, InfoAlert, Field, Select, runAction, toast, useConfirm } from '../../components/ui';
import { ETATS_CARTE, MOTIFS_EMISSION } from './libelles';

const Etat = ({ s }) => <Badge className={ETATS_CARTE[s][1]}>{ETATS_CARTE[s][0]}</Badge>;

async function imprimerPlanche(ids) {
  const r = await api.post('/cartes/planche', { ids }, { responseType: 'blob' });
  const href = URL.createObjectURL(r.data);
  window.open(href, '_blank');
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

function Registre() {
  const { valeurs: v, set } = useListParams({ statut: '' });
  const statut = v.statut;
  const state = useApi(`/cartes${statut ? `?statut=${statut}` : ''}`, [statut]);
  const [choix, setChoix] = useState(new Set());
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const toggle = (id) => setChoix((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const planche = async () => {
    try { await imprimerPlanche([...choix]); toast.success('Planche générée : imprimez en recto-verso (bord long).'); setChoix(new Set()); state.reload(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const d = state.data;
  return (
        <div className="space-y-3">
          {d && <ul className="flex flex-wrap gap-2 text-xs" aria-label="Cartes par état">{Object.entries(d.parStatut).map(([s, n]) => <li key={s}><Badge className={ETATS_CARTE[s][1]}>{ETATS_CARTE[s][0]} : {n}</Badge></li>)}</ul>}
          <DataTable rows={d?.data || []} loading={state.loading} error={state.error} onRetry={state.reload} label="Registre des cartes de service"
            controle={{ q: v.q, page: v.page, tri: v.tri }} onControle={set} onRowClick={(c) => navigate(`/cartes/${c.id}`)}
            empty={statut ? 'Aucune carte dans cet état.' : 'Aucune carte de service.'}
            toolbar={<>
                <Select label="État" value={statut} onChange={(x) => set({ statut: x })} placeholder="Tous les états" options={Object.entries(ETATS_CARTE).map(([k, [l]]) => [k, l])} />
                {can('cartes.preparer') && <button type="button" className="btn-secondary" disabled={!choix.size} onClick={planche} title="Cochez des cartes validées, imprimées ou remises"><Printer size={16} aria-hidden /> Planche A4 ({choix.size})</button>}
            </>}
            columns={[
              ...(can('cartes.preparer') ? [{ key: 'sel', header: '', render: (c) => (['VALIDEE', 'IMPRIMEE', 'REMISE'].includes(c.statut)
                ? <input type="checkbox" aria-label={`Sélectionner ${c.numero}`} checked={choix.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.id)} /> : null) }] : []),
              { key: 'numero', header: 'N°', sortable: true, render: (c) => <span className="font-mono text-xs">{c.numero || '—'}</span> },
              { key: 'titulaire', header: 'Titulaire', render: (c) => <div><div className="font-medium">{c.titulaire}</div><div className="text-xs text-slate-500">{c.matricule}</div></div>, search: (c) => `${c.titulaire} ${c.matricule}` },
              { key: 'motif', header: 'Motif', render: (c) => MOTIFS_EMISSION[c.motif_emission] },
              { key: 'statut', header: 'État', render: (c) => <Etat s={c.statut} /> },
              { key: 'validite', header: 'Validité', render: (c) => (c.date_expiration ? `${fmtDate(c.date_delivrance)} → ${fmtDate(c.date_expiration)}` : '—') },
              { key: 'impressions', header: 'Impressions', render: (c) => c.nb_impressions || '—' },
            ]} />
        </div>
  );
}

function Preparer() {
  const state = useApi('/cartes/agents');
  const navigate = useNavigate();
  const preparer = async (a, motif) => {
    const r = await runAction(() => api.post('/cartes', { agent_id: a.id, motif_emission: motif }), 'Carte en préparation.').catch(() => null);
    if (r) navigate(`/cartes/${r.data.id}`);
  };
  return (
    <Loadable state={state}>
      {(d) => (
        <DataTable rows={d.data} label="Agents et cartes" columns={[
          { key: 'nom', header: 'Agent', render: (a) => <div><div className="font-medium">{[a.prenom, a.nom, a.postnom].filter(Boolean).join(' ')}</div><div className="text-xs text-slate-500">{a.matricule}</div></div>, search: (a) => `${a.nom} ${a.prenom} ${a.matricule}` },
          { key: 'structure', header: 'Affectation' },
          { key: 'photo', header: 'Photo', render: (a) => (a.photo ? 'Oui' : <span className="font-medium text-orange-800">Manquante</span>) },
          { key: 'cartes', header: 'Carte', render: (a) => (a.cartes.length ? a.cartes.map((c) => <button key={c.id} type="button" className="mr-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-dep-400" aria-label={`Ouvrir la carte (${ETATS_CARTE[c.statut][0]})`} onClick={() => navigate(`/cartes/${c.id}`)}><Etat s={c.statut} /></button>) : <span className="text-slate-500">Aucune</span>) },
          { key: 'a', header: '', render: (a) => {
            const enPrep = a.cartes.some((c) => ['BROUILLON', 'A_COMPLETER', 'VERIFIEE'].includes(c.statut));
            const enCirc = a.cartes.some((c) => ['VALIDEE', 'IMPRIMEE', 'REMISE', 'SUSPENDUE'].includes(c.statut));
            if (enPrep) return null;
            return enCirc
              ? <button type="button" className="btn-secondary btn-sm" onClick={() => preparer(a, 'RENOUVELLEMENT')}>Renouveler</button>
              : <button type="button" className="btn-primary btn-sm" onClick={() => preparer(a, 'PREMIERE')}><IdCard size={14} aria-hidden /> Préparer</button>;
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
          <div className="mt-3"><DataTable rows={d.data} label="Vérifications publiques" columns={[
            { key: 'created_at', header: 'Date', sortValue: (v) => v.created_at, render: (v) => fmtDateTime(v.created_at) },
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
  const [enCours, setEnCours] = useState(false);
  const deposer = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('signature', f.fichier); fd.append('signataire', f.signataire); fd.append('qualite', f.qualite); fd.append('motDePasse', f.motDePasse);
    setEnCours(true);
    try {
      await runAction(() => api.post('/cartes/specimen', fd), 'Spécimen de signature enregistré.');
      setF({ ...f, motDePasse: '', fichier: null }); setCle((k) => k + 1); state.reload();
    } catch { /* erreur déjà signalée */ } finally { setEnCours(false); }
  };
  const retirer = async () => {
    if (!(await confirm({ title: 'Retirer le spécimen', message: 'Les cartes déjà imprimées ne sont pas modifiées.', danger: true }))) return;
    await runAction(() => api.delete('/cartes/specimen'), 'Spécimen retiré.').catch(() => null); state.reload();
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
                <button type="button" className="btn-secondary text-red-700" onClick={retirer}><Trash2 size={14} aria-hidden /> Retirer le spécimen</button>
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
              <button type="submit" className="btn-primary" disabled={enCours || !f.fichier || !f.motDePasse || f.signataire.trim().length < 3}><Upload size={16} aria-hidden /> {enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
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
  const [tab, setTab] = useOnglet('registre', { valeurs: onglets.map((t) => t.value) });
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
