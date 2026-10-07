import { Link, useParams } from 'react-router-dom';
import { Archive, CheckCircle2, Pencil, Send, ShieldCheck, Undo2 } from 'lucide-react';
import api from '../../lib/api';
import { useApi, Loadable, PageHeader, Card, KeyValues, StatusBadge, runAction, useConfirm, InfoAlert, Button, WorkflowPanel, DetailLayout } from '../../components/ui';
import { Attachments, DynamicValue, ExportButtons, Timeline } from '../../components/shared';
import { fmtDateTime, fmtMontant } from '../../lib/format';
import { circuitPip } from '../../lib/workflows';

function attente(p) {
  if (p.statut === 'ARCHIVE') return 'Circuit terminé : la fiche est archivée.';
  if (p.statut === 'VALIDE') return 'Fiche validée par le Directeur.';
  return p.detenteur_nom ? `Fiche actuellement entre les mains de ${p.detenteur_nom}.` : null;
}

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
                {a.modifier && <Link to={`/pip/${id}/modifier`} className="btn-secondary"><Pencil size={16} aria-hidden /> Modifier</Link>}
              </>} />
            <WorkflowPanel circuit={circuitPip(p)} attente={attente(p)}
              message={p.rubriquesManquantes.length > 0 && a.modifier && <InfoAlert tone="warning">{p.rubriquesManquantes.length} rubrique(s) obligatoire(s) à compléter avant soumission : {p.rubriquesManquantes.slice(0, 5).join(' ; ')}{p.rubriquesManquantes.length > 5 ? '…' : ''}</InfoAlert>}
              actions={[
                a.soumettre && <Button key="so" variant="primary" icon={Send} onClick={() => act('soumettre', 'Fiche soumise pour vérification.')}>Soumettre</Button>,
                a.verifier && <Button key="ve" variant="success" icon={ShieldCheck} onClick={() => act('verifier', 'Fiche vérifiée.', { title: 'Vérifier la fiche', message: 'La fiche sera marquée vérifiée et transmise au Directeur pour validation.', input: { label: 'Observations (facultatif)' } })}>Vérifier</Button>,
                a.valider && <Button key="va" variant="success" icon={CheckCircle2} onClick={() => act('valider', 'Fiche PIP validée.', { title: 'Valider la fiche PIP', message: 'Validation définitive par le Directeur.', input: { label: 'Observations (facultatif)' } })}>Valider</Button>,
                a.retourner && <Button key="re" icon={Undo2} onClick={() => act('retourner', 'Fiche retournée pour correction.', { title: 'Retourner pour correction', message: 'La fiche sera renvoyée à son auteur.', input: { label: 'Corrections demandées', required: true }, danger: true })}>Retourner</Button>,
                a.archiver && <Button key="ar" icon={Archive} onClick={() => act('archiver', 'Fiche archivée.')}>Archiver</Button>,
              ]} />
            <DetailLayout
              main={(modele.data?.sections || []).map((s) => (
                <Card key={s.key} title={`${s.numero}. ${s.label}`}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {s.fields.map((f) => <div key={f.key} className={['textarea', 'list', 'table'].includes(f.type) ? 'sm:col-span-2' : ''}><div className="mb-1 text-xs font-medium uppercase text-slate-500">{f.label}</div><DynamicValue field={f} value={p.donnees[s.key]?.[f.key]} /></div>)}
                  </div>
                </Card>
              ))}
              aside={<>
                <Card title="Page de contrôle">
                  <KeyValues cols={1} items={[
                    ['Statut', <StatusBadge key="s" value={p.statut} feminin />], ['Structure', pc.structure], ['Élaborée par', `${pc.elaborePar} — ${fmtDateTime(pc.elaboreLe)}`],
                    ['Vérifiée par', pc.verifiePar ? `${pc.verifiePar} — ${fmtDateTime(pc.verifieLe)}` : '—'], ['Validée par', pc.validePar ? `${pc.validePar} — ${fmtDateTime(pc.valideLe)}` : '—'],
                    ['Détenteur actuel', p.detenteur_nom], ['Complétude', pc.completude],
                  ]} />
                </Card>
                <Card title="Pièces jointes (études, annexes)"><Attachments type="PIP" id={id} canUpload={a.modifier} /></Card>
                <Card title="Historique"><Timeline items={p.historique} /></Card>
              </>} />
          </>
        );
      }}
    </Loadable>
  );
}
