'use strict';
/** Fiche PIP complète et cohérente (données fictives), au modèle du Ministère du Plan. */
function fiche(extra = {}) {
  return {
    identification: { etape: 'Identification', service: 'Direction Infrastructures Numériques (DIN)', libelle: 'Backbone national en fibre optique — phase 2', secteur: 'Infrastructures', nature_investissement: 'Immobilisation corporelle', province: 'Kinshasa', ville_territoire: 'Kinshasa', commune: 'Gombe' },
    rattachement: { pnsd_pilier: 'Pilier d’essai', strategie_programme: 'Programme d’essai' },
    justification: { probleme: 'P', situation_actuelle: 'SA', situation_visee: 'SV' },
    objectifs: { objectif_global: 'OG', objectifs_specifiques: ['OS1'], resultats: ['R1'], directs_descriptif: 'Population' },
    calendrier: { date_debut: '2027-01-01', date_fin: '2029-12-31', activites: [{ activite: 'Études', annee1: 'Janvier-Mars' }] },
    financier: {
      couts: [{ rubrique: 'Etudes', annee1: 1000000 }, { rubrique: 'Construction/réhabilitation', annee2: 2000000, annee3: 500000 }],
      financement: [{ source: 'Etat', annee1: 1000000, annee2: 2000000, annee3: 500000 }],
    },
    institutionnel: { maitre_ouvrage: 'Ministère de l’Économie Numérique', structure_responsable: 'DIN', risques: [{ risque: 'Retard', mitigation: 'Suivi' }] },
    controle: { responsable: 'Chef de projet (essai)' },
    ...extra,
  };
}
module.exports = { fiche };
