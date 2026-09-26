const TZ = 'Africa/Kinshasa';

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
