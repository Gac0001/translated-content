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
 */
function circuitExecution(statut, historique, avecBrouillon) {
  const etapes = [...(avecBrouillon ? ['Brouillon'] : []), 'Transmise', 'Reçue', 'En cours', 'Exécutée', 'Validée', 'Clôturée'];
  const i = (label) => etapes.indexOf(label);
  const entamee = aFait(historique, 'RECEPTION', 'AVANCEMENT', 'COMPTE_RENDU');
  const position = {
    BROUILLON: 0, TRANSMISE: i('Transmise'), RECUE: i('Reçue'), EN_COURS: i('En cours'), A_CORRIGER: i('En cours'),
    // Le retard est posé automatiquement : la position dépend de ce qui a déjà été fait.
    EN_RETARD: entamee ? i('En cours') : i('Transmise'),
    EXECUTEE: i('Exécutée'), VALIDEE: i('Validée'), CLOTUREE: i('Clôturée'),
  }[statut] ?? 0;
  const alerte = statut === 'A_CORRIGER' ? { tone: 'attention', label: 'Retournée pour correction' }
    : statut === 'EN_RETARD' ? { tone: 'danger', label: 'En retard' } : undefined;
  const sautees = position > i('Reçue') && !aFait(historique, 'RECEPTION') ? [i('Reçue')] : [];
  return { etapes, courante: position, alerte, termine: statut === 'CLOTUREE', sautees };
}

export const circuitInstruction = (i) => circuitExecution(i.statut, i.historique, true);
export const circuitTache = (t) => circuitExecution(t.statut, t.historique, false);

const NIVEAUX_EXAMEN = { BUREAU: 'Chef de Bureau', DIVISION: 'Chef de Division', DIRECTION: 'Directeur' };

/**
 * Documents : l’examen remonte la chaîne hiérarchique (niveau_actuel) jusqu’au Directeur.
 * Un document rejeté peut être archivé : il n’a alors jamais été validé (valide_at vide).
 */
export function circuitDocument(d) {
  const etapes = ['Rédaction', 'Examen hiérarchique', 'Décision du Directeur', 'Validé et signé', 'Archivé'];
  const rejete = d.statut === 'REJETE' || (d.statut === 'ARCHIVE' && !d.valide_at);
  const etapesRejet = [...etapes.slice(0, 3), 'Rejeté', 'Archivé'];
  switch (d.statut) {
    case 'BROUILLON': return { etapes, courante: 0 };
    case 'A_CORRIGER': return { etapes, courante: 0, alerte: { tone: 'attention', label: 'Retourné pour correction' } };
    case 'EN_EXAMEN': return d.niveau_actuel === 'DIRECTION'
      ? { etapes, courante: 2 }
      : { etapes, courante: 1, details: NIVEAUX_EXAMEN[d.niveau_actuel] ? { 1: `Chez le ${NIVEAUX_EXAMEN[d.niveau_actuel]}` } : {} };
    case 'VALIDE_DIVISION': return { etapes, courante: 1, details: { 1: 'Validé par la Division, à transmettre au Directeur' } };
    case 'VALIDE': return { etapes, courante: 3 };
    case 'REJETE': return { etapes: etapesRejet, courante: 3, alerte: { tone: 'danger', label: 'Rejeté' } };
    case 'ARCHIVE': return rejete
      ? { etapes: etapesRejet, courante: 4, termine: true, details: { 3: 'Document rejeté' } }
      : { etapes, courante: 4, termine: true };
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
