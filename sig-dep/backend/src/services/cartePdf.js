'use strict';
/**
 * Rendu PDF des cartes de service au format ID-1 (85,6 × 54 mm), d’après le modèle de la charte
 * graphique du Gouvernement (p. 43) : bandeau institutionnel avec Bloc-armoirie, Ligne d’État
 * (bleu, jaune, rouge à parts égales) et intitulé officiel ; photo, renseignements, signature et
 * code à barres au recto ; « LAISSEZ PASSER » et QR code de vérification au verso.
 * Planche A4 de 10 cartes (recto puis verso en miroir pour l’impression recto-verso).
 */
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const config = require('../config/env');
const { safePath } = require('./files');
const { encoder } = require('../utils/code128');

const MM = 72 / 25.4;
const W = 85.6 * MM;
const H = 54 * MM;
const LIGNE_ETAT = ['#0095c9', '#fff24b', '#db3832']; // charte : bleu, jaune, rouge (haut vers bas)
const ENCRE = '#1f2937';

const fichier = (nom) => { try { const p = safePath(nom); return fs.existsSync(p) ? p : null; } catch (e) { return null; } };

function urlVerification(jeton) {
  return `${config.publicUrl}/verification/c/${jeton}`;
}

/** Bloc-armoirie : image officielle déposée par l’Admin, sinon sceau provisoire (cercle et étoiles). */
function armoirie(doc, modele, cx, cy, r, { fond = '#ffffff' } = {}) {
  doc.save();
  doc.circle(cx, cy, r).fill(fond);
  const img = modele.armoirie_path && fichier(modele.armoirie_path);
  if (img) {
    doc.image(img, cx - r * 0.92, cy - r * 0.92, { fit: [r * 1.84, r * 1.84], align: 'center', valign: 'center' });
  } else {
    doc.lineWidth(0.6).circle(cx, cy, r * 0.9).stroke('#4b5563');
    doc.circle(cx, cy, r * 0.62).stroke('#9ca3af');
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(r * 0.36).text('RDC', cx - r, cy - r * 0.2, { width: 2 * r, align: 'center' });
    doc.font('Helvetica').fontSize(r * 0.16).text('LE GOUVERNEMENT', cx - r, cy + r * 0.32, { width: 2 * r, align: 'center' });
  }
  doc.restore();
}

/** Ligne d’État verticale : trois couleurs à parts égales, de haut en bas. */
function ligneEtat(doc, x, y, h, l = 1.6) {
  LIGNE_ETAT.forEach((c, i) => doc.rect(x, y + (i * h) / 3, l, h / 3).fill(c));
}

function codeBarres(doc, texte, x, y, largeur, hauteur, { lisible = true } = {}) {
  const modules = encoder(texte);
  const total = modules.reduce((s, m) => s + m, 0);
  const u = largeur / total;
  let cx = x;
  modules.forEach((m, i) => {
    if (i % 2 === 0) doc.rect(cx, y, m * u, hauteur).fill('#000000');
    cx += m * u;
  });
  if (lisible) doc.fillColor(ENCRE).font('Helvetica').fontSize(4.6).text(texte, x, y + hauteur + 0.8, { width: largeur, align: 'center', lineBreak: false });
}

function filigraneSpecimen(doc, ox, oy) {
  doc.save();
  doc.rotate(-18, { origin: [ox + W / 2, oy + H / 2] });
  doc.fillColor('#dc2626').opacity(0.55).font('Helvetica-Bold').fontSize(15)
    .text('SPÉCIMEN — NON VALIDE', ox, oy + H / 2 - 9, { width: W, align: 'center', lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

function bandeau(doc, modele, ox, oy, hauteur) {
  doc.rect(ox, oy, W, hauteur).fill(modele.couleur_bandeau);
  const r = hauteur * 0.4;
  armoirie(doc, modele, ox + 5 + r, oy + hauteur / 2, r);
  const lx = ox + 5 + 2 * r + 4;
  ligneEtat(doc, lx, oy + hauteur / 2 - r, 2 * r);
  // Intitulé officiel : capitales grasses, taille homogène (charte, p. 8), ajusté à la largeur disponible.
  const lignes = (Array.isArray(modele.intitule) ? modele.intitule : JSON.parse(modele.intitule || '[]')).map((t) => t.toUpperCase());
  const largeur = W * 0.5;
  doc.font('Helvetica-Bold');
  let taille = 6;
  while (taille > 4 && lignes.some((t) => doc.fontSize(taille).widthOfString(t) > largeur)) taille -= 0.2;
  const pas = taille * 1.12;
  let ty = oy + hauteur / 2 - (lignes.length * pas) / 2 + 0.4;
  doc.fillColor('#ffffff');
  lignes.forEach((t) => { doc.fontSize(taille).text(t, lx + 5, ty, { width: largeur, lineBreak: false }); ty += pas; });
  // Adresse en haut à droite (modèle de la charte, p. 43)
  if (modele.adresse) {
    doc.font('Helvetica').fontSize(4.4).fillColor('#e5e7eb');
    const lx2 = ox + W - 3 * MM - 25 * MM;
    const h = doc.heightOfString(modele.adresse, { width: 25 * MM, align: 'right' });
    doc.text(modele.adresse, lx2, oy + Math.max(2, hauteur / 2 - h / 2), { width: 25 * MM, align: 'right' });
  }
}

/** Recto : bandeau, photo, renseignements, code à barres, signature du Directeur. */
function recto(doc, carte, modele, specimen, ox, oy) {
  const d = carte.donnees || {};
  doc.rect(ox, oy, W, H).fill('#ffffff');
  const hb = 13 * MM;
  bandeau(doc, modele, ox, oy, hb);
  // Sceau en filigrane
  doc.save(); doc.opacity(0.08);
  armoirie(doc, modele, ox + W - 15 * MM, oy + hb + 17 * MM, 12 * MM, { fond: '#ffffff' });
  doc.restore(); doc.opacity(1);

  // Photo
  const px = ox + 4 * MM; const py = oy + hb + 2.5 * MM; const pw = 19 * MM; const ph = 23 * MM;
  const photo = carte.photo && fichier(carte.photo);
  if (photo) doc.image(photo, px, py, { cover: [pw, ph], align: 'center', valign: 'center' });
  else doc.rect(px, py, pw, ph).fill('#e5e7eb');
  doc.lineWidth(0.4).rect(px, py, pw, ph).stroke('#9ca3af');

  // Renseignements
  const fx = px + pw + 3.5 * MM; const lw = 15 * MM; let fy = py + 0.5;
  const champs = [
    ['Matricule', d.matricule], ['Prénom', d.prenom], ['Nom', d.nom], ['Postnom', d.postnom],
    ['Grade', d.grade], ['Fonction', d.fonction], ['Affectation', d.affectation],
  ];
  for (const [label, valeur] of champs) {
    doc.fillColor('#4b5563').font('Helvetica').fontSize(5.2).text(`${label} :`, fx, fy, { width: lw, lineBreak: false });
    doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(label === 'Affectation' ? 4.9 : 5.6);
    const largeur = ox + W - 3.5 * MM - (fx + lw);
    const h = doc.heightOfString(valeur || '—', { width: largeur });
    doc.text(valeur || '—', fx + lw, fy, { width: largeur, height: label === 'Affectation' ? 13 : 7, ellipsis: true });
    fy += Math.min(Math.max(h, 6.6), label === 'Affectation' ? 13 : 7) + 0.6;
  }

  // Code à barres de sécurité (charte : sous la photo) ; le numéro n’est pas imprimé en clair.
  if (carte.numero) codeBarres(doc, carte.numero, px - 1, py + ph + 1.8 * MM, pw + 2, 4.6 * MM, { lisible: false });

  // Signature (charte : « Signature : » sous les renseignements, sur le sceau)
  const sy = oy + H - 10.5 * MM;
  doc.fillColor('#4b5563').font('Helvetica').fontSize(5.2).text('Signature :', fx, sy + 2.2 * MM, { width: lw, lineBreak: false });
  const img = specimen && fichier(specimen.fichier);
  if (img) doc.image(img, fx + lw, sy - 1 * MM, { fit: [20 * MM, 7 * MM], align: 'left', valign: 'center' });
  doc.fillColor(ENCRE).font('Helvetica-Bold').fontSize(4.6)
    .text(specimen ? `${specimen.signataire}, ${specimen.qualite}` : 'Le Directeur', fx + lw, oy + H - 4.4 * MM, { width: ox + W - 3.5 * MM - (fx + lw), lineBreak: false, ellipsis: true });
  // Liseré tricolore en pied de carte
  LIGNE_ETAT.forEach((c, i) => doc.rect(ox + (i * W) / 3, oy + H - 1.2, W / 3, 1.2).fill(c));
  if (!carte.numero) filigraneSpecimen(doc, ox, oy);
}

/** Verso : Bloc-armoirie, « LAISSEZ PASSER », mention, QR code de vérification. */
async function verso(doc, carte, modele, ox, oy) {
  doc.rect(ox, oy, W, H).fill('#ffffff');
  const r = 8.5 * MM;
  armoirie(doc, modele, ox + 17 * MM, oy + 17 * MM, r);
  ligneEtat(doc, ox + 27.5 * MM, oy + 17 * MM - r, 2 * r);
  // Titre ajusté à la largeur disponible (jamais sur deux lignes)
  const largeurTitre = 33 * MM;
  doc.font('Helvetica-Bold');
  let taille = 11.5;
  while (taille > 6 && doc.fontSize(taille).widthOfString(modele.titre_verso) > largeurTitre) taille -= 0.5;
  doc.fillColor(modele.couleur_accent).fontSize(taille)
    .text(modele.titre_verso, ox + 30 * MM, oy + 12 * MM, { width: largeurTitre, lineBreak: false });
  doc.fillColor(ENCRE).font('Helvetica').fontSize(4.6)
    .text('Cette carte est la propriété de l’État. En cas de perte, la remettre à la Direction d’Études et Planification.', ox + 30 * MM, oy + 18.5 * MM, { width: 31 * MM });
  // QR code de vérification (jeton aléatoire, aucune donnée personnelle)
  if (carte.jeton) {
    const png = await QRCode.toBuffer(urlVerification(carte.jeton), { errorCorrectionLevel: 'M', margin: 0, scale: 6 });
    doc.image(png, ox + W - 21 * MM, oy + 5 * MM, { width: 17 * MM });
    doc.fillColor('#4b5563').font('Helvetica').fontSize(3.8).text('Vérifier cette carte', ox + W - 22 * MM, oy + 23 * MM, { width: 19 * MM, align: 'center', lineBreak: false });
  } else {
    doc.lineWidth(0.4).rect(ox + W - 21 * MM, oy + 5 * MM, 17 * MM, 17 * MM).stroke('#9ca3af');
    doc.fillColor('#6b7280').fontSize(4.4).text('QR code attribué à la validation', ox + W - 21 * MM, oy + 12 * MM, { width: 17 * MM, align: 'center' });
  }
  // Bandeau de la mention
  doc.rect(ox, oy + H - 15 * MM, W, 15 * MM).fill(modele.couleur_bandeau);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(5.6)
    .text(modele.mention_verso, ox + 5 * MM, oy + H - 12.5 * MM, { width: W - 10 * MM, align: 'center' });
  doc.font('Helvetica').fontSize(4.4).fillColor('#dbeafe')
    .text(modele.site_web || 'Vérification : scannez le QR code ou saisissez le matricule', ox + 5 * MM, oy + H - 4.2 * MM, { width: W - 10 * MM, align: 'center', lineBreak: false });
  if (!carte.numero) filigraneSpecimen(doc, ox, oy);
}

/** Cartes à l’unité : une page par face. */
async function pdfCartes(res, cartes, { modeles, specimens, filename }) {
  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: 'Cartes de service — DEP', Author: 'SIG-DEP' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  for (const c of cartes) {
    doc.addPage(); recto(doc, c, modeles[c.modele_id], specimens[c.id], 0, 0);
    doc.addPage(); await verso(doc, c, modeles[c.modele_id], 0, 0); // eslint-disable-line no-await-in-loop
  }
  doc.end();
}

/** Planche A4 de 10 cartes avec traits de coupe ; verso en miroir pour l’impression recto-verso (bord long). */
async function pdfPlanche(res, cartes, { modeles, specimens, filename }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Planche de cartes de service — DEP', Author: 'SIG-DEP' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  const PW = 595.28; const PH = 841.89;
  const gx = (PW - 2 * W) / 3; const gy = (PH - 5 * H) / 6;
  const pos = (i, miroir) => {
    const col = i % 2; const row = Math.floor(i / 2);
    return [gx + (miroir ? 1 - col : col) * (W + gx), gy + row * (H + gy)];
  };
  const coupe = (x, y) => {
    doc.lineWidth(0.3).strokeColor('#9ca3af');
    [[x, y], [x + W, y], [x, y + H], [x + W, y + H]].forEach(([a, b]) => {
      doc.moveTo(a - 6, b).lineTo(a - 2, b).moveTo(a + 2, b).lineTo(a + 6, b).moveTo(a, b - 6).lineTo(a, b - 2).moveTo(a, b + 2).lineTo(a, b + 6).stroke();
    });
  };
  for (let p = 0; p < cartes.length; p += 10) {
    const lot = cartes.slice(p, p + 10);
    doc.addPage();
    lot.forEach((c, i) => { const [x, y] = pos(i, false); recto(doc, c, modeles[c.modele_id], specimens[c.id], x, y); coupe(x, y); });
    doc.addPage();
    for (const [i, c] of lot.entries()) { const [x, y] = pos(i, true); await verso(doc, c, modeles[c.modele_id], x, y); coupe(x, y); } // eslint-disable-line no-await-in-loop
  }
  doc.end();
}

module.exports = { pdfCartes, pdfPlanche, urlVerification, W, H };
