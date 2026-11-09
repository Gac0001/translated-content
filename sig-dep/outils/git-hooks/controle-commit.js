#!/usr/bin/env node
'use strict';
/**
 * Contrôle avant commit (CLAUDE.md, règle 1 : le dépôt est public).
 * Refuse le commit si :
 *  - une ligne ajoutée contient un terme sensible (vrais noms, en-têtes de fichiers réels…) ;
 *  - un nouveau fichier binaire est ajouté (image, Excel, Word, PDF, vidéo, archive).
 *
 * Termes sensibles, un par ligne (lignes vides et « # » ignorées), lus dans :
 *  - sig-dep/.termes-sensibles (jamais versionné : voir .gitignore) ;
 *  - la variable d’environnement SIGDEP_TERMES_SENSIBLES (termes séparés par des virgules ou des retours à la ligne).
 * Sans liste, seul le contrôle des binaires s’applique (avertissement affiché).
 *
 * Exception volontaire pour un binaire (par exemple une image décidée par la Direction) :
 *   SIGDEP_AUTORISER_BINAIRE=1 git commit …
 * Activation (une fois par copie du dépôt, faite par « npm run mise-a-jour » et par le hook de session) :
 *   git config core.hooksPath sig-dep/outils/git-hooks
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const racine = git('rev-parse', '--show-toplevel').trim();

// ─── Termes sensibles ───────────────────────────────────────────────────────
const sources = [];
const fichierListe = path.join(racine, 'sig-dep', '.termes-sensibles');
if (fs.existsSync(fichierListe)) sources.push(fs.readFileSync(fichierListe, 'utf8'));
if (process.env.SIGDEP_TERMES_SENSIBLES) sources.push(process.env.SIGDEP_TERMES_SENSIBLES.replace(/,/g, '\n'));
const termes = [...new Set(sources.join('\n').split(/\r?\n/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#')))];

const erreurs = [];
if (termes.length) {
  const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Mot entier, sans tenir compte de la casse ni des accents environnants (lettres Unicode).
  const motif = new RegExp(`(?<![\\p{L}\\p{N}])(${termes.map(echapper).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
  let fichier = null;
  for (const ligne of git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff').split('\n')) {
    if (ligne.startsWith('+++ ')) { fichier = ligne.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!ligne.startsWith('+')) continue;
    const m = ligne.match(motif);
    if (m) erreurs.push(`  terme sensible « ${m[1]} » dans ${fichier}`);
  }
} else {
  console.error('Contrôle avant commit : aucune liste de termes sensibles (sig-dep/.termes-sensibles ou SIGDEP_TERMES_SENSIBLES) ; seuls les fichiers binaires sont contrôlés.');
}

// ─── Nouveaux fichiers binaires ─────────────────────────────────────────────
const BINAIRES = /\.(png|jpe?g|gif|webp|bmp|tiff?|xlsx?|xlsm|docx?|pptx?|pdf|mp4|mov|avi|zip|7z|rar)$/i;
if (process.env.SIGDEP_AUTORISER_BINAIRE !== '1') {
  for (const f of git('diff', '--cached', '--name-only', '--diff-filter=AR', '-z').split('\0').filter(Boolean)) {
    if (BINAIRES.test(f)) erreurs.push(`  nouveau fichier binaire : ${f}`);
  }
}

if (erreurs.length) {
  console.error(`Commit refusé (CLAUDE.md, règle 1 — données personnelles et fichiers réels) :\n${erreurs.join('\n')}\n`
    + 'Retirez ces éléments (git restore --staged <fichier>, ou corrigez le texte), puis recommencez.\n'
    + 'Binaire voulu et vérifié : SIGDEP_AUTORISER_BINAIRE=1 git commit …');
  process.exit(1);
}
