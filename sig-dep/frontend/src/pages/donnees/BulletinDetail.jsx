import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, FileDown, Pencil, Save, Send, Undo2, Megaphone } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, InfoAlert, Field, Modal, DataTable, runAction, toast, useConfirm } from '../../components/ui';
import { Timeline } from '../../components/shared';
import { fmtDateTime } from '../../lib/format';
import { TextModal } from '../instructions/WorkflowActions';
import { Barres, Evolution, fmtVal } from './Indicateurs';

export const TYPES_BULLETIN = { BULLETIN: 'Bulletin', BAROMETRE: 'Baromètre' };

/** Rédaction d’un bulletin : en-tête, indicateurs retenus, parties rédigées. */
export function BulletinForm({ bulletin, onClose, onSaved }) {
  const inds = useApi('/donnees/indicateurs');
  const [f, setF] = useState({ type: 'BULLETIN', titre: '', periode: '', indicateurs: [], diffusion_sg: false, contenu: {}, ...bulletin });
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const upC = (k) => (e) => setF({ ...f, contenu: { ...f.contenu, [k]: e.target.value } });
  const enregistrer = async () => {
    const b = { type: f.type, titre: f.titre, periode: f.periode, indicateurs: f.indicateurs, diffusion_sg: f.diffusion_sg, contenu: { introduction: f.contenu.introduction || null, analyse: f.contenu.analyse || null, conclusion: f.contenu.conclusion || null } };
    const r = await runAction(() => (f.id ? api.put(`/donnees/bulletins/${f.id}`, b) : api.post('/donnees/bulletins', b)), 'Bulletin enregistré.');
    onSaved(r.data);
  };
  return (
    <Modal open size="xl" title={f.id ? f.reference : 'Nouveau bulletin ou baromètre'} onClose={onClose} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Annuler</button><button type="button" className="btn-primary" onClick={enregistrer}><Save size={16} /> Enregistrer</button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Type"><select className="input" value={f.type} onChange={up('type')}>{Object.entries(TYPES_BULLETIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Titre" required className="sm:col-span-2"><input className="input" value={f.titre} onChange={up('titre')} /></Field>
        <Field label="Période couverte" required><input className="input" value={f.periode} onChange={up('periode')} placeholder="Ex. Année 2025" /></Field>
        <Field label="Indicateurs présentés (dans l’ordre de sélection)" className="sm:col-span-4">
          <div className="flex flex-wrap gap-1.5">{(inds.data?.data || []).filter((i) => i.actif).map((i) => {
            const on = f.indicateurs.includes(i.id);
            return <button key={i.id} type="button" aria-pressed={on} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-dep-600 bg-dep-50 text-dep-800' : 'border-slate-300 text-slate-600'}`} onClick={() => setF({ ...f, indicateurs: on ? f.indicateurs.filter((x) => x !== i.id) : [...f.indicateurs, i.id] })}>{on && `${f.indicateurs.indexOf(i.id) + 1}. `}{i.libelle}</button>;
          })}</div>
        </Field>
        <Field label="Introduction" className="sm:col-span-4"><textarea className="input" rows={3} value={f.contenu.introduction || ''} onChange={upC('introduction')} /></Field>
        <Field label="Analyse" className="sm:col-span-4"><textarea className="input" rows={6} value={f.contenu.analyse || ''} onChange={upC('analyse')} /></Field>
        <Field label="Conclusion et recommandations" className="sm:col-span-4"><textarea className="input" rows={3} value={f.contenu.conclusion || ''} onChange={upC('conclusion')} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={f.diffusion_sg} onChange={(e) => setF({ ...f, diffusion_sg: e.target.checked })} /> Diffuser aussi au Secrétaire Général (sinon : Direction seule)</label>
      </div>
    </Modal>
  );
}

/** Bulletins et baromètres : liste. */
export function Bulletins({ referentiel }) {
  const state = useApi('/donnees/bulletins');
  const navigate = useNavigate();
  const [nouveau, setNouveau] = useState(false);
  return (
    <Loadable state={state}>
      {(r) => (
        <>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <InfoAlert>Diffusion interne : rédaction par les Bureaux de la Division Études, Documentation et Information, visa du Chef de Division, autorisation du Directeur (qui vaut diffusion). Un bulletin diffusé est figé.</InfoAlert>
            {referentiel.droits.rediger && <button type="button" className="btn-primary" onClick={() => setNouveau(true)}>Nouveau bulletin</button>}
          </div>
          <DataTable rows={r.data} onRowClick={(b) => navigate(`/donnees/bulletins/${b.id}`)} empty="Aucun bulletin."
            columns={[
              { key: 'titre', header: 'Bulletin', render: (b) => <div><div className="font-medium">{b.titre}</div><div className="text-xs text-slate-500">{TYPES_BULLETIN[b.type]} · {b.reference}</div></div>, search: (b) => `${b.titre} ${b.reference} ${b.periode}` },
              { key: 'periode', header: 'Période' },
              { key: 'redacteur', header: 'Rédacteur' },
              { key: 'diffuse_at', header: 'Diffusé le', render: (b) => (b.diffuse_at ? fmtDateTime(b.diffuse_at) : '—') },
              { key: 'statut', header: 'Statut', render: (b) => <StatusBadge value={b.statut} /> },
            ]} />
          {nouveau && <BulletinForm onClose={() => setNouveau(false)} onSaved={(b) => navigate(`/donnees/bulletins/${b.id}`)} />}
        </>
      )}
    </Loadable>
  );
}

export default function BulletinDetail() {
  const { id } = useParams();
  const state = useApi(`/donnees/bulletins/${id}`, [id]);
  const can = useAuth((s) => s.can);
  const confirm = useConfirm();
  const [modal, setModal] = useState(null);
  const post = async (path, body, msg) => { await runAction(() => api.post(`/donnees/bulletins/${id}/${path}`, body), msg); setModal(null); state.reload(); };
  return (
    <Loadable state={state}>
      {(b) => {
        const a = b.actions;
        const autoriser = async () => {
          if (!(await confirm({ title: 'Autoriser la diffusion', message: `Le ${b.type_libelle.toLowerCase()} sera diffusé à toute la Direction${b.diffusion_sg ? ' et au Secrétaire Général' : ''} ; son contenu et ses valeurs seront figés.`, confirmLabel: 'Autoriser et diffuser' }))) return;
          post('autoriser', {}, 'Diffusion interne autorisée.');
        };
        return (
          <>
            <PageHeader title={b.titre} subtitle={`${b.type_libelle} · ${b.reference} · ${b.periode}`} breadcrumb={[{ label: 'Données sectorielles', to: '/donnees' }, { label: b.reference }]}
              actions={<>
                {can('exports.generer') && <button type="button" className="btn-secondary" onClick={() => download(`/donnees/bulletins/${id}/pdf`, `${b.reference}.pdf`).catch((e) => toast.error(errorMessage(e)))}><FileDown size={16} /> PDF</button>}
                {a.modifier && <button type="button" className="btn-secondary" onClick={() => setModal('edition')}><Pencil size={16} /> Rédiger</button>}
                {a.soumettre && <button type="button" className="btn-primary" onClick={() => post('soumettre', {}, 'Bulletin soumis au visa du Chef de Division.')}><Send size={16} /> Soumettre au visa</button>}
                {a.viser && <button type="button" className="btn-success" onClick={() => post('viser', {}, 'Bulletin visé : transmis au Directeur.')}><CheckCircle2 size={16} /> Viser</button>}
                {a.autoriser && <button type="button" className="btn-success" onClick={autoriser}><Megaphone size={16} /> Autoriser la diffusion</button>}
                {a.retourner && <button type="button" className="btn-secondary" onClick={() => setModal('retour')}><Undo2 size={16} /> Retourner</button>}
              </>} />
            {b.statut === 'A_CORRIGER' && <div className="mb-3"><InfoAlert tone="warning"><b>À corriger</b> : {b.observations}</InfoAlert></div>}
            {b.statut !== 'DIFFUSE' && <div className="mb-3"><InfoAlert>Projet non diffusé : les valeurs sont recalculées à chaque consultation et seront figées à l’autorisation du Directeur.</InfoAlert></div>}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {b.contenu.introduction && <Card title="Introduction"><p className="whitespace-pre-line text-sm">{b.contenu.introduction}</p></Card>}
                {b.donnees.map((d, k) => {
                  const s = d.serie;
                  const der = s[s.length - 1];
                  return (
                    <Card key={d.id} title={`${k + 1}. ${d.libelle}${d.unite ? ` (${d.unite})` : ''}`}>
                      {!der ? <p className="text-sm text-slate-500">Aucune donnée validée.</p> : (
                        <div className="grid gap-4 md:grid-cols-2">
                          <table className="text-sm">
                            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1 pr-3">Période</th><th className="pr-3 text-right">Valeur</th><th className="text-right">Évolution</th></tr></thead>
                            <tbody>{s.map((x, i) => <tr key={x.campagne_id} className="border-t border-slate-100"><td className="py-1 pr-3">{x.periode}</td><td className="pr-3 text-right tabular-nums">{fmtVal(x.valeur, d.decimales)}</td><td className="text-right text-xs"><Evolution v={x.valeur} p={i ? s[i - 1].valeur : null} /></td></tr>)}</tbody>
                          </table>
                          <div><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Par province — {der.periode}</div><Barres rows={der.zones} decimales={d.decimales} unite={d.unite} label={`${d.libelle} par province`} /></div>
                        </div>
                      )}
                    </Card>
                  );
                })}
                {b.contenu.analyse && <Card title="Analyse"><p className="whitespace-pre-line text-sm">{b.contenu.analyse}</p></Card>}
                {b.contenu.conclusion && <Card title="Conclusion et recommandations"><p className="whitespace-pre-line text-sm">{b.contenu.conclusion}</p></Card>}
              </div>
              <div className="space-y-4">
                <Card title="Circuit">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={b.statut} />], ['Rédigé par', b.redacteur || '—'], ['Visé par', b.viseur ? `${b.viseur} — ${fmtDateTime(b.vise_at)}` : '—'],
                    ['Diffusion autorisée par', b.autorisateur ? `${b.autorisateur} — ${fmtDateTime(b.diffuse_at)}` : '—'], ['Diffusion', b.diffusion_sg ? 'Direction et Secrétaire Général' : 'Direction'],
                  ]} />
                </Card>
                <Card title="Historique"><Timeline items={b.historique} /></Card>
              </div>
            </div>
            {modal === 'edition' && <BulletinForm bulletin={b} onClose={() => setModal(null)} onSaved={() => { setModal(null); state.reload(); }} />}
            {modal === 'retour' && <TextModal title="Retourner pour correction" label="Corrections demandées" confirmLabel="Retourner" onClose={() => setModal(null)} onSave={(t) => post('retourner', { motif: t }, 'Bulletin retourné au rédacteur.')} />}
          </>
        );
      }}
    </Loadable>
  );
}
