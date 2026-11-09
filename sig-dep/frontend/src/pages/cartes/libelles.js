/** États des cartes de service (cahier des charges, annexe 2). */
export const ETATS_CARTE = {
  BROUILLON: ['Brouillon', 'bg-slate-100 text-slate-700 ring-slate-200'],
  A_COMPLETER: ['À compléter', 'bg-orange-50 text-orange-800 ring-orange-200'],
  VERIFIEE: ['Vérifiée — à valider', 'bg-sky-50 text-sky-800 ring-sky-200'],
  VALIDEE: ['Validée — à imprimer', 'bg-indigo-50 text-indigo-800 ring-indigo-200'],
  IMPRIMEE: ['Imprimée — à remettre', 'bg-violet-50 text-violet-800 ring-violet-200'],
  REMISE: ['Remise', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  EXPIREE: ['Expirée', 'bg-slate-100 text-slate-700 ring-slate-200'],
  SUSPENDUE: ['Suspendue', 'bg-amber-50 text-amber-800 ring-amber-200'],
  ANNULEE: ['Annulée', 'bg-red-50 text-red-800 ring-red-200'],
  PERDUE: ['Perdue', 'bg-red-50 text-red-800 ring-red-200'],
  REMPLACEE: ['Remplacée', 'bg-slate-100 text-slate-700 ring-slate-200'],
};
export const MOTIFS_EMISSION = { PREMIERE: 'Première délivrance', RENOUVELLEMENT: 'Renouvellement', REMPLACEMENT: 'Remplacement' };
