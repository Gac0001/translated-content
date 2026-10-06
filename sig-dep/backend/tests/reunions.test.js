'use strict';
/**
 * Lot 8B — Réunions, décisions et agenda du Directeur.
 */
const { db, login, api, userId } = require('./helpers');
const { synchroniser } = require('../src/services/decisions');
const { rappels } = require('../src/services/agenda');

const dansJours = (j, h = 9) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + j);
  d.setUTCHours(h, 0, 0, 0);
  return d.toISOString();
};
const dansMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

describe('Réunions présidées par le Directeur', () => {
  let dir; let sec; let cdps; let reunion; let decisions;
  beforeAll(async () => {
    dir = api(await login('directeur'));
    sec = api(await login('cb.secretariat'));
    cdps = api(await login('cd.ps'));
  });

  test('préparation par le Secrétariat, convocation, agenda du Directeur', async () => {
    expect((await api(await login('ag.sev1')).post('/reunions', { objet: 'Test', debut: dansJours(2) })).status).toBe(403);
    const r = await sec.post('/reunions', {
      objet: 'Réunion de coordination mensuelle', debut: dansJours(2), fin: dansJours(2, 11), lieu: 'Salle de réunion de la DEP', pour_directeur: true,
      ordre_du_jour: [{ titre: 'Suivi des instructions du Secrétariat Général' }, { titre: 'Programmation du trimestre', rapporteur: 'Chef de Division PS' }],
      participants: [await userId('cd.ps'), await userId('cd.edi')], externes: [{ nom: 'Représentant de l’ARPTC', qualite: 'Invité' }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ niveau: 'DIRECTION', president_user_id: await userId('directeur'), redacteur_user_id: await userId('cb.secretariat'), statut: 'BROUILLON' });
    reunion = r.body.id;
    // Brouillon : invisible des participants
    expect((await cdps.get(`/reunions/${reunion}`)).status).toBe(403);
    const c = await sec.post(`/reunions/${reunion}/convoquer`);
    expect(c.body.statut).toBe('CONVOQUEE');
    expect(await db('notifications').where({ user_id: await userId('cd.ps'), type: 'REUNION', lien: `/reunions/${reunion}` }).first()).toBeTruthy();
    expect((await cdps.get(`/reunions/${reunion}`)).body.participants).toHaveLength(3);
    expect((await api(await login('cd.sci')).get(`/reunions/${reunion}`)).status).toBe(403);
    const ev = await db('agenda_evenements').where({ reunion_id: reunion }).first();
    expect(ev).toMatchObject({ type: 'REUNION', statut: 'CONFIRME' });
    // Report : l’agenda suit
    const d = (await sec.get(`/reunions/${reunion}`)).body;
    const p = await sec.put(`/reunions/${reunion}`, { objet: d.objet, debut: dansJours(3), fin: dansJours(3, 11), lieu: d.lieu, ordre_du_jour: d.ordre_du_jour, participants: [await userId('cd.ps'), await userId('cd.edi')], externes: [{ nom: 'Représentant de l’ARPTC', qualite: 'Invité' }] });
    expect(p.status).toBe(200);
    expect(new Date((await db('agenda_evenements').where({ reunion_id: reunion }).first()).debut).toISOString()).toBe(dansJours(3));
    expect((await db('historiques').where({ entity_type: 'REUNION', entity_id: reunion, action: 'REPORT' })).length).toBe(1);
    // Présence impossible avant l’heure
    expect((await sec.post(`/reunions/${reunion}/tenue`)).status).toBe(400);
  });

  test('tenue, présence, compte rendu avec décisions, retour puis validation par le président', async () => {
    await db('reunions').where({ id: reunion }).update({ debut: dansMinutes(-90), fin: dansMinutes(-10) });
    const parts = (await sec.get(`/reunions/${reunion}`)).body.participants;
    const pr = await sec.put(`/reunions/${reunion}/presences`, { presences: parts.map((x, i) => ({ id: x.id, presence: i === 1 ? 'EXCUSE' : 'PRESENT' })) });
    expect(pr.body.data.filter((x) => x.presence === 'PRESENT')).toHaveLength(2);
    expect((await sec.post(`/reunions/${reunion}/tenue`)).body.statut).toBe('TENUE');
    expect((await cdps.put(`/reunions/${reunion}/compte-rendu`, { compte_rendu: 'x' })).status).toBe(403);
    const cr = await sec.put(`/reunions/${reunion}/compte-rendu`, {
      compte_rendu: 'La réunion a examiné le suivi des instructions et la programmation du trimestre.',
      decisions: [
        { libelle: 'Produire la note de programmation du trimestre', responsable_user_id: await userId('cd.ps'), echeance: dansJours(10).slice(0, 10), resultat_attendu: 'Note validée' },
        { libelle: 'Collecter les indicateurs de couverture', responsable_user_id: await userId('ag.sev1'), echeance: dansJours(7).slice(0, 10) },
      ],
    });
    expect(cr.body.decisions.map((x) => x.statut)).toEqual(['PROJET', 'PROJET']);
    // Projets invisibles du registre tant que le compte rendu n’est pas validé
    expect((await cdps.get('/decisions')).body.data.filter((x) => x.reunion_id === reunion)).toHaveLength(0);
    expect((await sec.post(`/reunions/${reunion}/soumettre-cr`)).body.statut).toBe('CR_A_VALIDER');
    expect((await sec.post(`/reunions/${reunion}/valider-cr`)).status).toBe(403);
    expect((await dir.post(`/reunions/${reunion}/retourner-cr`, { observations: 'Préciser les échéances' })).body.statut).toBe('TENUE');
    await sec.post(`/reunions/${reunion}/soumettre-cr`);
    const v = await dir.post(`/reunions/${reunion}/valider-cr`);
    expect(v.body.statut).toBe('CLOTUREE');
    decisions = await db('decisions').where({ reunion_id: reunion }).orderBy('id');
    expect(decisions.map((x) => x.statut)).toEqual(['A_EXECUTER', 'A_EXECUTER']);
    expect(await db('notifications').where({ user_id: await userId('ag.sev1'), type: 'DECISION' }).first()).toBeTruthy();
    // Compte rendu verrouillé
    await expect(db('reunions').where({ id: reunion }).update({ compte_rendu: 'modifié' })).rejects.toThrow(/CR_VERROUILLE/);
    const pdf = await dir.get(`/reunions/${reunion}/pdf`);
    expect(pdf.status).toBe(200);
    expect((await db('agenda_evenements').where({ reunion_id: reunion }).first()).statut).toBe('TENU');
  });

  test('mise en œuvre : instruction ordinaire ou exceptionnelle, suivi automatique de l’exécution', async () => {
    const [d1, d2] = decisions;
    expect((await cdps.post(`/decisions/${d1.id}/transformer`, {})).status).toBe(403);
    expect((await dir.get(`/decisions/${d1.id}`)).body.actions.transformer).toBe('INSTRUCTION');
    const t1 = await dir.post(`/decisions/${d1.id}/transformer`, { priorite: 'HAUTE' });
    expect(t1.body.type).toBe('INSTRUCTION');
    expect((await dir.post(`/decisions/${d1.id}/transformer`, {})).status).toBe(403); // déjà mise en œuvre
    const t2 = await dir.post(`/decisions/${d2.id}/transformer`, {});
    const ins2 = await db('instructions').where({ id: t2.body.id }).first();
    expect(ins2).toMatchObject({ exceptionnelle: true, copie_user_id: await userId('cb.sev') });
    expect(ins2.justification_exception).toMatch(d2.reference);
    // Exécution de l’instruction → décision exécutée
    await cdps.post(`/instructions/${t1.body.id}/accuser-reception`);
    await cdps.post(`/instructions/${t1.body.id}/rendre-compte`, { reponse: 'Note de programmation transmise.' });
    await dir.post(`/instructions/${t1.body.id}/valider`, {});
    expect(await synchroniser()).toBe(1);
    const e1 = await db('decisions').where({ id: d1.id }).first();
    expect(e1).toMatchObject({ statut: 'EXECUTEE', resultat: 'Note de programmation transmise.' });
    // Annulation de l’instruction → la décision redevient à exécuter
    await dir.post(`/instructions/${t2.body.id}/annuler`, { motif: 'Confiée à une autre structure' });
    await synchroniser();
    expect((await db('decisions').where({ id: d2.id }).first())).toMatchObject({ statut: 'A_EXECUTER', instruction_id: null });
  });

  test('registre : décision du Directeur, compte rendu du responsable, abandon, périmètres', async () => {
    const r = await dir.post('/decisions', { libelle: 'Actualiser le répertoire des opérateurs', responsable_user_id: await userId('cd.ps'), echeance: dansJours(5).slice(0, 10) });
    expect(r.body).toMatchObject({ origine: 'DIRECTEUR', statut: 'A_EXECUTER' });
    expect((await cdps.post('/decisions', { libelle: 'X', responsable_user_id: await userId('cd.edi') })).status).toBe(403);
    expect((await cdps.post(`/decisions/${r.body.id}/abandonner`, { motif: 'Pas le temps' })).status).toBe(403);
    expect((await cdps.post(`/decisions/${r.body.id}/rendre-compte`, { resultat: 'Répertoire actualisé et publié.' })).body.statut).toBe('EXECUTEE');
    const reg = await dir.get('/decisions');
    expect(reg.body.data.map((x) => x.id)).toEqual(expect.arrayContaining([r.body.id, decisions[0].id, decisions[1].id]));
    expect(reg.body.stats.ouvertes).toBeGreaterThanOrEqual(1);
    // Autre Division : ne voit pas les décisions confiées à la Division PS
    const edi = await api(await login('cd.edi')).get('/decisions');
    expect(edi.body.data.map((x) => x.id)).not.toContain(r.body.id);
    expect((await api(await login('sg')).get('/decisions')).body.data).toHaveLength(0);
    const ab = await dir.post(`/decisions/${decisions[1].id}/abandonner`, { motif: 'Indicateurs déjà disponibles' });
    expect(ab.body.statut).toBe('ABANDONNEE');
    for (const f of ['pdf', 'xlsx']) expect((await dir.get(`/decisions/export/${f}`)).status).toBe(200);
    const tb = (await dir.get('/dashboard')).body;
    expect(tb.decisions).toBeDefined();
  });
});

describe('Réunion de Bureau : décision mise en œuvre par une tâche', () => {
  test('le Chef de Bureau préside, la décision devient une tâche', async () => {
    const cb = api(await login('cb.sev'));
    const r = await cb.post('/reunions', { objet: 'Point hebdomadaire du Bureau', debut: dansJours(1), participants: [await userId('ag.sev1'), await userId('ag.sev2')] });
    expect(r.body).toMatchObject({ niveau: 'BUREAU', president_user_id: await userId('cb.sev') });
    await cb.post(`/reunions/${r.body.id}/convoquer`);
    expect(await db('agenda_evenements').where({ reunion_id: r.body.id }).first()).toBeUndefined();
    await db('reunions').where({ id: r.body.id }).update({ debut: dansMinutes(-60) });
    await cb.post(`/reunions/${r.body.id}/tenue`);
    await cb.put(`/reunions/${r.body.id}/compte-rendu`, { compte_rendu: 'Répartition des travaux de la semaine.', decisions: [{ libelle: 'Mettre à jour le tableau de suivi', responsable_user_id: await userId('ag.sev2') }] });
    // Le président rédacteur valide directement
    expect((await cb.get(`/reunions/${r.body.id}`)).body.actions.validerCr).toBe(true);
    expect((await cb.post(`/reunions/${r.body.id}/valider-cr`)).body.statut).toBe('CLOTUREE');
    const d = await db('decisions').where({ reunion_id: r.body.id }).first();
    const t = await cb.post(`/decisions/${d.id}/transformer`, {});
    expect(t.body.type).toBe('TACHE');
    expect(await db('tasks').where({ id: t.body.id }).first()).toMatchObject({ agent_user_id: await userId('ag.sev2'), assigne_par_user_id: await userId('cb.sev') });
    // L’Agent voit la décision qui le concerne
    expect((await api(await login('ag.sev2')).get(`/decisions/${d.id}`)).status).toBe(200);
  });
});

describe('Agenda du Directeur', () => {
  test('tenu par le Secrétariat, consulté par le Directeur, rappels', async () => {
    const sec = api(await login('cb.secretariat'));
    const dir = api(await login('directeur'));
    expect((await api(await login('cd.ps')).get(`/agenda?du=${dansJours(0).slice(0, 10)}&au=${dansJours(1).slice(0, 10)}`)).status).toBe(403);
    const a = await sec.post('/agenda', { type: 'AUDIENCE', titre: 'Audience avec le Directeur de l’ARPTC', debut: dansMinutes(45), fin: dansMinutes(90), lieu: 'Bureau du Directeur', interlocuteur: 'Directeur de l’ARPTC' });
    expect(a.status).toBe(201);
    const b = await sec.post('/agenda', { type: 'DEPLACEMENT', titre: 'Mission à Matadi', debut: dansMinutes(60 * 20) });
    expect((await sec.post('/agenda', { type: 'REUNION', titre: 'X', debut: dansMinutes(100) })).status).toBe(400); // les réunions passent par leur fiche
    const vue = await dir.get(`/agenda?du=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}&au=${new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)}`);
    expect(vue.body.data.map((e) => e.id)).toEqual(expect.arrayContaining([a.body.id, b.body.id]));
    expect(await db('notifications').where({ user_id: await userId('directeur'), type: 'AGENDA' }).first()).toBeTruthy();
    expect(await rappels()).toBeGreaterThanOrEqual(2);
    expect(await db('agenda_evenements').where({ id: a.body.id }).first()).toMatchObject({ rappel_heure_envoye: true, rappel_veille_envoye: true });
    expect(await db('agenda_evenements').where({ id: b.body.id }).first()).toMatchObject({ rappel_heure_envoye: false, rappel_veille_envoye: true });
    const s = await sec.post(`/agenda/${b.body.id}/statut`, { statut: 'ANNULE' });
    expect(s.body.statut).toBe('ANNULE');
  });
});
