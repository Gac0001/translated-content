'use strict';
/**
 * Identité du Ministère (cahier des charges, section 7) : appellation, sigle, en-tête, pied de page,
 * sceau et format des références, en versions datées. Un document utilise la version en vigueur à sa
 * date de signature (à défaut, à la date du jour).
 *
 * Polices de l’en-tête (licence libre, paquets @fontsource) : Cooper Hewitt (Ministère) et Great Vibes
 * (Secrétariat Général et Direction). Les PDF les incorporent directement (WOFF) ; Word exige une
 * police OpenType : elle est reconstituée ici à partir du WOFF (tables décompressées).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db/knex');

const FICHIERS_POLICES = {
  cooperGras: require.resolve('@fontsource/cooper-hewitt/files/cooper-hewitt-latin-700-normal.woff'),
  cooper: require.resolve('@fontsource/cooper-hewitt/files/cooper-hewitt-latin-400-normal.woff'),
  greatVibes: require.resolve('@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff'),
};

/** Convertit une police WOFF 1.0 en OpenType/TrueType (sfnt), sans dépendance. */
function woffVersSfnt(woff) {
  if (woff.toString('ascii', 0, 4) !== 'wOFF') throw new Error('Police WOFF attendue.');
  const flavor = woff.readUInt32BE(4);
  const n = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i += 1) {
    const o = 44 + i * 20;
    const tag = woff.toString('ascii', o, o + 4);
    const offset = woff.readUInt32BE(o + 4); const compLength = woff.readUInt32BE(o + 8);
    const origLength = woff.readUInt32BE(o + 12); const checksum = woff.readUInt32BE(o + 16);
    const brut = woff.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? zlib.inflateSync(brut) : brut });
  }
  const entSelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entSelector * 16;
  const tete = Buffer.alloc(12 + n * 16);
  tete.writeUInt32BE(flavor, 0); tete.writeUInt16BE(n, 4); tete.writeUInt16BE(searchRange, 6);
  tete.writeUInt16BE(entSelector, 8); tete.writeUInt16BE(n * 16 - searchRange, 10);
  let position = tete.length;
  const corps = [];
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    tete.write(t.tag, r, 'ascii'); tete.writeUInt32BE(t.checksum, r + 4);
    tete.writeUInt32BE(position, r + 8); tete.writeUInt32BE(t.data.length, r + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    corps.push(t.data, Buffer.alloc(pad));
    position += t.data.length + pad;
  });
  return Buffer.concat([tete, ...corps]);
}

let polices = null;
/** Polices de l’en-tête : chemins WOFF (PDF) et données OpenType (Word). */
function policesEntete() {
  if (!polices) {
    polices = {
      woff: FICHIERS_POLICES,
      otf: Object.fromEntries(Object.entries(FICHIERS_POLICES).map(([k, f]) => [k, woffVersSfnt(fs.readFileSync(f))])),
    };
  }
  return polices;
}

// Identité de secours (version 1) si la base n’est pas encore lue : un export ne doit jamais échouer pour autant.
const DEFAUT = {
  id: null, version: 1, date_application: '2026-10-09', ministere: 'MINISTERE DE L’ECONOMIE NUMERIQUE', sigle: 'MIN-ECN',
  secretariat_general: 'Secrétariat Général au Numérique', direction: 'Direction Etudes et Planification',
  secretaire_general_titre: 'Le Secrétaire Général', adresse: '45, Avenue Lubefu, Quartier Royal, Kinshasa - Gombe',
  courriel: 'sg@numerique.gouv.cd', site_web: 'www.numerique.gouv.cd', qr_contenu: 'https://www.numerique.gouv.cd',
  format_reference: 'N° {seq}/{sigle}/SGN/DEP/{signataire}/{redacteur}/{annee}',
  format_reference_sg: 'N° {seq}/{sigle}/SG/{signataire}/DEP/{redacteur}/{annee}', sceau: null,
};

// Versions gardées en mémoire (relues au plus une fois par minute) : les générateurs de documents,
// synchrones, y accèdent sans requête. `pret()` est appelé avant chaque requête de l’API.
let cache = { t: 0, versions: null };
async function versions() {
  if (!cache.versions || Date.now() - cache.t > 60000) {
    cache = { t: Date.now(), versions: await db('identite_versions').orderBy('version', 'asc') };
  }
  return cache.versions;
}
async function pret() { try { await versions(); } catch { /* base indisponible : identité de secours */ } }
function invalider() { cache = { t: 0, versions: null }; }

const jour = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' });

/** Version en vigueur à une date (date de signature ; à défaut, aujourd’hui), depuis la mémoire. */
function courante(date = new Date()) {
  const liste = cache.versions || [];
  const j = jour(date);
  const applicables = liste.filter((v) => jour(v.date_application) <= j);
  return applicables[applicables.length - 1] || liste[0] || DEFAUT;
}
/** Version d’identifiant donné (celle d’un document signé), sinon la version en vigueur. */
function version(id) {
  return (id && (cache.versions || []).find((v) => v.id === id)) || courante();
}
async function enVigueur(date = new Date()) { await versions(); return courante(date); }

/** Initiales d’un nom complet : « Jean-Paul KABONGO » → « JPK ». */
function initiales(nom) {
  return String(nom || '').split(/[\s-]+/).filter(Boolean).map((m) => m[0].toUpperCase()).join('');
}

/**
 * Référence officielle d’après le format de la version : {seq} {sigle} {signataire} {redacteur} {annee}.
 * Sans numéro (document non signé) : « N° … » et le reste du format.
 */
function reference(ident, { seq, signataire, redacteur, annee, variante = 'DEP' }) {
  const format = variante === 'SG' ? ident.format_reference_sg : ident.format_reference;
  return format
    .replace('{seq}', seq ? String(seq).padStart(3, '0') : '…')
    .replace('{sigle}', ident.sigle)
    .replace('{signataire}', signataire || '…')
    .replace('{redacteur}', redacteur || '…')
    .replace('{annee}', annee || new Date().getFullYear())
    .replace(/\/…\//g, '/…/');
}

const sansSceau = (v) => { const { sceau, ...reste } = v; return { ...reste, aSceau: !!sceau }; };

module.exports = { enVigueur, courante, version, pret, versions, invalider, policesEntete, woffVersSfnt, initiales, reference, sansSceau, FICHIERS_POLICES };
