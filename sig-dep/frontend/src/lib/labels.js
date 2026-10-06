// Libellés et couleurs de l’interface (entièrement en français).
export const DEP_NOM = 'Direction d’Études et Planification';
export const DEP_SIGLE = 'DEP';
export const SG_NOM = 'Secrétariat Général au Numérique';

export const ROLES = {
  ADMIN_SYSTEME: 'Admin Système', SECRETAIRE_GENERAL: 'Secrétaire Général', DIRECTEUR: 'Directeur',
  CHEF_DIVISION: 'Chef de Division', CHEF_BUREAU: 'Chef de Bureau', AGENT: 'Agent',
};

export const PERIMETRES = {
  SYSTEME: 'Système', SUPERVISION_GLOBALE: 'Supervision globale', DIRECTION: 'Direction',
  DIVISION: 'Division', BUREAU: 'Bureau', PERSONNEL: 'Personnel',
};

const C = {
  gris: 'bg-slate-100 text-slate-700 ring-slate-200', bleu: 'bg-sky-50 text-sky-800 ring-sky-200', indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  jaune: 'bg-amber-50 text-amber-800 ring-amber-200', vert: 'bg-emerald-50 text-emerald-800 ring-emerald-200', rouge: 'bg-red-50 text-red-800 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200', marine: 'bg-dep-50 text-dep-800 ring-dep-200', orange: 'bg-orange-50 text-orange-800 ring-orange-200',
  ambre: 'bg-amber-100 text-amber-900 ring-amber-300',
};
/**
 * Tons des badges. Préférer les noms sémantiques pour exprimer un état :
 * succes, attention, danger, info, neutre. `ambre` signale le rattachement direct au Directeur.
 */
export const COLORS = { ...C, succes: C.vert, attention: C.jaune, danger: C.rouge, info: C.bleu, neutre: C.gris };

export const STATUTS = {
  // Instructions et tâches
  BROUILLON: ['Brouillon', C.gris], TRANSMISE: ['Transmise', C.bleu], RECUE: ['Reçue', C.indigo], EN_COURS: ['En cours', C.jaune],
  A_CORRIGER: ['À corriger', C.orange], EXECUTEE: ['Exécutée', C.violet], VALIDEE: ['Validée', C.vert], CLOTUREE: ['Clôturée', C.marine], EN_RETARD: ['En retard', C.rouge],
  BLOQUEE: ['Bloquée', C.rouge], RAPPORT_INTERMEDIAIRE: ['Rapport intermédiaire', C.indigo], ANNULEE: ['Annulée', C.gris],
  // Présences
  VERIFIEE: ['Vérifiée', C.indigo], SOUMISE: ['Soumise', C.violet], VERROUILLEE: ['Verrouillée', C.marine],
  // Documents
  EN_RELECTURE: ['En relecture', C.jaune], VISE: ['Visé', C.indigo], PUBLIE: ['Publié', C.marine],
  EN_EXAMEN: ['En examen', C.jaune], VALIDE_DIVISION: ['Validé (Division)', C.indigo], VALIDE: ['Validé', C.vert], SOUMIS: ['Soumis', C.bleu], REFUSE: ['Refusé', C.rouge], REVOQUE: ['Révoqué', C.orange], EXPIRE: ['Expiré', C.gris], REMPLACE: ['Remplacé', C.marine], REJETE: ['Rejeté', C.rouge], ARCHIVE: ['Archivé', C.gris],
  // PIP
  EN_VERIFICATION: ['En vérification', C.jaune], VERIFIE: ['Vérifiée', C.indigo],
  // Courriers
  ENREGISTRE: ['Enregistré', C.bleu], EN_CIRCULATION: ['En circulation', C.jaune], TRAITE: ['Traité', C.violet], CLASSE: ['Classé', C.vert],
  // Comptes
  ACTIF: ['Actif', C.vert], DESACTIVE: ['Désactivé', C.gris], VERROUILLE: ['Verrouillé', C.rouge],
  // Agents
  CONGE: ['En congé', C.jaune], DETACHE: ['Détaché', C.indigo], SUSPENDU: ['Suspendu', C.rouge], RETRAITE: ['Retraité', C.gris],
  // Réception
  EN_ATTENTE: ['En attente', C.jaune], RECU: ['Reçu', C.vert],
  // Demandes d’information
  ENVOYEE: ['En attente de réponse', C.jaune], REPONDUE: ['Répondue', C.vert], CLOSE: ['Close', C.gris],
  // Réunions
  CONVOQUEE: ['Convoquée', C.bleu], TENUE: ['Tenue', C.indigo], CR_A_VALIDER: ['Compte rendu à valider', C.jaune],
  // Décisions
  PROJET: ['Projet', C.gris], A_EXECUTER: ['À exécuter', C.jaune], ABANDONNEE: ['Abandonnée', C.gris],
  // Agenda
  CONSOLIDE: ['Consolidé', C.violet],
  PREVU: ['Prévu', C.bleu], CONFIRME: ['Confirmé', C.vert], TENU: ['Tenu', C.marine], ANNULE: ['Annulé', C.gris],
};

export const PRIORITES = { BASSE: ['Basse', C.gris], NORMALE: ['Normale', C.bleu], HAUTE: ['Haute', C.orange], URGENTE: ['Urgente', C.rouge] };
export const URGENCES = { NORMAL: ['Normal', C.gris], URGENT: ['Urgent', C.orange], TRES_URGENT: ['Très urgent', C.rouge] };
export const CONFIDENTIALITES = { ORDINAIRE: ['Ordinaire', C.gris], CONFIDENTIEL: ['Confidentiel', C.orange], SECRET: ['Secret', C.rouge] };
export const PRESENCES = {
  PRESENT: ['Présent', 'P', 'bg-emerald-100 text-emerald-800'], ABSENT: ['Absent', 'A', 'bg-red-100 text-red-800'],
  RETARD: ['Retard', 'R', 'bg-amber-100 text-amber-800'], CONGE: ['Congé', 'C', 'bg-sky-100 text-sky-800'],
  MISSION: ['Mission', 'M', 'bg-indigo-100 text-indigo-800'], MALADIE: ['Maladie', 'MA', 'bg-violet-100 text-violet-800'],
};
export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];

export const ACTIONS_HISTO = {
  PREPARATION: 'Préparation de l’enregistrement', REFUS: 'Refus', REVOCATION: 'Révocation', REPRISE: 'Reprise d’un acte refusé',
  CREATION: 'Création', CREATION_BROUILLON: 'Brouillon créé', TRANSMISSION: 'Transmission', RECEPTION: 'Accusé de réception',
  AVANCEMENT: 'Mise à jour de l’avancement', COMPTE_RENDU: 'Compte rendu', VALIDATION: 'Validation', RETOUR_CORRECTION: 'Retour pour correction',
  CLOTURE: 'Clôture', RETARD: 'Passage en retard', ATTRIBUTION: 'Attribution', NOUVELLE_VERSION: 'Nouvelle version', VALIDATION_DIVISION: 'Validation au niveau de la Division',
  REJET: 'Rejet', ARCHIVAGE: 'Archivage', SAISIE: 'Saisie', VERIFICATION: 'Vérification', SOUMISSION: 'Soumission', VERROUILLAGE: 'Verrouillage',
  VERROUILLAGE_AUTO: 'Verrouillage automatique', CREATION_RECTIFICATIF: 'Création du rectificatif', RECTIFICATIF: 'Rectificatif établi',
  SELECTION_AGENTS: 'Sélection des Agents', ENREGISTREMENT: 'Enregistrement', ANNOTATION: 'Annotation', ACCUSE_RECEPTION: 'Accusé de réception',
  TRAITEMENT: 'Traitement', CLASSEMENT: 'Classement',
  BLOCAGE: 'Blocage signalé', DEBLOCAGE: 'Blocage levé', RAPPORT_INTERMEDIAIRE: 'Rapport intermédiaire', ANNULATION: 'Annulation',
  DEMANDE_PROLONGATION: 'Demande de prolongation', PROLONGATION_ACCORDEE: 'Prolongation accordée', PROLONGATION_REFUSEE: 'Prolongation refusée',
  PROLONGATION: 'Délai prolongé', SOUS_TACHE: 'Sous-tâche créée', DEPENDANCE: 'Dépendance ajoutée', DEPENDANCE_RETIREE: 'Dépendance retirée',
  VISA: 'Visa', PUBLICATION: 'Publication', IMPORT: 'Import', CONSOLIDATION: 'Consolidation', SUIVI: 'Suivi de l’exécution', CONVOCATION: 'Convocation', REPORT: 'Report', MODIFICATION: 'Modification', PRESENCE: 'Présence relevée',
  TENUE: 'Réunion tenue', SOUMISSION_CR: 'Compte rendu soumis', RETOUR_CR: 'Compte rendu retourné', VALIDATION_CR: 'Compte rendu validé',
  DECISION: 'Décision', MISE_EN_OEUVRE: 'Mise en œuvre', EXECUTION: 'Exécution', ABANDON: 'Abandon', MISE_EN_OEUVRE_ANNULEE: 'Mise en œuvre annulée', ENVOI: 'Envoi', REPONSE: 'Réponse', COMPLEMENT_REPONSE: 'Complément de réponse', RELANCE: 'Relance',
};

export const NOTIF_TYPES = {
  INSTRUCTION: 'Instruction', TACHE: 'Tâche', COURRIER: 'Courrier', DOCUMENT_RETOURNE: 'Document retourné', DOCUMENT_VALIDE: 'Document validé',
  DOCUMENT_A_EXAMINER: 'Document à examiner', ECHEANCE: 'Échéance proche', RETARD: 'Retard', COMPTE_CREE: 'Compte', MDP_REINITIALISE: 'Mot de passe',
  AFFECTATION: 'Affectation', PRESENCE: 'Présences', PIP: 'PIP', INSTRUCTION_REPONSE: 'Compte rendu', SECURITE: 'Sécurité', SYSTEME: 'Annonce', ACTE: 'Acte administratif', CARTE: 'Carte de service', CONNEXION: 'Nouvelle connexion',
  DEMANDE_INFO: 'Demande d’information', REUNION: 'Réunion', DECISION: 'Décision', AGENDA: 'Agenda', PTBA: 'PTBA',
};

export const DELEGATIONS = {
  'personnel.suivre': 'suivi administratif du personnel',
  'presences.preparer_direction': 'préparation des listes de présence', 'courriers.enregistrer': 'enregistrement des courriers',
  'dossiers.transmettre': 'transmission des dossiers',
};

/** Actes administratifs (registre). */
export const TYPES_ACTE = {
  NOMINATION: 'Nomination', AFFECTATION: 'Affectation', INTERIM: 'Intérim', DESIGNATION: 'Désignation', FIN_FONCTION: 'Fin de fonction', AUTRE: 'Autre acte',
};
export const EFFETS_ACTE = {
  EN_VIGUEUR: ['En vigueur', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  A_VENIR: ['À venir', 'bg-sky-50 text-sky-800 ring-sky-200'],
  ECHU: ['Échu', 'bg-slate-100 text-slate-700 ring-slate-200'],
};
