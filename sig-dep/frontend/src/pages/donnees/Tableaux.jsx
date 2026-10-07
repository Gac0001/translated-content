import { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import api, { download, errorMessage } from '../../lib/api';
import { useApi, Loadable, Card, Field, InfoAlert, Empty, toast } from '../../components/ui';

const nb = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

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
        if (!validees.length) return <Empty message="Aucune campagne validée : les tableaux portent sur les données contrôlées et validées." />;
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
              <Card title={res.titre} bodyClass="p-0" actions={<button type="button" className="btn-secondary" onClick={() => download(`/donnees/tableaux/export?${qs}`, 'Tableau.xlsx').catch((e) => toast.error(errorMessage(e)))}><FileSpreadsheet size={16} /> Excel</button>}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead><tr className="border-b bg-slate-50 text-xs uppercase text-slate-500"><th className="px-3 py-2 text-left" />{res.colonnes.map((x) => <th key={x} className="px-3 text-right">{x}</th>)}{res.colonnes.length > 1 && <th className="px-3 text-right">Total</th>}</tr></thead>
                    <tbody>
                      {res.lignes.map((l) => (
                        <tr key={l.libelle} className="border-b border-slate-100 hover:bg-slate-50"><td className="px-3 py-1.5">{l.libelle}</td>{l.valeurs.map((v, k) => <td key={k} className="px-3 text-right tabular-nums">{nb(v)}</td>)}{res.colonnes.length > 1 && <td className="px-3 text-right font-semibold tabular-nums">{nb(l.total)}</td>}</tr>
                      ))}
                      <tr className="bg-slate-50 font-semibold"><td className="px-3 py-1.5">Total</td>{res.totaux.map((v, k) => <td key={k} className="px-3 text-right tabular-nums">{nb(v)}</td>)}{res.colonnes.length > 1 && <td className="px-3 text-right tabular-nums">{nb(res.total)}</td>}</tr>
                    </tbody>
                  </table>
                </div>
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
