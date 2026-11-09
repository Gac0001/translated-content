'use strict';
/**
 * Lettres d’une campagne de collecte (1.46.0) : lettre d’envoi des modèles aux services et lettre de
 * relance des services sans retour. Préparées en brouillon dans la correspondance (document de service
 * « Lettre de transmission »), elles suivent le circuit habituel des documents : le Directeur les signe
 * à la validation, ce qui leur attribue leur numéro officiel.
 */
const { normalize } = require('../modules/documents/types');
const { nextReference } = require('./sequence');
const { addHistory } = require('./history');
const { OBJETS } = require('./collectes');

const TYPE = 'LETTRE_TRANSMISSION';
const BUREAU = { programme: 'Bureau Programme', suivi: 'Bureau Suivi-Évaluation' };
const dateLongue = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'long', year: 'numeric' });
const enumeration = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}` : l[0] || '');

/**
 * Contenu proposé de la lettre (modifiable ensuite par son auteur).
 * c : campagne (echeance au format AAAA-MM-JJ) ; services : [{ sigle, libelle }] ;
 * envoi : lettre d’envoi déjà numérotée (pour la référence de la relance), facultative.
 */
function contenu(type, c, services, envoi = null) {
  const objet = OBJETS[c.objet].libelle;
  const un = services.length === 1;
  const destinataire = un ? `Monsieur le Responsable du service ${services[0].sigle}` : 'Mesdames et Messieurs les Responsables des services du Secrétariat Général';
  const appel = un ? 'Monsieur le Responsable,' : 'Mesdames et Messieurs,';
  const liste = `Services concernés : ${enumeration(services.map((s) => s.sigle))}.`;
  const contact = `Le ${BUREAU[OBJETS[c.objet].bureau]} de la Direction d’Études et Planification reste à votre disposition pour tout renseignement complémentaire.`;
  const base = {
    signataire: 'Directeur', destinataire, adresse: 'à Kinshasa/Gombe', formule_appel: appel,
    formule_finale: `Veuillez agréer, ${un ? 'Monsieur le Responsable' : 'Mesdames et Messieurs'}, l’expression de ma considération distinguée.`,
    copies: ['Monsieur le Secrétaire Général au Numérique'],
  };
  if (type === 'ENVOI') {
    return {
      ...base,
      objet: `Collecte des données — ${objet}, exercice ${c.annee}`,
      references: `Campagne de collecte ${c.reference}`,
      corps: [
        `Dans le cadre de la campagne « ${c.titre} », la Direction d’Études et Planification procède à la collecte des données relatives au ${objet.charAt(0).toLowerCase()}${objet.slice(1)} de l’exercice ${c.annee} auprès des services du Secrétariat Général.`,
        `Je vous saurais gré de bien vouloir compléter le modèle Excel joint, établi au nom de votre service, et de le retourner à la Direction au plus tard le ${dateLongue(c.echeance)}. Seules les cellules blanches sont à renseigner ; la structure du modèle ne doit pas être modifiée, le fichier étant contrôlé à sa réception.`,
        c.instructions || null,
        un ? null : liste,
        contact,
      ].filter(Boolean).join('\n\n'),
      pieces: [`Modèle de collecte « ${objet} » (un fichier par service)`],
    };
  }
  return {
    ...base,
    objet: `Rappel — collecte des données : ${objet}, exercice ${c.annee}`,
    references: [envoi?.numero_officiel ? `Ma lettre ${envoi.numero_officiel}` : null, `campagne de collecte ${c.reference}`].filter(Boolean).join(' ; '),
    corps: [
      `${envoi?.numero_officiel ? `Par ma lettre citée en référence` : 'Dans le cadre de la campagne citée en référence'}, je vous invitais à transmettre à la Direction d’Études et Planification les données relatives au ${objet.charAt(0).toLowerCase()}${objet.slice(1)} de l’exercice ${c.annee}, au plus tard le ${dateLongue(c.echeance)}.`,
      `Sauf erreur de notre part, la contribution de ${un ? 'votre service' : 'vos services'} ne nous est pas encore parvenue. Je vous prie de bien vouloir la faire parvenir dans les meilleurs délais, sur le modèle qui vous a été transmis, afin de ne pas retarder la consolidation des données du Secrétariat Général.`,
      un ? null : liste,
      contact,
    ].filter(Boolean).join('\n\n'),
    pieces: [`Modèle de collecte « ${objet} » (rappel)`],
  };
}

/** Crée le brouillon de la lettre (document de service), auteur : l’agent qui la prépare. */
async function creerBrouillon(trx, ctx, { titre, contenu: brut }) {
  const { contenu: c } = normalize(TYPE, brut, { defauts: true });
  const dep = await trx('directions').where({ code: 'DEP' }).first();
  const [d] = await trx('documents').insert({
    reference: await nextReference(`DOC-${TYPE}`, 'DEP/LT', trx), type_document: TYPE, titre, contenu: JSON.stringify(c), confidentialite: 'ORDINAIRE',
    auteur_user_id: ctx.userId, detenteur_user_id: ctx.userId, statut: 'BROUILLON', niveau_actuel: 'AUTEUR',
    direction_id: dep.id, division_id: ctx.divisionId, bureau_id: ctx.bureauId,
  }).returning('*');
  await trx('document_versions').insert({ document_id: d.id, numero: 1, titre: d.titre, contenu: JSON.stringify(c), commentaire: 'Version initiale (campagne de collecte)', created_by: ctx.userId });
  await addHistory('DOCUMENT', d.id, ctx.userId, { action: 'CREATION', nouveau: 'BROUILLON', commentaire: 'Préparée depuis une campagne de collecte' }, trx);
  return d;
}

module.exports = { contenu, creerBrouillon };
