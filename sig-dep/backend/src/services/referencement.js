'use strict';
/**
 * Référencement (1.45.0). SIG-DEP est une application interne : seules les pages publiques
 * (connexion, vérification des cartes de service) sont proposées aux moteurs de recherche ; toutes
 * les autres pages, la vérification d’une carte précise (données personnelles) et l’ensemble d’un
 * environnement de démonstration sont exclus de l’indexation.
 */
const config = require('../config/env');

/** Pages indexables, dans l’ordre du plan du site. */
const PAGES_INDEXABLES = ['/connexion', '/verification'];

const sansBarreFinale = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Une page peut-elle être indexée ? (jamais en démonstration) */
function indexable(chemin) {
  return !config.demo && PAGES_INDEXABLES.includes(sansBarreFinale(String(chemin || '/').split('?')[0]));
}

/** robots.txt : pages publiques et fichiers nécessaires à leur affichage ; tout le reste est exclu. */
function robots() {
  if (config.demo) return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    'Allow: /connexion$',
    'Allow: /verification$',
    'Allow: /assets/',
    'Allow: /favicon',
    'Allow: /site.webmanifest',
    'Allow: /api/statut-public',
    'Disallow: /',
    '',
    `Sitemap: ${config.publicUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

const echapper = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plan du site (sitemap.xml) : les seules pages indexables, à l’adresse publique officielle. */
function planDuSite() {
  const pages = config.demo ? [] : PAGES_INDEXABLES;
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + pages.map((p) => `  <url><loc>${echapper(config.publicUrl + p)}</loc><changefreq>monthly</changefreq><priority>${p === '/connexion' ? '1.0' : '0.8'}</priority></url>\n`).join('')
    + '</urlset>\n';
}

/**
 * index.html adapté à la page demandée : adresse canonique et adresse de partage pour une page
 * indexable ; consigne « noindex » pour toutes les autres (doublée de l’en-tête X-Robots-Tag).
 */
function pageIndex(html, chemin) {
  let balises;
  if (indexable(chemin)) {
    const url = echapper(config.publicUrl + sansBarreFinale(String(chemin).split('?')[0]));
    balises = `<link rel="canonical" href="${url}" /><meta property="og:url" content="${url}" />`;
  } else {
    balises = '<meta name="robots" content="noindex, nofollow" />';
  }
  return html.includes('</head>') ? html.replace('</head>', `${balises}</head>`) : balises + html;
}

module.exports = { PAGES_INDEXABLES, indexable, robots, planDuSite, pageIndex };
