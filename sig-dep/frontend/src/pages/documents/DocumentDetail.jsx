import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, CheckCircle2, Eye, MessageSquarePlus, Pencil, Send, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, ConfidBadge, Modal, runAction, useConfirm, InfoAlert, Badge, Button, IconButton, WorkflowPanel, DetailLayout } from '../../components/ui';
import { Attachments, DynamicValue, ExportButtons, Timeline } from '../../components/shared';
import { fmtDateTime } from '../../lib/format';
import { ROLES } from '../../lib/labels';
import { circuitDocument } from '../../lib/workflows';

function VersionModal({ docId, numero, type, onClose }) {
  const v = useApi(`/documents/${docId}/versions/${numero}`);
  return (
    <Modal open size="xl" title={`Version ${numero}`} onClose={onClose}>
      <Loadable state={v}>{(x) => <div className="space-y-4"><h3 className="font-semibold">{x.titre}</h3>{type.sections.map((s) => <div key={s.key}><div className="mb-1 text-xs font-semibold uppercase text-slate-500">{s.label}</div><DynamicValue field={s} value={x.contenu[s.key]} /></div>)}</div>}</Loadable>
    </Modal>
  );
}

function attente(d) {
  if (d.statut === 'ARCHIVE') return 'Circuit terminé : le document est archivé.';
  if (d.statut === 'VALIDE') return 'Document validé et signé par le Directeur.';
  if (d.statut === 'REJETE') return 'Document rejeté par le Directeur.';
  return d.detenteur_nom ? `Document actuellement entre les mains de ${d.detenteur_nom}.` : null;
}

export default function DocumentDetail() {
  const { id } = useParams();
  const state = useApi(`/documents/${id}`);
  const confirm = useConfirm();
  const [version, setVersion] = useState(null);
  const [comment, setComment] = useState('');
  const act = async (path, msg, opts) => {
    let body = {};
    if (opts) {
      const r = await confirm(opts);
      if (r === false) return;
      if (typeof r === 'string') body = { commentaire: r || undefined };
    }
    await runAction(() => api.post(`/documents/${id}/${path}`, body), msg);
    state.reload();
  };
  const addComment = async () => { await runAction(() => api.post(`/documents/${id}/commentaires`, { texte: comment }), 'Commentaire ajouté.'); setComment(''); state.reload(); };
  return (
    <Loadable state={state}>
      {(d) => {
        const a = d.actions;
        return (
          <>
            <PageHeader title={d.titre} subtitle={`${d.type.libelle} · ${d.reference} · version ${d.version_courante}`} breadcrumb={[{ label: 'Documents', to: '/documents' }, { label: d.reference }]}
              actions={<>
                <ExportButtons base={`/documents/${id}/export`} formats={['pdf', 'docx', ...(d.type.sections.some((s) => s.type === 'table') ? ['xlsx'] : [])]} />
                {a.modifier && <Link to={`/documents/${id}/modifier`} className="btn-secondary"><Pencil size={16} aria-hidden /> Modifier</Link>}
              </>} />
            <WorkflowPanel circuit={circuitDocument(d)} attente={attente(d)}
              message={d.statut === 'A_CORRIGER' && a.modifier && <InfoAlert tone="warning">Document retourné pour correction : consultez les commentaires, modifiez puis retransmettez.</InfoAlert>}
              actions={[
                a.transmettre && <Button key="tr" variant="primary" icon={Send} onClick={() => act('transmettre', 'Document transmis au supérieur hiérarchique.', { title: 'Transmettre', message: 'Le document sera transmis à votre supérieur hiérarchique direct.', input: { label: 'Commentaire (facultatif)' } })}>Transmettre</Button>,
                a.retourner && <Button key="re" icon={Undo2} onClick={() => act('retourner', 'Document retourné pour correction.', { title: 'Retourner pour correction', message: 'Le document sera renvoyé à son auteur.', input: { label: 'Corrections demandées', required: true }, danger: true })}>Retourner</Button>,
                a.validerDivision && <Button key="vd" variant="success" icon={ShieldCheck} onClick={() => act('valider-division', 'Validé au niveau de la Division.', { title: 'Valider au niveau de la Division', message: 'Votre visa de Chef de Division sera apposé.', input: { label: 'Commentaire (facultatif)' } })}>Valider (Division)</Button>,
                a.valider && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => act('valider', 'Document validé et signé.', { title: 'Validation définitive', message: 'Le document sera validé et signé par le Directeur.', input: { label: 'Commentaire (facultatif)' } })}>Valider et signer</Button>,
                a.rejeter && <Button key="rj" variant="danger" icon={XCircle} onClick={() => act('rejeter', 'Document rejeté.', { title: 'Rejeter le document', message: 'Le rejet est définitif pour cette version.', input: { label: 'Motif du rejet', required: true }, danger: true })}>Rejeter</Button>,
                a.archiver && <Button key="ar" icon={Archive} onClick={() => act('archiver', 'Document archivé.')}>Archiver</Button>,
              ]} />
            <DetailLayout
              main={<>
                <Card title="Contenu">
                  <div className="space-y-5">
                    {d.type.sections.map((s, i) => <div key={s.key}><h3 className="mb-1 text-sm font-semibold text-dep-800">{i + 1}. {s.label}</h3><DynamicValue field={s} value={d.contenu[s.key]} /></div>)}
                  </div>
                </Card>
                <Card title="Commentaires et corrections">
                  <ul className="space-y-3">{d.commentaires.map((c) => <li key={c.id} className={`rounded-md border p-3 text-sm ${c.type === 'CORRECTION' ? 'border-orange-200 bg-orange-50' : 'border-slate-200'}`}><div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><b className="text-slate-700">{c.auteur}</b>{fmtDateTime(c.created_at)} · v{c.version_numero}{c.type === 'CORRECTION' && <Badge tone="orange">Correction demandée</Badge>}</div><p className="whitespace-pre-line">{c.texte}</p></li>)}</ul>
                  {!d.commentaires.length && <p className="text-sm text-slate-500">Aucun commentaire.</p>}
                  {a.commenter && (
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row no-print">
                      <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ajouter un commentaire…" aria-label="Nouveau commentaire" />
                      <Button icon={MessageSquarePlus} className="self-start" disabled={comment.trim().length < 2} onClick={addComment}>Commenter</Button>
                    </div>
                  )}
                </Card>
                <Card title="Historique de validation"><Timeline items={d.historique} /></Card>
              </>}
              aside={<>
                <Card title="Informations">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={d.statut} />], ['Confidentialité', <ConfidBadge key="c" value={d.confidentialite} />],
                    ['Auteur', d.auteur_nom], ['Structure', d.bureau_nom || d.division_nom || 'Direction'], ['Détenteur actuel', d.detenteur_nom],
                    d.valide_at && ['Validé le', fmtDateTime(d.valide_at)],
                  ]} />
                </Card>
                <Card title="Visas et signature">
                  {d.visas.length ? <ul className="space-y-2 text-sm">{d.visas.map((v, i) => <li key={i} className="flex items-start gap-2"><ShieldCheck size={16} className={`mt-0.5 shrink-0 ${v.type === 'SIGNATURE' ? 'text-emerald-600' : 'text-dep-600'}`} aria-hidden /><div><b>{v.type === 'SIGNATURE' ? 'Signature' : v.type === 'VALIDATION_DIVISION' ? 'Validation (Division)' : 'Visa'}</b> — {v.nom} ({ROLES[v.role]})<div className="text-xs text-slate-500">{fmtDateTime(v.date)}</div></div></li>)}</ul> : <p className="text-sm text-slate-500">Aucun visa.</p>}
                </Card>
                <Card title="Versions (conservées)">
                  <ul className="divide-y divide-slate-100 text-sm">{d.versions.map((v) => <li key={v.id} className="flex items-center justify-between gap-2 py-1.5"><span><b>v{v.numero}</b> — {v.commentaire}<span className="block text-xs text-slate-500">{v.auteur} · {fmtDateTime(v.created_at)}</span></span><IconButton label={`Voir la version ${v.numero}`} icon={Eye} className="px-2" onClick={() => setVersion(v.numero)} /></li>)}</ul>
                </Card>
                <Card title="Pièces jointes"><Attachments type="DOCUMENT" id={id} canUpload={a.modifier || a.transmettre} /></Card>
              </>} />
            {version && <VersionModal docId={id} numero={version} type={d.type} onClose={() => setVersion(null)} />}
          </>
        );
      }}
    </Loadable>
  );
}
