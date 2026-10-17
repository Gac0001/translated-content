'use strict';
/**
 * Encodeur Code 128 : renvoie la suite des largeurs de barres et d’espaces (modules), en commençant
 * par une barre. Jeu C (deux chiffres par caractère, code deux fois plus court) pour un texte
 * entièrement numérique de longueur paire, jeu B sinon. Utilisé pour les cartes de service.
 */
const MOTIFS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

function encoder(texte) {
  const t = String(texte);
  if (/^(\d\d)+$/.test(t)) {
    const valeurs = t.match(/\d\d/g).map(Number);
    const somme = valeurs.reduce((s, v, i) => s + v * (i + 1), START_C);
    return [START_C, ...valeurs, somme % 103, STOP].flatMap((c) => [...MOTIFS[c]].map(Number));
  }
  const valeurs = [...t].map((c) => {
    const v = c.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Caractère non encodable en Code 128 B : ${c}`);
    return v;
  });
  const somme = valeurs.reduce((s, v, i) => s + v * (i + 1), START_B);
  const codes = [START_B, ...valeurs, somme % 103, STOP];
  return codes.flatMap((c) => [...MOTIFS[c]].map(Number));
}

module.exports = { encoder };
