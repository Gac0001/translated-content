import { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { fmtNombre } from '../../lib/format';
import { useApi, Loadable, Card, Field, InfoAlert, EmptyState, SimpleTable, toast } from '../../components/ui';

const nb = (v) => fmtNombre(v, 2);

/** Tableaux croisés sur une campagne validée : lignes × colonnes, mesure (répondants, somme, moyenne). */
export default function Tableaux() {
  const campagnes = useApi('/donnees/campagnes');
  const [f, setF] = useState({ campagne_id: '', lignes: 'zone', colonnes: '', mesure: 'NOMBRE' });
  const [questions, setQuestions] = useState([]);
  const [res, setRes] = useState(null);
  useEffect(() => {
    if (!f.campagne_id) return;
    api.get(`/donnees/campagnes/${f.campagne_id}`).then((r) => setQuestions(r.data.version.questions)).catch((e) => toast.error(errorMessage(e)));
  }, [f.campagne_id]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  useEffect(() => {
    if (!f.campagne_id) { setRes(null); return; }
    api.get(`/donnees/tableaux?${qs}`).then((r) => setRes(r.data)).catch((e) => { setRes(null); toast.error(errorMessage(e)); });
  }, [qs, f.campagne_id]);
  const dims = [['zone', 'Province'], ['categorie', 'Catégorie d’acteurs'], ...questions.filter((q) => ['CHOIX', 'CHOIX_MULTIPLE', 'OUI_NON'].includes(q.type)).map((q) => [`q:${q.code}`, q.libelle])];
  const mesures = [['NOMBRE', 'Nombre de répondants'], ...questions.filter((q) => ['NOMBRE', 'ENTIER'].includes(q.type)).flatMap((q) => [[`SOMME:${q.code}`, `Somme — ${q.libelle}`], [`MOYENNE:${q.code}`, `Moyenne — ${q.libelle}`]])];
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Loadable state={campagnes}>
      {(c) => {
        const validees = c.data.filter((x) => x.statut === 'VALIDEE');
        if (!validees.length) return <div className="card"><EmptyState title="Aucune campagne validée">Les tableaux croisés portent sur les données contrôlées et validées : ils seront disponibles dès la validation d’une première campagne.</EmptyState></div>;
        return (
          <div className="space-y-4">
            <Card title="Paramètres">
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Campagne validée"><select className="input" value={f.campagne_id} onChange={(e) => setF({ ...f, campagne_id: e.target.value, colonnes: '', mesure: 'NOMBRE', lignes: 'zone' })}><option value="">—</option>{validees.map((x) => <option key={x.id} value={x.id}>{x.titre} ({x.periode})</option>)}</select></Field>
                <Field label="En lignes"><select className="input" value={f.lignes} onChange={up('lignes')}>{dims.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="En colonnes"><select className="input" value={f.colonnes} onChange={up('colonnes')}><option value="">— (total seul)</option>{dims.filter(([k]) => k !== f.lignes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Mesure"><select className="input" value={f.mesure} onChange={up('mesure')}>{mesures.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              </div>
            </Card>
            {res && (
              <Card title={res.titre} bodyClass="p-0" actions={<button type="button" className="btn-secondary" onClick={() => download(`/donnees/tableaux/export?${qs}`, 'Tableau.xlsx').catch((e) => toast.error(errorMessage(e)))}><FileSpreadsheet size={16} aria-hidden /> Excel</button>}>
                <SimpleTable label={res.titre} dense figee rowKey="libelle"
                  columns={[
                    { key: 'libelle', header: <span className="sr-only">Ligne</span> },
                    ...res.colonnes.map((x, k) => ({ key: `c${k}`, header: x, align: 'right', render: (l) => nb(l.valeurs[k]) })),
                    ...(res.colonnes.length > 1 ? [{ key: 'total', header: 'Total', align: 'right', className: 'font-semibold', render: (l) => nb(l.total) }] : []),
                  ]}
                  rows={res.lignes} footer={[{ libelle: 'Total', valeurs: res.totaux, total: res.total }]} />
                <p className="px-3 py-2 text-xs text-slate-500">{res.repondants} répondant(s) — {res.campagne.reference}. Une réponse à choix multiples compte dans chacune des options cochées.</p>
              </Card>
            )}
            {!f.campagne_id && <InfoAlert>Choisissez une campagne validée, puis les dimensions à croiser.</InfoAlert>}
          </div>
        );
      }}
    </Loadable>
  );
}
