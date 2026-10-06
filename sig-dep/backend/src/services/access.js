'use strict';
/**
 * Règles d’accès centralisées par type d’élément (lecture / écriture).
 * Utilisées par les modules métier et par le module des pièces jointes.
 * Le backend vérifie TOUJOURS l’appartenance de la donnée au périmètre de l’utilisateur.
 */
const db = require('../db/knex');
const { inScope, applyScope } = require('./scope');
const { forbidden, notFound } = require('../utils/errors');

const CONFIDENTIELS = ['CONFIDENTIEL', 'SECRET'];

// ─── Courriers ──────────────────────────────────────────────────────────────
function scopeCourriers(qb, ctx) {
  if (!ctx.can('courriers.consulter')) return qb.whereRaw('false');
  if (['SUPERVISION_GLOBALE', 'DIRECTION'].includes(ctx.perimetre)) return qb;
  const involved = (w) => w.where('c.created_by', ctx.userId).orWhere('c.detenteur_user_id', ctx.userId)
    .orWhereExists(db('courrier_transmissions as t').whereRaw('t.courrier_id = c.id').where((x) => x.where('t.from_user_id', ctx.userId).orWhere('t.to_user_id', ctx.userId)));
  return qb.where((w) => {
    involved(w);
    // Courriers ordinaires ayant circulé dans la structure de l’utilisateur
    w.orWhere((o) => {
      o.where('c.confidentialite', 'ORDINAIRE');
      o.where((s) => {
        if (ctx.perimetre === 'DIVISION') {
          s.where('c.division_id', ctx.divisionId).orWhereExists(db('courrier_transmissions as t').whereRaw('t.courrier_id = c.id').where('t.to_division_id', ctx.divisionId));
        } else if (ctx.perimetre === 'BUREAU') {
          s.where('c.bureau_id', ctx.bureauId).orWhereExists(db('courrier_transmissions as t').whereRaw('t.courrier_id = c.id').where('t.to_bureau_id', ctx.bureauId));
        } else if (ctx.can('courriers.enregistrer')) {
          s.where('c.bureau_id', ctx.bureauId || -1);
        } else {
          s.whereRaw('false');
        }
      });
    });
    // Désignation d’enregistrement : registre de la Direction (courriers ordinaires)
    if (ctx.can('courriers.enregistrer')) w.orWhere('c.confidentialite', 'ORDINAIRE');
  });
}

async function canReadCourrier(ctx, courrierId) {
  const row = await scopeCourriers(db('courriers as c').where('c.id', courrierId), ctx).first('c.id');
  return !!row;
}

// ─── Instructions / tâches ──────────────────────────────────────────────────
function scopeInstructions(qb, ctx) {
  if (!ctx.can('instructions.consulter')) return qb.whereRaw('false');
  return applyScope(qb, ctx, { division: 'i.division_id', bureau: 'i.bureau_id', personal: ['i.emetteur_user_id', 'i.destinataire_user_id', 'i.copie_user_id'] });
}
function scopeTasks(qb, ctx) {
  if (!ctx.can('taches.consulter')) return qb.whereRaw('false');
  return applyScope(qb, ctx, { division: 't.division_id', bureau: 't.bureau_id', personal: ['t.agent_user_id', 't.assigne_par_user_id'] });
}

// ─── Documents ──────────────────────────────────────────────────────────────
function scopeDocuments(qb, ctx) {
  if (!ctx.can('documents.consulter')) return qb.whereRaw('false');
  const mine = (w) => w.where('d.auteur_user_id', ctx.userId).orWhere('d.detenteur_user_id', ctx.userId)
    .orWhereExists(db('historiques as h').whereRaw(`h.entity_type = 'DOCUMENT' AND h.entity_id = d.id`).where('h.user_id', ctx.userId));
  return qb.where((w) => {
    mine(w);
    w.orWhere((o) => {
      o.whereNot('d.statut', 'BROUILLON');
      switch (ctx.perimetre) {
        case 'SUPERVISION_GLOBALE': o.whereIn('d.statut', ['VALIDE', 'PUBLIE', 'ARCHIVE']); break;
        case 'DIRECTION': break;
        case 'DIVISION': o.where('d.division_id', ctx.divisionId).whereNotIn('d.confidentialite', CONFIDENTIELS); break;
        case 'BUREAU': o.where('d.bureau_id', ctx.bureauId).whereNotIn('d.confidentialite', CONFIDENTIELS); break;
        case 'PERSONNEL':
          // Informations collectives autorisées du Bureau : documents validés ordinaires
          o.where('d.bureau_id', ctx.bureauId || -1).whereIn('d.statut', ['VALIDE', 'ARCHIVE']).where('d.confidentialite', 'ORDINAIRE'); break;
        default: o.whereRaw('false');
      }
    });
    // Documents publiés par le Directeur : visibles de la liste de diffusion
    if (['DIVISION', 'BUREAU', 'PERSONNEL'].includes(ctx.perimetre)) {
      w.orWhere((o) => {
        o.whereIn('d.statut', ['PUBLIE', 'ARCHIVE']).whereNotNull('d.publie_at').where((x) => {
          x.where('d.diffusion', 'DIRECTION').orWhereExists(db('document_diffusions as dd').whereRaw('dd.document_id = d.id')
            .where((y) => { y.where('dd.division_id', ctx.divisionId || -1).orWhere('dd.bureau_id', ctx.bureauId || -1); }));
        });
      });
    }
  });
}

// ─── PIP ────────────────────────────────────────────────────────────────────
function scopePip(qb, ctx) {
  if (!ctx.can('pip.consulter')) return qb.whereRaw('false');
  return qb.where((w) => {
    w.where('p.auteur_user_id', ctx.userId).orWhere('p.detenteur_user_id', ctx.userId);
    w.orWhere((o) => {
      o.whereNot('p.statut', 'BROUILLON');
      switch (ctx.perimetre) {
        case 'SUPERVISION_GLOBALE': case 'DIRECTION': break;
        case 'DIVISION': o.where('p.division_id', ctx.divisionId); break;
        case 'BUREAU': o.where('p.bureau_id', ctx.bureauId); break;
        case 'PERSONNEL': o.where('p.bureau_id', ctx.bureauId || -1).whereIn('p.statut', ['VALIDE', 'ARCHIVE']); break;
        default: o.whereRaw('false');
      }
    });
  });
}

// ─── Présences ──────────────────────────────────────────────────────────────
function scopePresences(qb, ctx) {
  if (!ctx.can('presences.consulter') && !ctx.can('presences.preparer_direction')) return qb.whereRaw('false');
  return qb.where((w) => {
    w.where('s.created_by', ctx.userId);
    switch (ctx.perimetre) {
      case 'SUPERVISION_GLOBALE': case 'DIRECTION': w.orWhereRaw('true'); break;
      case 'DIVISION': w.orWhere('s.division_id', ctx.divisionId); break;
      case 'BUREAU': w.orWhere('s.bureau_id', ctx.bureauId); break;
      default: break;
    }
    if (ctx.can('presences.preparer_direction')) w.orWhere('s.structure_type', 'DIRECTION');
  });
}

const LOADERS = {
  COURRIER: { table: 'courriers as c', alias: 'c', scope: scopeCourriers, writers: (r) => [r.created_by, r.detenteur_user_id] },
  INSTRUCTION: { table: 'instructions as i', alias: 'i', scope: scopeInstructions, writers: (r) => [r.emetteur_user_id, r.destinataire_user_id] },
  TASK: { table: 'tasks as t', alias: 't', scope: scopeTasks, writers: (r) => [r.agent_user_id, r.assigne_par_user_id] },
  DOCUMENT: { table: 'documents as d', alias: 'd', scope: scopeDocuments, writers: (r) => [r.auteur_user_id, r.detenteur_user_id] },
  PIP: { table: 'pip_projects as p', alias: 'p', scope: scopePip, writers: (r) => [r.auteur_user_id, r.detenteur_user_id] },
  // Réunions : annexes du compte rendu, jointes par l’organisateur, le rédacteur ou le président
  REUNION: {
    table: 'reunions as r', alias: 'r', scope: (qb, ctx) => require('../modules/reunions/routes').scopeReunions(qb, ctx),
    writers: (r) => (r.statut === 'CLOTUREE' ? [] : [r.organisateur_user_id, r.redacteur_user_id, r.president_user_id]),
  },
  // Demandes d’information du SG : pièces jointes par le SG (question) ou le Directeur (réponse)
  DEMANDE_INFO: {
    table: 'demandes_information as x', alias: 'x', scope: (qb, ctx) => require('../modules/demandesInformation/routes').scopeDemandes(qb, ctx),
    writers: (r) => [r.emetteur_user_id],
  },
  // Actes administratifs : la copie scannée se joint pendant la préparation, par la personne qui prépare l’acte.
  ACTE: {
    table: 'actes_administratifs as x', alias: 'x', scope: (qb, ctx) => require('./actes').scopeActes(qb, ctx),
    writers: (r) => (r.statut === 'BROUILLON' ? [r.prepare_par] : []), strict: true,
  },
};

/** Charge un élément en vérifiant le périmètre ; mode 'write' exige d’être partie prenante. */
async function loadEntity(ctx, type, id, mode = 'read') {
  const L = LOADERS[type];
  if (!L) throw notFound('Type d’élément inconnu.');
  const exists = await db(L.table).where(`${L.alias}.id`, id).first(`${L.alias}.*`);
  if (!exists) throw notFound('Élément introuvable.');
  const row = await L.scope(db(L.table).where(`${L.alias}.id`, id), ctx).first(`${L.alias}.*`);
  if (!row) {
    // Admin Système : lecture des pièces jointes uniquement par un accès de support validé par le Directeur.
    if (mode === 'read') {
      const gouvernance = require('./gouvernance');
      const acces = await gouvernance.accesSupportActif(ctx, type, id);
      if (acces) {
        await gouvernance.noterConsultation(acces);
        ctx.accesSupport = acces;
        return exists;
      }
    }
    throw forbidden('Cet élément est hors de votre périmètre administratif.', 'HORS_PERIMETRE');
  }
  if (mode === 'write') {
    if (ctx.perimetre === 'SUPERVISION_GLOBALE' && !['INSTRUCTION', 'ACTE', 'DEMANDE_INFO'].includes(type)) throw forbidden('Accès en lecture seule.', 'LECTURE_SEULE');
    const writers = L.writers(row).filter(Boolean);
    const courrierRegistrar = type === 'COURRIER' && ctx.can('courriers.enregistrer');
    if (L.strict && !writers.includes(ctx.userId)) throw forbidden('Les pièces d’un acte se joignent pendant sa préparation, par la personne qui le prépare.');
    if (!writers.includes(ctx.userId) && !courrierRegistrar && ctx.perimetre !== 'DIRECTION') {
      throw forbidden('Seules les personnes en charge de cet élément peuvent y joindre ou modifier des fichiers.');
    }
  }
  return row;
}

module.exports = { scopeCourriers, canReadCourrier, scopeInstructions, scopeTasks, scopeDocuments, scopePip, scopePresences, loadEntity, CONFIDENTIELS, inScope };
