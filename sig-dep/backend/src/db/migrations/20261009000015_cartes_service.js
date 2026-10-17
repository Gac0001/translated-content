'use strict';
/**
 * 1.12 — Cartes de service (cahier des charges, §§ 20 et 31 ; charte graphique du Gouvernement, p. 43) :
 *  - modèle de carte versionné, configuré par l’Admin Système (intitulés, couleurs, armoirie, validité) ;
 *  - spécimen de signature du Directeur, déposé par lui-même ;
 *  - cartes : préparation (Secrétariat), vérification, validation (Directeur), numéro unique et jeton
 *    du QR code, impression, remise avec accusé de réception, suspension, perte, remplacement ;
 *  - vérification publique par QR code ou par matricule, journalisée.
 */
const PERMISSIONS = [
  ['cartes.consulter', 'Consulter le registre des cartes de service', ['DIRECTEUR']],
  ['cartes.preparer', 'Préparer, imprimer et remettre les cartes de service', ['DIRECTEUR']],
  ['cartes.valider', 'Valider, suspendre ou annuler les cartes de service', ['DIRECTEUR']],
];

exports.up = async function up(knex) {
  await knex.schema.createTable('modeles_carte', (t) => {
    t.increments('id');
    t.integer('version').notNullable().unique();
    t.boolean('actif').notNullable().defaultTo(false);
    t.jsonb('intitule').notNullable(); // lignes de l’intitulé officiel (à droite de la Ligne d’État)
    t.string('adresse', 300);
    t.string('site_web', 120);
    t.string('couleur_bandeau', 7).notNullable().defaultTo('#17418a');
    t.string('couleur_accent', 7).notNullable().defaultTo('#db3832');
    t.string('titre_verso', 60).notNullable().defaultTo('LAISSEZ PASSER');
    t.text('mention_verso').notNullable();
    t.integer('validite_annees').notNullable().defaultTo(5);
    t.string('armoirie_path', 200); // Bloc-armoirie officiel (PNG ou JPEG) déposé par l’Admin
    t.boolean('verification_matricule').notNullable().defaultTo(true);
    t.text('note');
    t.integer('created_by');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE UNIQUE INDEX modeles_carte_un_actif ON modeles_carte(actif) WHERE actif');
  await knex.raw(`ALTER TABLE modeles_carte ADD CONSTRAINT modeles_carte_chk CHECK (
    validite_annees BETWEEN 1 AND 10 AND couleur_bandeau ~ '^#[0-9a-fA-F]{6}$' AND couleur_accent ~ '^#[0-9a-fA-F]{6}$')`);
  await knex('modeles_carte').insert({
    version: 1, actif: true,
    intitule: JSON.stringify(['SECRÉTARIAT GÉNÉRAL', 'AU NUMÉRIQUE', 'Direction d’Études et Planification']),
    adresse: 'Kinshasa — République Démocratique du Congo',
    mention_verso: 'Les autorités civiles et militaires sont priées d’apporter leur assistance au porteur de la présente carte.',
    note: 'Modèle initial conforme à la charte graphique du Gouvernement (février 2022) : Bloc-armoirie, Ligne d’État, intitulé officiel.',
  });

  await knex.schema.createTable('specimens_signature', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable();
    t.string('signataire', 150).notNullable();
    t.string('qualite', 100).notNullable().defaultTo('Le Directeur');
    t.string('fichier', 200).notNullable();
    t.string('sha256', 64).notNullable();
    t.boolean('actif').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('retire_at');
  });
  await knex.raw('CREATE UNIQUE INDEX specimens_un_actif_par_user ON specimens_signature(user_id) WHERE actif');

  await knex.schema.createTable('cartes_service', (t) => {
    t.increments('id');
    t.string('numero', 30).unique(); // attribué à la validation : DEP/CS/AAAA/NNNN
    t.string('jeton', 40).unique(); // contenu du QR code : aucun renseignement personnel
    t.integer('agent_id').notNullable().references('agents.id');
    t.integer('modele_id').notNullable().references('modeles_carte.id');
    t.string('statut', 12).notNullable().defaultTo('BROUILLON');
    t.string('motif_emission', 20).notNullable().defaultTo('PREMIERE'); // PREMIERE | RENOUVELLEMENT | REMPLACEMENT
    t.integer('remplace_carte_id').references('cartes_service.id');
    t.jsonb('donnees'); // renseignements figés à la validation (tels qu’imprimés)
    t.string('photo', 200); // copie de la photo figée à la validation
    t.date('date_delivrance');
    t.date('date_expiration');
    t.integer('prepare_par');
    t.integer('verifie_par');
    t.timestamp('verifie_at');
    t.integer('valide_par');
    t.timestamp('valide_at');
    t.integer('specimen_id');
    t.text('commentaire');
    t.timestamp('imprime_at');
    t.integer('nb_impressions').notNullable().defaultTo(0);
    t.timestamp('remise_at');
    t.integer('remise_par');
    t.timestamp('accuse_at');
    t.string('motif', 300); // suspension, annulation, perte
    t.timestamps(true, true);
    t.index(['agent_id']);
  });
  await knex.raw(`ALTER TABLE cartes_service ADD CONSTRAINT cartes_service_chk CHECK (
    statut IN ('BROUILLON','A_COMPLETER','VERIFIEE','VALIDEE','IMPRIMEE','REMISE','EXPIREE','SUSPENDUE','ANNULEE','PERDUE','REMPLACEE')
    AND motif_emission IN ('PREMIERE','RENOUVELLEMENT','REMPLACEMENT'))`);
  // Une seule carte en préparation et une seule carte en circulation par agent.
  await knex.raw(`CREATE UNIQUE INDEX cartes_une_en_preparation ON cartes_service(agent_id) WHERE statut IN ('BROUILLON','A_COMPLETER','VERIFIEE')`);
  await knex.raw(`CREATE UNIQUE INDEX cartes_une_en_circulation ON cartes_service(agent_id) WHERE statut IN ('VALIDEE','IMPRIMEE','REMISE','SUSPENDUE')`);
  // Une carte validée garde son numéro, son titulaire, ses renseignements et ses dates.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION trg_fn_cartes_intangibles() RETURNS trigger AS $$
    BEGIN
      IF OLD.numero IS NOT NULL AND (NEW.numero, NEW.jeton, NEW.agent_id, NEW.donnees, NEW.photo, NEW.date_delivrance, NEW.date_expiration, NEW.valide_par)
         IS DISTINCT FROM (OLD.numero, OLD.jeton, OLD.agent_id, OLD.donnees, OLD.photo, OLD.date_delivrance, OLD.date_expiration, OLD.valide_par) THEN
        RAISE EXCEPTION 'CARTE_INTANGIBLE : une carte validée ne se modifie pas ; établissez une nouvelle carte';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  await knex.raw('CREATE TRIGGER trg_cartes_intangibles BEFORE UPDATE ON cartes_service FOR EACH ROW EXECUTE FUNCTION trg_fn_cartes_intangibles()');

  await knex.schema.createTable('verifications_carte', (t) => {
    t.bigIncrements('id');
    t.string('mode', 10).notNullable(); // QR | MATRICULE
    t.integer('carte_id');
    t.string('resultat', 20).notNullable(); // VALIDE | EXPIREE | SUSPENDUE | ... | INCONNUE
    t.string('ip', 64);
    t.string('user_agent', 300);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
  });

  for (const [code, libelle, roles] of PERMISSIONS) {
    const [p] = await knex('permissions').insert({ code, module: 'cartes', libelle, delegable: false, reservee_division: false })
      .onConflict('code').merge().returning('*');
    for (const r of roles) {
      const ro = await knex('roles').where({ code: r }).first();
      if (ro) await knex('role_permissions').insert({ role_id: ro.id, permission_id: p.id }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

exports.down = async function down(knex) {
  const ids = await knex('permissions').whereIn('code', PERMISSIONS.map((p) => p[0])).pluck('id');
  await knex('role_permissions').whereIn('permission_id', ids).del();
  await knex('permissions').whereIn('id', ids).del();
  await knex.schema.dropTableIfExists('verifications_carte');
  await knex.raw('DROP TRIGGER IF EXISTS trg_cartes_intangibles ON cartes_service');
  await knex.raw('DROP FUNCTION IF EXISTS trg_fn_cartes_intangibles()');
  await knex.schema.dropTableIfExists('cartes_service');
  await knex.schema.dropTableIfExists('specimens_signature');
  await knex.schema.dropTableIfExists('modeles_carte');
};
