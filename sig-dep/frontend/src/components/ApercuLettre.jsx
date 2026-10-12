import { fmtDate } from '../lib/format';

const paragraphes = (t) => String(t || '').split(/\n{2,}|\r?\n/).map((x) => x.trim()).filter(Boolean);

/**
 * Aperçu en direct d’une correspondance (note explicative, lettre de transmission, communiqué),
 * selon la mise en page de l’export PDF : en-tête officiel (variante du Secrétaire Général s’il
 * signe), référence du projet « N° … », lieu et date, destinataire, objet, corps, signature,
 * annexes et copies, pied de page. Le numéro et la date définitifs sont attribués à la signature.
 */
export default function ApercuLettre({ type, contenu = {}, identite, numero, date }) {
  if (!identite) return null;
  const c = contenu;
  const sg = c.signataire === 'Secrétaire Général';
  const communique = type === 'COMMUNIQUE_SERVICE';
  const note = type === 'NOTE_EXPLICATIVE';
  const reference = numero || (sg ? identite.reference_sg : identite.reference_dep);
  const lignes = [identite.ministere, identite.secretariat_general, sg ? identite.secretaire_general_titre : identite.direction];
  const corps = note ? [...paragraphes(c.corps), ...paragraphes(c.objet_explication), ...paragraphes(c.explications), ...paragraphes(c.conclusion)] : paragraphes(c.corps || c.message);
  const signataire = communique ? ['Secrétariat de Direction'] : [sg ? identite.secretaire_general_titre : 'Le Directeur-Chef de Service', c.signataire_nom].filter(Boolean);
  const annexes = (c.annexes || c.pieces || []).filter(Boolean);
  const copies = (c.copies || []).filter(Boolean);
  const vide = (t) => <span className="italic text-slate-500">{t}</span>;
  return (
    <div className="card sticky top-20 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold uppercase tracking-wide">Aperçu</span>
        <span>Numéro et date attribués à la signature</span>
      </div>
      <div className="max-h-[calc(100vh-9rem)] overflow-y-auto bg-slate-100 p-3">
        <article className="mx-auto bg-white px-6 pb-4 pt-5 text-[11px] leading-snug text-slate-900 shadow" aria-label="Aperçu de la correspondance">
          <header className="mb-3 text-center">
            <div className="font-display text-[10px] font-bold uppercase">{lignes[0]}</div>
            <div className="font-serif text-[12px] italic underline">{lignes[1]}</div>
            <div className="font-serif text-[12px] italic underline">{lignes[2]}</div>
          </header>
          <div className="mb-3 flex items-start justify-between gap-2">
            <span className="font-semibold">{communique ? '' : reference}</span>
            <span className="text-right">Kinshasa, le {date ? fmtDate(date) : '…'}</span>
          </div>
          {type === 'LETTRE_TRANSMISSION' && (
            <div className="mb-3 ml-auto w-1/2 font-semibold">{c.destinataire || vide('Destinataire')}{c.adresse && <div>{c.adresse}</div>}</div>
          )}
          {note && <h4 className="mb-2 text-center font-bold uppercase">Note explicative à l’attention de {c.destinataire || '…'}</h4>}
          {communique && <h4 className="mb-2 text-center font-bold uppercase underline">Communiqué de service {numero ? numero.replace(/^N°\s*/, 'N° ') : 'N° …'}</h4>}
          {communique && <p className="mb-1 font-semibold">À : {c.destinataires || '—'}</p>}
          <p className="mb-1"><b>{note ? 'Concerne' : 'Objet'} :</b> {(note ? c.concerne : c.objet) || vide('à préciser')}</p>
          {c.references && <p className="mb-1 italic">Réf. : {c.references}</p>}
          {c.formule_appel && <p className="mb-2 mt-2">{c.formule_appel}</p>}
          {corps.length ? corps.map((p, i) => <p key={i} className="mb-1.5 indent-6 text-justify">{p}</p>) : <p className="mb-1.5 indent-6">{vide('Corps du texte…')}</p>}
          {c.formule_finale && <p className="mb-2 indent-6">{c.formule_finale}</p>}
          <div className="mb-3 ml-auto mt-4 w-1/2 text-center font-semibold">
            {signataire.map((l, i) => <div key={l} className={i === 0 && signataire.length > 1 ? 'mb-6' : ''}>{l}</div>)}
          </div>
          {annexes.length > 0 && <div className="mb-1.5"><div className="font-semibold underline">{type === 'LETTRE_TRANSMISSION' ? 'Pièces jointes :' : 'Annexes :'}</div><ol className="list-decimal pl-5">{annexes.map((a) => <li key={a}>{a}</li>)}</ol></div>}
          {copies.length > 0 && <div><div className="font-semibold underline">Transmis copie pour information à :</div><ol className="list-decimal pl-5">{copies.map((a) => <li key={a}>{a}</li>)}</ol></div>}
          <footer className="mt-5 border-t border-slate-200 pt-1 text-center text-[9px] text-slate-600">
            <div>{identite.adresse}</div>
            <div>•  E-mail : {identite.courriel}  •  {identite.site_web}</div>
            <div className="mt-1 flex h-1"><span className="flex-1 bg-[#0095c9]" /><span className="flex-1 bg-[#fff24b]" /><span className="flex-1 bg-[#db3832]" /></div>
          </footer>
        </article>
      </div>
    </div>
  );
}
