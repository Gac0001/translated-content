'use strict';
/**
 * Correspondance administrative (cahier des charges, section 26 et annexe 12) : note explicative,
 * lettre de transmission, communiqué de service.
 *  - Numéro officiel attribué à la signature (validation du Directeur), dans une transaction, sur une
 *    séquence annuelle commune ; jamais réutilisé. Format de l’identité en vigueur, par exemple
 *    « N° 012/MIN-ECN/SGN/DEP/{initiales du signataire}/{initiales du rédacteur}/2026 », ou la variante
 *    du Secrétaire Général « N° 012/MIN-ECN/SG/{signataire}/DEP/{rédacteur}/2026 ».
 *  - Avant la signature, le projet porte « N° … » et « Kinshasa, le … ».
 *  - Mise en page en lettre (PDF et Word) : en-tête officiel (variante selon le signataire), référence,
 *    lieu et date, destinataire, objet ou « Concerne », corps, formules, signataire, copies et annexes.
 */
const db = require('../db/knex');
const identite = require('./identite');
const { variante: varianteDe } = require('../modules/documents/types');

const TITRES_SIGNATAIRES = { Directeur: 'Le Directeur-Chef de Service' };

async function nomComplet(userId, trx = db) {
  if (!userId) return '';
  const r = await trx('users as u').leftJoin('agents as a', 'a.id', 'u.agent_id').where('u.id', userId)
    .first(db.raw(`concat_ws(' ', a.prenom, a.postnom, a.nom) as nom`), 'u.username');
  return (r && (r.nom || '').trim()) || '';
}

/** Numéro officiel attribué à la signature (à appeler dans la transaction de validation). */
async function numeroter(trx, d, t, signataireUserId, date = new Date()) {
  const ident = identite.courante(date);
  const v = varianteDe(t, d.contenu);
  const annee = Number(new Date(date).toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' }).slice(0, 4));
  const r = await trx.raw(
    `INSERT INTO sequences (cle, annee, valeur) VALUES ('CORRESPONDANCE', ?, 1)
     ON CONFLICT (cle, annee) DO UPDATE SET valeur = sequences.valeur + 1 RETURNING valeur`, [annee],
  );
  const signataire = v === 'SG'
    ? identite.initiales(d.contenu.signataire_nom) || '…'
    : identite.initiales(d.contenu.signataire_nom || await nomComplet(signataireUserId, trx)) || '…';
  const redacteur = identite.initiales(await nomComplet(d.auteur_user_id, trx)) || '…';
  return {
    numero_officiel: identite.reference(ident, { seq: r.rows[0].valeur, signataire, redacteur, annee, variante: v }),
    numerote_at: date, identite_version_id: ident.id,
  };
}

/** Référence affichée : le numéro officiel, ou le format du projet (« N° … »). */
function referenceAffichee(d, t) {
  if (d.numero_officiel) return d.numero_officiel;
  const ident = identite.version(d.identite_version_id);
  return identite.reference(ident, { variante: varianteDe(t, d.contenu), annee: new Date().getFullYear() });
}

const dateLongue = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'long', year: 'numeric' }) : '…');

/** Éléments communs de mise en page d’une correspondance. */
function elements(d, t) {
  const c = d.contenu || {};
  const v = varianteDe(t, c);
  const ident = identite.version(d.identite_version_id);
  const communique = t.code === 'COMMUNIQUE_SERVICE';
  const titreSignataire = communique ? 'Secrétariat de Direction' : v === 'SG' ? ident.secretaire_general_titre : (TITRES_SIGNATAIRES[c.signataire] || 'Le Directeur-Chef de Service');
  const paragraphes = (texte) => String(texte || '').split(/\n{2,}|\r?\n/).map((x) => x.trim()).filter(Boolean);
  const corps = t.code === 'NOTE_EXPLICATIVE'
    ? [...paragraphes(c.corps), ...paragraphes(c.objet_explication), ...paragraphes(c.explications), ...paragraphes(c.conclusion)]
    : paragraphes(c.corps || c.message);
  return {
    variante: v, reference: referenceAffichee(d, t), lieuDate: `Kinshasa, le ${dateLongue(d.numerote_at)}`,
    titre: t.code === 'NOTE_EXPLICATIVE' ? `NOTE EXPLICATIVE À L’ATTENTION DE ${String(c.destinataire || '').toUpperCase()}`
      : communique ? `COMMUNIQUÉ DE SERVICE ${d.numero_officiel ? `N° ${d.numero_officiel.replace(/^N°\s*/, '')}` : 'N° …'}` : null,
    destinataire: t.code === 'LETTRE_TRANSMISSION' ? [c.destinataire, c.adresse].filter(Boolean) : communique ? [`À : ${c.destinataires || '—'}`] : [],
    objet: t.code === 'NOTE_EXPLICATIVE' ? ['Concerne', c.concerne] : ['Objet', c.objet],
    references: c.references || null,
    appel: c.formule_appel || null, corps, finale: c.formule_finale || null,
    signataire: [titreSignataire, communique ? null : c.signataire_nom].filter(Boolean),
    copies: c.copies || [], annexes: (c.annexes || c.pieces || []), titreAnnexes: t.code === 'LETTRE_TRANSMISSION' ? 'Pièces jointes :' : 'Annexes :',
  };
}

/** PDF d’une correspondance (en réponse HTTP). */
function pdfLettre(res, d, t, filename) {
  const pdf = require('./pdf');
  const e = elements(d, t);
  const { doc, finish } = pdf.createPdf(res, { filename, reference: e.reference, variante: e.variante, identiteId: d.identite_version_id, referenceSousEntete: false });
  const x = doc.page.margins.left; const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y0 = doc.y + 6;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000').text(e.titre && t.code === 'COMMUNIQUE_SERVICE' ? '' : e.reference, x, y0, { width: w * 0.62 });
  doc.font('Helvetica').fontSize(10).text(e.lieuDate, x + w * 0.55, y0, { width: w * 0.45, align: 'right' });
  doc.x = x; doc.y = Math.max(doc.y, y0 + 14) + 14;
  if (e.destinataire.length && t.code !== 'COMMUNIQUE_SERVICE') {
    doc.font('Helvetica-Bold').fontSize(10.5).text(e.destinataire.join('\n'), x + w * 0.5, doc.y, { width: w * 0.5 });
    doc.x = x; doc.moveDown(1.2);
  }
  if (e.titre) {
    doc.font('Helvetica-Bold').fontSize(11.5).text(e.titre, x, doc.y, { width: w, align: 'center', underline: t.code === 'COMMUNIQUE_SERVICE' });
    doc.moveDown(1);
  }
  if (t.code === 'COMMUNIQUE_SERVICE') { doc.font('Helvetica-Bold').fontSize(10.5).text(e.destinataire[0], x, doc.y, { width: w }); doc.moveDown(0.4); }
  if (e.objet[1]) {
    doc.font('Helvetica-Bold').fontSize(10.5).text(`${e.objet[0]} : `, x, doc.y, { continued: true, width: w }).font('Helvetica').text(e.objet[1], { underline: false });
    doc.moveDown(0.3);
  }
  if (e.references) { doc.font('Helvetica-Oblique').fontSize(10).text(`Réf. : ${e.references}`, { width: w }); doc.moveDown(0.3); }
  doc.moveDown(0.7);
  if (e.appel) { doc.font('Helvetica').fontSize(11).text(e.appel, { width: w }); doc.moveDown(0.6); }
  doc.font('Helvetica').fontSize(11);
  for (const p of e.corps) { doc.text(p, x, doc.y, { width: w, align: 'justify', indent: 28 }); doc.moveDown(0.6); }
  if (e.finale) { doc.text(e.finale, x, doc.y, { width: w, indent: 28 }); doc.moveDown(0.6); }
  pdf.ensureSpace(doc, 90);
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11).text(e.signataire.join('\n\n\n'), x + w * 0.45, doc.y, { width: w * 0.55, align: 'center' });
  doc.x = x; doc.moveDown(1.5);
  const liste = (titre, items, numerote) => {
    if (!items.length) return;
    pdf.ensureSpace(doc, 30 + items.length * 13);
    doc.font('Helvetica-Bold').fontSize(9.5).text(titre, x, doc.y, { width: w, underline: true });
    doc.font('Helvetica').fontSize(9.5);
    items.forEach((it, i) => doc.text(`${numerote ? `${i + 1}. ` : '- '}${it}`, x + 12, doc.y, { width: w - 12 }));
    doc.moveDown(0.6);
  };
  liste(e.titreAnnexes, e.annexes, true);
  liste('Transmis copie pour information à :', e.copies, true);
  return finish();
}

/** Document Word d’une correspondance (Buffer). */
async function wordLettre(d, t) {
  const { Paragraph, TextRun, AlignmentType, TabStopType } = require('docx');
  const { documentWord } = require('./word');
  const e = elements(d, t);
  const P = (runs, opts = {}) => new Paragraph({ alignment: opts.align, spacing: { after: opts.after ?? 120 }, indent: opts.indent, tabStops: opts.tabs, children: runs });
  const R = (text, o = {}) => new TextRun({ text: String(text ?? ''), size: o.size || 22, bold: o.bold, italics: o.italics, underline: o.underline ? {} : undefined });
  const children = [
    P([R(t.code === 'COMMUNIQUE_SERVICE' ? '' : e.reference, { bold: true, size: 19 }), new TextRun({ text: `\t${e.lieuDate}`, size: 21 })], { tabs: [{ type: TabStopType.RIGHT, position: 9026 }], after: 280 }),
  ];
  if (e.destinataire.length && t.code !== 'COMMUNIQUE_SERVICE') e.destinataire.forEach((l, i) => children.push(P([R(l, { bold: true })], { indent: { left: 4500 }, after: i === e.destinataire.length - 1 ? 300 : 0 })));
  if (e.titre) children.push(P([R(e.titre, { bold: true, size: 23, underline: t.code === 'COMMUNIQUE_SERVICE' })], { align: AlignmentType.CENTER, after: 240 }));
  if (t.code === 'COMMUNIQUE_SERVICE') children.push(P([R(e.destinataire[0], { bold: true })]));
  if (e.objet[1]) children.push(P([R(`${e.objet[0]} : `, { bold: true }), R(e.objet[1])]));
  if (e.references) children.push(P([R(`Réf. : ${e.references}`, { italics: true })]));
  if (e.appel) children.push(P([R(e.appel)], { after: 200 }));
  for (const p of e.corps) children.push(P([R(p)], { align: AlignmentType.JUSTIFIED, indent: { firstLine: 560 } }));
  if (e.finale) children.push(P([R(e.finale)], { indent: { firstLine: 560 }, after: 360 }));
  e.signataire.forEach((l, i) => children.push(P([R(l, { bold: true })], { align: AlignmentType.CENTER, indent: { left: 4000 }, after: i === 0 && e.signataire.length > 1 ? 720 : 360 })));
  const liste = (titre, items) => {
    if (!items.length) return;
    children.push(P([R(titre, { bold: true, underline: true, size: 19 })], { after: 40 }));
    items.forEach((it, i) => children.push(P([R(`${i + 1}. ${it}`, { size: 19 })], { indent: { left: 240 }, after: 20 })));
  };
  liste(e.titreAnnexes, e.annexes);
  liste('Transmis copie pour information à :', e.copies);
  return documentWord({ titre: e.titre || e.objet[1] || t.libelle, children, variante: e.variante, reference: e.reference, identiteId: d.identite_version_id });
}

module.exports = { numeroter, referenceAffichee, pdfLettre, wordLettre, elements };
