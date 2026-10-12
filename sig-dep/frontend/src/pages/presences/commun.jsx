// Présences journalières : libellés, états et petits composants partagés par les écrans.
import { Badge } from '../../components/ui';

export const STATUTS_SEMAINE = { EN_PREPARATION: ['En préparation', 'neutre'], TRANSMIS: ['Transmis au Directeur', 'info'], VERROUILLE: ['Verrouillé', 'succes'], REJETE: ['Rejeté', 'danger'] };
export const STATUTS_LISTE = { BROUILLON: ['En saisie', 'neutre'], TRANSMISE: ['Transmise', 'info'], VERROUILLEE: ['Verrouillée', 'succes'] };
export const STATUTS_RECTIFICATIF = { PROPOSE: ['À valider', 'attention'], VALIDE: ['Validé', 'succes'], REFUSE: ['Refusé', 'danger'] };
export const ETATS = { PRESENT: ['Présent', 'succes'], RETARD: ['Retard', 'attention'], ABSENT: ['Absent', 'danger'], INCOMPLET: ['Départ à saisir', 'orange'], NON_RENSEIGNE: ['À saisir', 'neutre'] };
export const MOTIFS = { MISSION: 'Mission', CONGE: 'Congé', MALADIE: 'Maladie', PERMISSION: 'Permission', FORMATION: 'Formation', ABSENT_NON_JUSTIFIE: 'Absent non justifié' };
export const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

const pastille = (map) => function Pastille({ value }) {
  const v = map[value];
  return <Badge tone={v?.[1]}>{v?.[0] || value || '—'}</Badge>;
};
export const StatutSemaine = pastille(STATUTS_SEMAINE);
export const StatutListe = pastille(STATUTS_LISTE);
export const StatutRectificatif = pastille(STATUTS_RECTIFICATIF);
export const EtatPresence = pastille(ETATS);

/** État d’une ligne (même règle que l’API). */
export function etatLigne(l) {
  if (l.motif) return 'ABSENT';
  if (!l.heure_arrivee) return 'NON_RENSEIGNE';
  if (!l.heure_depart) return 'INCOMPLET';
  return l.retard_minutes > 0 ? 'RETARD' : 'PRESENT';
}

const minutes = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
/** Retard en minutes d’après l’heure normale et la tolérance de la liste. */
export function retard(arrivee, ref, tolerance) {
  if (!arrivee || !ref) return 0;
  const e = minutes(arrivee) - minutes(ref);
  return e > tolerance ? e : 0;
}

/** Décale une date AAAA-MM-JJ d’un nombre de jours (calcul sur la date, sans fuseau). */
export function decaler(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** Jour ouvrable voisin (saute samedi et dimanche). */
export function jourOuvrable(iso, sens) {
  let d = decaler(iso, sens);
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = decaler(d, sens);
  return d;
}

/** Bilan d’une liste ou d’une semaine en une ligne. */
export function resumeBilan(b) {
  if (!b || !b.total) return '—';
  const morceaux = [`${b.renseignes}/${b.total} renseignés`];
  if (b.retards) morceaux.push(`${b.retards} retard(s)`);
  if (b.absents) morceaux.push(`${b.absents} absent(s)`);
  return morceaux.join(' · ');
}
