const TZ = 'Africa/Kinshasa';

/**
 * Date du jour à Kinshasa (AAAA-MM-JJ), pour les champs de date.
 * toISOString() donne la date UTC : entre minuit et 1 h à Kinshasa, ce serait encore la veille.
 */
export function aujourdhui() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function fmtDate(d) {
  if (!d) return '—';
  const s = String(d);
  const x = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  return Number.isNaN(x.getTime()) ? s : x.toLocaleDateString('fr-FR', { timeZone: TZ });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
}

export function fmtMontant(v, devise = 'USD') {
  if (v === null || v === undefined || v === '') return '—';
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${devise}`;
}

export function nomComplet(a) {
  if (!a) return '—';
  return [a.prenom, a.nom, a.postnom].filter(Boolean).join(' ');
}

export function fmtTaille(o) {
  if (!o && o !== 0) return '';
  if (o < 1024) return `${o} o`;
  if (o < 1048576) return `${(o / 1024).toFixed(0)} Ko`;
  return `${(o / 1048576).toFixed(1)} Mo`;
}

export function mondayOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOverdue(echeance, statut) {
  if (!echeance || ['EXECUTEE', 'VALIDEE', 'CLOTUREE'].includes(statut)) return false;
  return new Date(`${echeance}T23:59:59`) < new Date();
}

// ─── Nombres et montants (format français : espace fine insécable pour les milliers, virgule décimale) ───
/** Nombre formaté ; `vide` est rendu pour une valeur absente (« — » par défaut, '' dans un champ de saisie). */
export function fmtNombre(v, decimales = 0, { vide = '—' } = {}) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return vide;
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: decimales });
}

/** Montant en francs congolais : « 1 250 000 CDF » (arrondi au franc). */
export function fmtCdf(v, { vide = '—', suffixe = true } = {}) {
  const n = fmtNombre(v === null || v === undefined || v === '' ? v : Math.round(Number(v)), 0, { vide });
  return n === vide || !suffixe ? n : `${n} CDF`;
}

/** Pourcentage : « 45,5 % ». */
export function fmtPourcent(v, decimales = 1, { vide = '—' } = {}) {
  const n = fmtNombre(v, decimales, { vide });
  return n === vide ? n : `${n} %`;
}

/** Lecture d’un nombre saisi à la française (« 1 250 000,5 ») ; null si vide, NaN si invalide. */
export function lireNombre(s) {
  const b = String(s ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  return b === '' ? null : Number(b);
}
