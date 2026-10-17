import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../../lib/api';
import { useApi, PageHeader, Card, Field, runAction, Spinner, UnsavedChangesGuard, toast } from '../../components/ui';
import { DynamicField } from '../../components/shared';
import { FormulaireEtapes, PageControle, renseigne } from '../../components/FormulaireEtapes';
import ApercuLettre from '../../components/ApercuLettre';

/** Valeurs par défaut du modèle (destinataire, formules…) pour un nouveau document. */
const defauts = (t) => Object.fromEntries(t.sections.filter((s) => s.default !== undefined).map((s) => [s.key, s.default]));

/**
 * Rédaction d’un document de service : même mode de remplissage que la fiche PIP (étapes, compteur de
 * rubriques obligatoires, page de contrôle) ; la correspondance est en version courte avec l’aperçu
 * de la lettre à côté.
 */
export default function DocumentForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const types = useApi('/documents/types');
  const existing = useApi(id ? `/documents/${id}` : null);
  const [typeCode, setTypeCode] = useState(null);
  const [entete, setEntete] = useState({ titre: '', confidentialite: 'ORDINAIRE', commentaire: '' });
  const [contenu, setContenu] = useState({});
  const [etape, setEtape] = useState(0);
  const [modifie, setModifie] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  useEffect(() => {
    const d = existing.data;
    if (d) { setTypeCode(d.type_document); setContenu(d.contenu || {}); setEntete({ titre: d.titre, confidentialite: d.confidentialite, commentaire: '' }); }
  }, [existing.data]);
  const type = (types.data?.data || []).find((t) => t.code === typeCode);
  const choisir = (t) => { setTypeCode(t.code); setContenu(defauts(t)); setEtape(0); };
  const vide = (v) => !renseigne(v);
  // Rubriques des anciennes versions du modèle : affichées seulement si elles sont renseignées
  const visibles = (cles) => (type ? cles.map((k) => type.sections.find((s) => s.key === k)).filter((s) => s && (!s.ancien || !vide(contenu[s.key]))) : []);
  const etapes = useMemo(() => {
    if (!type) return [];
    const liste = type.etapes.map((e, i) => {
      const sections = visibles(e.cles).filter((s) => s.required);
      const titre = i === 0 ? 1 : 0;
      return { key: `e${i}`, numero: e.numero, label: e.label, cles: e.cles, ok: sections.filter((s) => !vide(contenu[s.key])).length + (titre && entete.titre.trim().length >= 3 ? 1 : 0), total: sections.length + titre };
    });
    return [...liste, { key: 'controle', numero: liste.length + 1, label: 'Contrôle', ok: 0, total: 0 }];
  }, [type, contenu, entete.titre]); // eslint-disable-line react-hooks/exhaustive-deps
  if (types.loading || (id && existing.loading)) return <Spinner />;
  if (!type) {
    return (
      <>
        <PageHeader title="Nouveau document de service" subtitle="Choisissez le modèle de document." breadcrumb={[{ label: 'Documents', to: '/documents' }, { label: 'Nouveau' }]} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {types.data.data.map((t) => (
            <button key={t.code} type="button" onClick={() => choisir(t)} className="card p-4 text-left transition hover:border-dep-400 hover:shadow">
              <div className="font-semibold text-dep-800">{t.libelle}</div>
              <p className="mt-1 text-sm text-slate-600">{t.description}</p>
              <p className="mt-2 text-xs text-slate-500">{t.etapes.length} étape(s) · {t.sections.length} rubriques</p>
            </button>
          ))}
        </div>
      </>
    );
  }
  const maj = (k, v) => { setContenu((c) => ({ ...c, [k]: v })); setModifie(true); };
  const majEntete = (k) => (e) => { setEntete({ ...entete, [k]: e.target.value }); setModifie(true); };
  const controle = etape === etapes.length - 1;
  const manquantes = [
    ...(entete.titre.trim().length < 3 ? [{ etape: 0, label: 'Titre du document' }] : []),
    ...type.etapes.flatMap((e, i) => visibles(e.cles).filter((s) => s.required && vide(contenu[s.key])).map((s) => ({ etape: i, label: s.label }))),
  ];
  const enregistrer = async () => {
    if (entete.titre.trim().length < 3) { setEtape(0); toast.error('Titre du document requis (3 caractères minimum).'); return; }
    setEnregistrement(true);
    try {
      const corps = { titre: entete.titre.trim(), confidentialite: entete.confidentialite, contenu, ...(id && entete.commentaire ? { commentaire: entete.commentaire } : {}) };
      const r = await runAction(() => (id ? api.put(`/documents/${id}`, corps) : api.post('/documents', {
        ...corps, type_document: typeCode, task_id: params.get('tache') ? Number(params.get('tache')) : null, instruction_id: params.get('instruction') ? Number(params.get('instruction')) : null,
      })), id ? 'Nouvelle version enregistrée.' : 'Brouillon créé.');
      setModifie(false);
      navigate(`/documents/${r.data.id}`);
    } catch { /* message affiché */ } finally { setEnregistrement(false); }
  };
  const courante = type.etapes[etape];
  return (
    <>
      <UnsavedChangesGuard when={modifie && !enregistrement} />
      <PageHeader title={id ? `Modifier — ${type.libelle}` : `Nouveau — ${type.libelle}`} subtitle={id ? 'Chaque enregistrement crée une nouvelle version ; les versions antérieures sont conservées.' : type.description}
        breadcrumb={[{ label: 'Documents', to: '/documents' }, { label: id ? 'Modification' : 'Nouveau' }]}
        actions={!id && <button type="button" className="btn-ghost" onClick={() => { setTypeCode(null); setModifie(false); }}><ArrowLeft size={16} aria-hidden /> Changer de modèle</button>} />
      <FormulaireEtapes etapes={etapes} etape={etape} onEtape={setEtape} navigation="Étapes du document"
        onEnregistrer={enregistrer} enregistrement={enregistrement} libelleEnregistrer={id ? 'Enregistrer une nouvelle version' : 'Créer le brouillon'}
        resume={<>{manquantes.length ? `${manquantes.length} rubrique(s) obligatoire(s) à compléter avant la transmission.` : 'Toutes les rubriques obligatoires sont renseignées.'}</>}
        apercu={type.correspondance && <ApercuLettre type={type.code} contenu={contenu} identite={types.data.identite} numero={existing.data?.numero_officiel} date={existing.data?.numerote_at} />}>
        {!controle && (
          <Card title={`${courante.numero}. ${courante.label}`}>
            <div className="grid gap-4 sm:grid-cols-2">
              {etape === 0 && <>
                <Field label="Titre du document" required className="sm:col-span-2"><input className="input" value={entete.titre} onChange={majEntete('titre')} /></Field>
                <Field label="Confidentialité"><select className="input" value={entete.confidentialite} onChange={majEntete('confidentialite')}><option value="ORDINAIRE">Ordinaire</option><option value="CONFIDENTIEL">Confidentiel</option><option value="SECRET">Secret</option></select></Field>
              </>}
              {visibles(courante.cles).map((s) => (
                <Field key={s.key} label={s.label} required={s.required} hint={s.help} className={['textarea', 'list', 'table'].includes(s.type) ? 'sm:col-span-2' : ''}>
                  <DynamicField field={s} aria-label={s.label} value={contenu[s.key]} onChange={(v) => maj(s.key, v)} />
                </Field>
              ))}
            </div>
          </Card>
        )}
        {controle && (
          <Card title={`${etapes.length}. Contrôle`}>
            <PageControle manquantes={manquantes} etapes={etapes} onAller={setEtape}>
              {type.correspondance && <p className="text-sm text-slate-600">Le numéro officiel et la date sont attribués à la signature du Directeur ; le document porte l’en-tête officiel (celui du Secrétariat Général si le Secrétaire Général signe).</p>}
              {id && <Field label="Commentaire de version"><input className="input" placeholder="Ex. : prise en compte des observations du Chef de Bureau" value={entete.commentaire} onChange={majEntete('commentaire')} /></Field>}
            </PageControle>
          </Card>
        )}
      </FormulaireEtapes>
    </>
  );
}
