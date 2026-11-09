/**
 * Préchargement des pages (à la manière du `<Link prefetch>` de Next.js) : le code d’une page chargée à la demande
 * est téléchargé dès que l’utilisateur survole ou atteint au clavier un lien vers elle, pour un affichage immédiat
 * au clic. Sans effet si le navigateur signale une connexion économe (« Économiseur de données ») ou très lente.
 */
const PAGES = new Map();
const faits = new Set();

/** Enregistre les pages préchargeables : { '/chemin': composant créé par lazyPage }. */
export function enregistrerPages(pages) {
  for (const [chemin, page] of Object.entries(pages)) if (page?.precharger) PAGES.set(chemin, page.precharger);
}

const econome = () => {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  return !!c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''));
};

/** Précharge le code de la page d’un chemin (une seule fois ; échec silencieux, la page se chargera au clic). */
export function precharger(chemin) {
  const cle = String(chemin || '').split(/[?#]/)[0];
  const charger = PAGES.get(cle);
  if (!charger || faits.has(cle) || econome()) return;
  faits.add(cle);
  charger().catch(() => faits.delete(cle));
}

/** Propriétés à étaler sur un lien : préchargement au survol et au focus. */
export const prechargerAuSurvol = (chemin) => ({ onMouseEnter: () => precharger(chemin), onFocus: () => precharger(chemin) });
