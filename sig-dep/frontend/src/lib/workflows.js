// Circuits de traitement affichés sur les fiches (frise des étapes).
// Chaque fonction renvoie { etapes, courante, alerte, termine, sautees, details } :
// - etapes : libellés dans l’ordre du circuit ;
// - courante : index de l’étape en cours (les précédentes sont franchies, sauf celles de `sautees`) ;
// - alerte : { tone, label } facultatif, porté par l’étape en cours (retour, retard, rejet) ;
// - sautees : index des étapes que le circuit permet de ne pas franchir (lues dans l’historique).
// Les libellés suivent les règles du backend ; aucune action n’est déduite d’ici.

const aFait = (historique = [], ...actions) => historique.some((h) => actions.includes(h.action));

/**
 * Instructions et tâches (la tâche n’a pas d’étape « Brouillon »). L’avancement et le compte rendu
 * sont permis dès la transmission : l’accusé de réception peut donc ne jamais avoir eu lieu.
 * Bloquée : position du statut d’avant le blocage (statut_avant_blocage). Annulée : position du dernier
 * statut connu dans l’historique. Rapport intermédiaire : compte rendu d’étape, le traitement continue.
 */
function circuitExecution(item, avecBrouillon) {
  const { statut, historique = [] } = item;
  const etapes = [...(avecBrouillon ? ['Brouillon'] : []), 'Transmise', 'Reçue', 'En cours', 'Exécutée', 'Validée', 'Clôturée'];
  const i = (label) => etapes.indexOf(label);
  const entamee = aFait(historique, 'RECEPTION', 'AVANCEMENT', 'COMPTE_RENDU', 'RAPPORT_INTERMEDIAIRE', 'BLOCAGE');
  const pos = (s) => ({
    BROUILLON: 0, TRANSMISE: i('Transmise'), RECUE: i('Reçue'), EN_COURS: i('En cours'), RAPPORT_INTERMEDIAIRE: i('En cours'), A_CORRIGER: i('En cours'),
    // Le retard est posé automatiquement : la position dépend de ce qui a déjà été fait.
    EN_RETARD: entamee ? i('En cours') : i('Transmise'),
    EXECUTEE: i('Exécutée'), VALIDEE: i('Validée'), CLOTUREE: i('Clôturée'),
  }[s]);
  let position;
  let alerte;
  const details = {};
  if (statut === 'BLOQUEE') {
    position = pos(item.statut_avant_blocage) ?? i('En cours');
    alerte = { tone: 'danger', label: 'Bloquée' };
  } else if (statut === 'ANNULEE') {
    const avant = [...historique].reverse().find((h) => h.nouveau_statut && !['ANNULEE', 'BLOQUEE'].includes(h.nouveau_statut))?.nouveau_statut;
    position = pos(avant) ?? (entamee ? i('En cours') : i('Transmise'));
    alerte = { tone: 'danger', label: 'Annulée' };
  } else {
    position = pos(statut) ?? 0;
    if (statut === 'A_CORRIGER') alerte = { tone: 'attention', label: 'Retournée pour correction' };
    if (statut === 'EN_RETARD') alerte = { tone: 'danger', label: 'En retard' };
    if (statut === 'RAPPORT_INTERMEDIAIRE') details[position] = 'Rapport intermédiaire transmis';
  }
  const sautees = position > i('Reçue') && !aFait(historique, 'RECEPTION') ? [i('Reçue')] : [];
  return { etapes, courante: position, alerte, termine: statut === 'CLOTUREE', sautees, details };
}

export const circuitInstruction = (i) => circuitExecution(i, true);
export const circuitTache = (t) => circuitExecution(t, false);

const NIVEAUX_EXAMEN = { BUREAU: 'Chef de Bureau', DIVISION: 'Chef de Division', DIRECTION: 'Directeur' };

/**
 * Documents (annexe 2) : Rédaction → Relecture (Chef de Bureau, Chef de Division) → Visa (Chef de Division,
 * ou Chef du Bureau Secrétariat de Direction) → Décision du Directeur → Validé → Publié (facultatif) → Archivé.
 * Un document rédigé par un viseur ou par le Directeur ne passe ni par la relecture ni par le visa ;
 * un document rejeté peut être archivé (il n’a alors jamais été validé : valide_at vide).
 */
export function circuitDocument(d) {
  const historique = d.historique || [];
  const etapes = ['Rédaction', 'Relecture', 'Visa', 'Décision du Directeur', 'Validé et signé', 'Publié', 'Archivé'];
  // Le backend inscrit dans d.visas une mention RELECTURE (transmission par un relecteur) ou VISA.
  const typesVisa = (d.visas || []).map((v) => v.type);
  const vise = typesVisa.includes('VISA') || aFait(historique, 'VISA');
  const relu = vise || typesVisa.includes('RELECTURE');
  const sauteesJusqua = (position) => [!relu && 1, !vise && 2].filter((x) => x !== false && x < position);
  const rejete = d.statut === 'REJETE' || (d.statut === 'ARCHIVE' && !d.valide_at);
  const etapesRejet = ['Rédaction', 'Relecture', 'Visa', 'Décision du Directeur', 'Rejeté', 'Archivé'];
  switch (d.statut) {
    case 'BROUILLON': return { etapes, courante: 0 };
    case 'A_CORRIGER': return { etapes, courante: 0, alerte: { tone: 'attention', label: 'Retourné pour correction' } };
    case 'EN_RELECTURE': return d.niveau_actuel === 'DIRECTION'
      ? { etapes, courante: 3, sautees: sauteesJusqua(3) }
      : { etapes, courante: 1, details: NIVEAUX_EXAMEN[d.niveau_actuel] ? { 1: `Chez le ${NIVEAUX_EXAMEN[d.niveau_actuel]}` } : {} };
    case 'VISE': return { etapes, courante: 2, details: { 2: 'Visé, à transmettre au Directeur' } };
    case 'VALIDE': return { etapes, courante: 4, sautees: sauteesJusqua(4) };
    case 'PUBLIE': return { etapes, courante: 5, sautees: sauteesJusqua(5) };
    case 'REJETE': return { etapes: etapesRejet, courante: 4, sautees: sauteesJusqua(4), alerte: { tone: 'danger', label: 'Rejeté' } };
    case 'ARCHIVE': return rejete
      ? { etapes: etapesRejet, courante: 5, termine: true, sautees: sauteesJusqua(5), details: { 4: 'Document rejeté' } }
      : { etapes, courante: 6, termine: true, sautees: [...sauteesJusqua(6), ...(aFait(historique, 'PUBLICATION') ? [] : [5])] };
    default: return { etapes, courante: 0 };
  }
}

/** Fiches PIP : vérification (Chef de Division, ou Directeur) puis validation du Directeur. */
export function circuitPip(p) {
  const etapes = ['Rédaction', 'En vérification', 'Vérifiée', 'Validée', 'Archivée'];
  const pos = { BROUILLON: 0, A_CORRIGER: 0, EN_VERIFICATION: 1, VERIFIE: 2, VALIDE: 3, ARCHIVE: 4 }[p.statut] ?? 0;
  return {
    etapes, courante: pos, termine: p.statut === 'ARCHIVE',
    alerte: p.statut === 'A_CORRIGER' ? { tone: 'attention', label: 'Retournée pour correction' } : undefined,
  };
}

/** Listes de présence : circuit strict, la soumission verrouille la liste en écriture. */
export function circuitPresence(s) {
  const etapes = ['Brouillon', 'Vérifiée', 'Soumise au Directeur', 'Verrouillée'];
  const pos = { BROUILLON: 0, VERIFIEE: 1, SOUMISE: 2, VERROUILLEE: 3 }[s.statut] ?? 0;
  return { etapes, courante: pos, termine: s.statut === 'VERROUILLEE' };
}

/** Courriers : un courrier peut être classé sans avoir circulé ni été marqué comme traité. */
export function circuitCourrier(c) {
  const etapes = ['Enregistré', 'En circulation', 'Traité', 'Classé', 'Archivé'];
  const pos = { ENREGISTRE: 0, EN_CIRCULATION: 1, TRAITE: 2, CLASSE: 3, ARCHIVE: 4 }[c.statut] ?? 0;
  const sautees = [];
  if (pos > 1 && !c.transmissions?.length) sautees.push(1);
  if (pos > 2 && !aFait(c.historique, 'TRAITEMENT')) sautees.push(2);
  return { etapes, courante: pos, termine: c.statut === 'ARCHIVE', sautees };
}

/**
 * Programmation (PTBA, CBMT, PAP, RAP, CDMT) : préparation (Bureau Programme) → vérification (Chef du
 * Bureau Programme) → consolidation (Chef de la Division Programme et Suivi) → validation (Directeur).
 */
export function circuitProgrammation(d) {
  const etapes = ['Préparation', 'Vérification', 'Consolidation', 'Validation du Directeur', 'Validé'];
  const pos = { BROUILLON: 0, A_CORRIGER: 0, SOUMIS: 1, VERIFIE: 2, CONSOLIDE: 3, VALIDE: 4 }[d.statut] ?? 0;
  const details = { SOUMIS: { 1: 'Chez le Chef du Bureau Programme' }, VERIFIE: { 2: 'Chez le Chef de la Division Programme et Suivi' }, CONSOLIDE: { 3: 'Chez le Directeur' } }[d.statut] || {};
  return {
    etapes, courante: pos, termine: d.statut === 'VALIDE', details,
    alerte: d.statut === 'A_CORRIGER' ? { tone: 'attention', label: 'Retourné pour correction' } : undefined,
  };
}

/** Campagnes de collecte : préparation → collecte ouverte → clôturée → validée (données figées). */
export function circuitCampagne(c) {
  const etapes = ['Préparation', 'Collecte ouverte', 'Clôturée', 'Validée'];
  const pos = { BROUILLON: 0, OUVERTE: 1, CLOTUREE: 2, VALIDEE: 3 }[c.statut] ?? 0;
  const retour = c.statut === 'OUVERTE' && !!c.observations;
  return {
    etapes, courante: pos, termine: c.statut === 'VALIDEE',
    details: { CLOTUREE: { 2: 'En attente de validation par le Chef de Division' } }[c.statut] || {},
    alerte: retour ? { tone: 'attention', label: 'Retournée par le Chef de Division' } : undefined,
  };
}

/** Réponses de campagne : saisie (brouillon) → transmise au contrôle → contrôlée, par une autre personne. */
export function circuitReponse(r) {
  const etapes = ['Saisie', 'Transmise au contrôle', 'Contrôlée'];
  const pos = { BROUILLON: 0, A_CORRIGER: 0, SAISIE: 1, CONTROLEE: 2 }[r?.statut] ?? 0;
  return {
    etapes, courante: pos, termine: r?.statut === 'CONTROLEE',
    alerte: r?.statut === 'A_CORRIGER' ? { tone: 'attention', label: 'À corriger' } : undefined,
  };
}

/** Bulletins et baromètres : rédaction → visa du Chef de Division → autorisation du Directeur (diffusion). */
export function circuitBulletin(b) {
  const etapes = ['Rédaction', 'Visa du Chef de Division', 'Autorisation du Directeur', 'Diffusé'];
  const pos = { BROUILLON: 0, A_CORRIGER: 0, SOUMIS: 1, VISE: 2, DIFFUSE: 3 }[b.statut] ?? 0;
  return {
    etapes, courante: pos, termine: b.statut === 'DIFFUSE',
    alerte: b.statut === 'A_CORRIGER' ? { tone: 'attention', label: 'Retourné pour correction' } : undefined,
  };
}

/**
 * Réunions : préparation → convocation → tenue (rédaction du compte rendu) → compte rendu soumis au
 * président → clôturée (décisions inscrites au registre). Annulée : position du dernier statut connu.
 */
export function circuitReunion(r) {
  const etapes = ['Préparation', 'Convoquée', 'Tenue — compte rendu', 'Validation du président', 'Clôturée'];
  const pos = (s) => ({ BROUILLON: 0, CONVOQUEE: 1, TENUE: 2, CR_A_VALIDER: 3, CLOTUREE: 4 }[s]);
  if (r.statut === 'ANNULEE') {
    const avant = [...(r.historique || [])].reverse().find((h) => h.nouveau_statut && h.nouveau_statut !== 'ANNULEE')?.nouveau_statut;
    return { etapes, courante: pos(avant) ?? 1, alerte: { tone: 'danger', label: 'Annulée' } };
  }
  const retour = r.statut === 'TENUE' && !!r.observations_president;
  return {
    etapes, courante: pos(r.statut) ?? 0, termine: r.statut === 'CLOTUREE',
    alerte: retour ? { tone: 'attention', label: 'Compte rendu retourné' } : undefined,
    details: r.statut === 'CR_A_VALIDER' && r.president_nom ? { 3: `Chez ${r.president_nom}` } : {},
  };
}

/** Décisions : à exécuter → mise en œuvre (instruction ou tâche) → exécutée ; abandon possible. */
export function circuitDecision(d) {
  const etapes = ['À exécuter', 'Mise en œuvre', 'Exécutée'];
  if (d.statut === 'ABANDONNEE') return { etapes, courante: d.instruction_id || d.task_id ? 1 : 0, alerte: { tone: 'danger', label: 'Abandonnée' } };
  const pos = { A_EXECUTER: 0, EN_COURS: 1, EXECUTEE: 2 }[d.statut] ?? 0;
  return {
    etapes, courante: pos, termine: d.statut === 'EXECUTEE',
    sautees: d.statut === 'EXECUTEE' && !d.instruction_id && !d.task_id ? [1] : [],
    alerte: d.en_retard ? { tone: 'danger', label: 'En retard' } : undefined,
  };
}
