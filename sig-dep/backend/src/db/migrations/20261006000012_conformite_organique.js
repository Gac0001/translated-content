'use strict';
/**
 * 1.9 — Conformité au cadre organique (cahier des charges, partie 2) :
 *  - codes organiques officiels (section 5.3.3) pour la Direction, les Divisions et les Bureaux,
 *    en complément des codes internes ;
 *  - autorité de tutelle : Secrétariat Général au Numérique ;
 *  - Bureau Études, Analyses et Prospective ;
 *  - effectif organique de référence (20 postes), comparé à l’effectif réel.
 *
 * Les renommages ne remplacent que les anciennes valeurs par défaut : une appellation
 * modifiée depuis l’application est conservée.
 */
const ANCIEN_SG = 'Secrétariat Général à l’Économie Numérique';
const NOUVEAU_SG = 'Secrétariat Général au Numérique';

const CODES = {
  directions: { DEP: '5.3.3' },
  bureaux: { BSD: '5.3.3.0', 'BUR-EAP': '5.3.3.1.1', 'BUR-DOI': '5.3.3.1.2', 'BUR-STR': '5.3.3.2.1', 'BUR-COI': '5.3.3.2.2', 'BUR-PRG': '5.3.3.3.1', 'BUR-SEV': '5.3.3.3.2' },
  divisions: { 'DIV-EDI': '5.3.3.1', 'DIV-SCI': '5.3.3.2', 'DIV-PS': '5.3.3.3' },
};

/** Effectif de référence : chaque ligne compte les agents par fonction ou par grade. */
const EFFECTIF = [
  { code: 'DIR', libelle: 'Directeur', nombre: 1, critere_type: 'GRADE', critere_code: 'DIR', ordre: 1 },
  { code: 'CD', libelle: 'Chefs de Division', nombre: 3, critere_type: 'GRADE', critere_code: 'CD', ordre: 2 },
  { code: 'CB', libelle: 'Chefs de Bureau', nombre: 7, critere_type: 'GRADE', critere_code: 'CB', ordre: 3 },
  { code: 'ATA1', libelle: 'Attachés d’Administration de 1re classe', nombre: 7, critere_type: 'GRADE', critere_code: 'ATA1', ordre: 4 },
  { code: 'ATA2', libelle: 'Attaché d’Administration de 2e classe', nombre: 1, critere_type: 'GRADE', critere_code: 'ATA2', ordre: 5 },
  { code: 'HUI', libelle: 'Huissier', nombre: 1, critere_type: 'FONCTION', critere_code: 'F-HUI', ordre: 6 },
];

exports.up = async function up(knex) {
  for (const table of ['directions', 'divisions', 'bureaux']) {
    await knex.schema.alterTable(table, (t) => { t.string('code_organique', 30); });
    await knex.raw(`CREATE UNIQUE INDEX ${table}_code_organique_uniq ON ${table}(code_organique) WHERE code_organique IS NOT NULL`);
    await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_code_organique_chk CHECK (code_organique IS NULL OR code_organique ~ '^[0-9]+(\\.[0-9]+)*$')`);
    for (const [code, co] of Object.entries(CODES[table])) {
      await knex(table).where({ code }).whereNull('code_organique').update({ code_organique: co });
    }
  }
  // Le Secrétariat porte toujours le suffixe .0 du code de la Direction.
  await knex.raw(`ALTER TABLE bureaux ADD CONSTRAINT bureaux_secretariat_code_chk CHECK (
    NOT est_secretariat_direction OR code_organique IS NULL OR code_organique ~ '\\.0$')`);

  await knex('directions').where({ autorite_tutelle: ANCIEN_SG }).update({ autorite_tutelle: NOUVEAU_SG });
  await knex.raw('UPDATE directions SET missions = replace(missions, ?, ?) WHERE missions LIKE ?', [ANCIEN_SG, NOUVEAU_SG, `%${ANCIEN_SG}%`]);
  await knex('parametres').where({ cle: 'autorite_tutelle', valeur: ANCIEN_SG }).update({ valeur: NOUVEAU_SG });
  await knex('bureaux').where({ code: 'BUR-EAP', nom: 'Bureau Études, Analyses et Perspective' }).update({ nom: 'Bureau Études, Analyses et Prospective' });
  await knex('bureaux').where({ code: 'BUR-EAP', missions: 'Réaliser les études, analyses et travaux de perspective.' }).update({ missions: 'Réaliser les études, analyses et travaux de prospective.' });
  await knex('postes_organiques').where('libelle', 'like', '%Analyses et Perspective%')
    .update({ libelle: knex.raw(`replace(libelle, 'Analyses et Perspective', 'Analyses et Prospective')`) });
  await knex('attributions').where({ libelle: 'Travaux de perspective et de prospective' }).update({ libelle: 'Travaux de prospective' });

  await knex.schema.createTable('effectif_reference', (t) => {
    t.increments('id');
    t.string('code', 20).notNullable().unique();
    t.string('libelle', 150).notNullable();
    t.integer('nombre').notNullable();
    t.string('critere_type', 10).notNullable(); // GRADE | FONCTION
    t.string('critere_code', 30).notNullable();
    t.integer('ordre').notNullable().defaultTo(0);
    t.string('source', 300);
    t.integer('updated_by');
    t.timestamps(true, true);
  });
  await knex.raw(`ALTER TABLE effectif_reference ADD CONSTRAINT effectif_reference_chk CHECK (
    nombre >= 0 AND critere_type IN ('GRADE','FONCTION'))`);
  const source = 'Cadre et structures organiques du Secrétariat Général au Numérique, section 5.3.3';
  await knex('effectif_reference').insert(EFFECTIF.map((e) => ({ ...e, source })));
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('effectif_reference');
  await knex('bureaux').where({ code: 'BUR-EAP', nom: 'Bureau Études, Analyses et Prospective' }).update({ nom: 'Bureau Études, Analyses et Perspective' });
  await knex('directions').where({ autorite_tutelle: NOUVEAU_SG }).update({ autorite_tutelle: ANCIEN_SG });
  await knex('parametres').where({ cle: 'autorite_tutelle', valeur: NOUVEAU_SG }).update({ valeur: ANCIEN_SG });
  await knex.raw('ALTER TABLE bureaux DROP CONSTRAINT IF EXISTS bureaux_secretariat_code_chk');
  for (const table of ['directions', 'divisions', 'bureaux']) {
    await knex.schema.alterTable(table, (t) => { t.dropColumn('code_organique'); });
  }
};

exports.EFFECTIF = EFFECTIF;
exports.CODES = CODES;
