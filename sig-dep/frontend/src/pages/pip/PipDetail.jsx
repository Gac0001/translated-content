import { Link, useParams } from 'react-router-dom';
import { Archive, CheckCircle2, Pencil, Send, ShieldCheck, Undo2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, runAction, useConfirm, InfoAlert } from '../../components/ui';
import { Attachments, DynamicValue, ExportButtons, Timeline } from '../../components/shared';
import { fmtDateTime, fmtMontant } from '../../lib/format';

export default function PipDetail() {
  const { id } = useParams();
  const state = useApi(`/pip/${id}`);
  const modele = useApi('/pip/modele');
  const confirm = useConfirm();
  const act = async (path, msg, opts) => {
    let body = {};
    if (opts) { const r = await confirm(opts); if (r === false) return; if (typeof r === 'string') body = { commentaire: r || undefined }; }
    await runAction(() => api.post(`/pip/${id}/${path}`, body), msg);
    state.reload();
  };
  return (
    <Loadable state={state}>
      {(p) => {
        const a = p.actions;
        const pc = p.pageControle;
        return (
          <>
            <PageHeader title={p.intitule} subtitle={`${p.code} · version ${p.version} · ${fmtMontant(p.cout_total, p.devise)}`} breadcrumb={[{ label: 'Projets PIP', to: '/pip' }, { label: p.code }]}
              actions={<>
                <ExportButtons base={`/pip/${id}/export`} />
                {a.modifier && <Link to={`/pip/${id}/modifier`} className="btn-secondary"><Pencil size={16} /> Modifier</Link>}
                {a.soumettre && <button type="button" className="btn-primary" onClick={() => act('soumettre', 'Fiche soumise pour vérification.')}><Send size={16} /> Soumettre</button>}
                {a.verifier && <button type="button" className="btn-success" onClick={() => act('verifier', 'Fiche vérifiée.', { title: 'Vérifier la fiche', message: 'La fiche sera marquée vérifiée et transmise au Directeur pour validation.', input: { label: 'Observations (facultatif)' } })}><ShieldCheck size={16} /> Vérifier</button>}
                {a.valider && <button type="button" className="btn-success" onClick={() => act('valider', 'Fiche PIP validée.', { title: 'Valider la fiche PIP', message: 'Validation définitive par le Directeur.', input: { label: 'Observations (facultatif)' } })}><CheckCircle2 size={16} /> Valider</button>}
                {a.retourner && <button type="button" className="btn-secondary" onClick={() => act('retourner', 'Fiche retournée pour correction.', { title: 'Retourner pour correction', message: 'La fiche sera renvoyée à son auteur.', input: { label: 'Corrections demandées', required: true }, danger: true })}><Undo2 size={16} /> Retourner</button>}
                {a.archiver && <button type="button" className="btn-secondary" onClick={() => act('archiver', 'Fiche archivée.')}><Archive size={16} /> Archiver</button>}
              </>} />
            {p.rubriquesManquantes.length > 0 && a.modifier && <div className="mb-3"><InfoAlert tone="warning">{p.rubriquesManquantes.length} rubrique(s) obligatoire(s) à compléter avant soumission : {p.rubriquesManquantes.slice(0, 5).join(' ; ')}{p.rubriquesManquantes.length > 5 ? '…' : ''}</InfoAlert></div>}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {(modele.data?.sections || []).map((s) => (
                  <Card key={s.key} title={`${s.numero}. ${s.label}`}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {s.fields.map((f) => <div key={f.key} className={['textarea', 'list', 'table'].includes(f.type) ? 'sm:col-span-2' : ''}><div className="mb-1 text-xs font-medium uppercase text-slate-500">{f.label}</div><DynamicValue field={f} value={p.donnees[s.key]?.[f.key]} /></div>)}
                    </div>
                  </Card>
                ))}
              </div>
              <div className="space-y-4">
                <Card title="Page de contrôle">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={p.statut} />], ['Structure', pc.structure], ['Élaborée par', `${pc.elaborePar} — ${fmtDateTime(pc.elaboreLe)}`],
                    ['Vérifiée par', pc.verifiePar ? `${pc.verifiePar} — ${fmtDateTime(pc.verifieLe)}` : '—'], ['Validée par', pc.validePar ? `${pc.validePar} — ${fmtDateTime(pc.valideLe)}` : '—'],
                    ['Détenteur actuel', p.detenteur_nom], ['Complétude', pc.completude],
                  ]} />
                </Card>
                <Card title="Pièces jointes (études, annexes)"><Attachments type="PIP" id={id} canUpload={a.modifier} /></Card>
                <Card title="Historique"><Timeline items={p.historique} /></Card>
              </div>
            </div>
          </>
        );
      }}
    </Loadable>
  );
}
