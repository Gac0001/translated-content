'use strict';
/**
 * Présences journalières (1.38.0) : listes Cadres et Agents tenues par le Secrétariat de Direction,
 * retards, motifs d’absence, rapport hebdomadaire (transmission, rejet, retransmission,
 * verrouillage), rectificatifs validés par le Directeur, consultation des Chefs et du SG, jours
 * fériés, horaires de référence, exports au format de l’annexe 11.
 */
const { db, login, api } = require('./helpers');
const P = require('../src/services/presences');

const binaire = (r) => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
// Semaines passées distinctes pour chaque scénario (les présences ne se saisissent pas à l’avance)
const lundi = (k) => P.ajouterJours(P.lundiDe(P.aujourdhui()), -7 * k);

/** Renseigne toutes les lignes d’une liste : présents à l’heure, sauf les modifications données. */
async function remplir(sec, liste, modifs = {}) {
  const lignes = liste.lignes.map((l) => ({ agent_id: l.agent_id, heure_arrivee: '08:00', heure_depart: '15:30', ...(modifs[l.agent_id] || {}) }));
  const r = await sec.put(`/presences/listes/${liste.id}`, { lignes });
  expect(r.status).toBe(200);
  return r.body;
}

/** Ouvre et remplit les dix listes d’une semaine ; renvoie la semaine et les listes du lundi. */
async function semaineComplete(sec, debut, modifsLundi = {}) {
  let lundiListes;
  for (const date of P.joursOuvrables(debut)) {
    const j = await sec.get(`/presences/jour/${date}`);
    expect(j.status).toBe(200);
    if (j.body.ferie) continue;
    const remplies = [];
    for (const l of j.body.listes) remplies.push(await remplir(sec, l, date === debut ? modifsLundi : {}));
    if (date === debut) lundiListes = remplies;
  }
  const s = await db('presence_semaines').where({ semaine_debut: debut }).first();
  return { semaine: s, lundi: lundiListes };
}

describe('Présences journalières', () => {
  test('le Secrétariat ouvre les listes du jour (Cadres et Agents, regroupées selon l’annexe 11)', async () => {
    const sec = api(await login('ag.secretariat1'));
    const date = P.ajouterJours(lundi(5), 1);
    const r = await sec.get(`/presences/jour/${date}`);
    expect(r.status).toBe(200);
    expect(r.body.listes.map((l) => l.categorie)).toEqual(['CADRES', 'AGENTS']);
    expect(r.body.listes.every((l) => l.statut === 'BROUILLON' && l.actions.saisir)).toBe(true);
    const eligibles = await P.agentsEligibles();
    expect(r.body.listes[0].lignes.length + r.body.listes[1].lignes.length).toBe(eligibles.length);
    // Cadres : Chef de Bureau et au-dessus ; regroupement I, I.1, I.2…
    const grades = await db('grades').select('code', 'niveau');
    const niveau = Object.fromEntries(grades.map((g) => [g.code, g.niveau]));
    expect(r.body.listes[0].lignes.every((l) => niveau[l.grade_code] >= P.NIVEAU_CADRE)).toBe(true);
    expect(r.body.listes[1].lignes.every((l) => niveau[l.grade_code] < P.NIVEAU_CADRE)).toBe(true);
    expect(r.body.listes[1].lignes.some((l) => l.structure_code === 'I.1')).toBe(true);
    // Deuxième ouverture : aucune liste en double
    await sec.get(`/presences/jour/${date}`);
    expect(Number((await db('presence_listes').where({ date }).count('* as n').first()).n)).toBe(2);
    // Week-end, jour à venir : pas de liste
    const samedi = await sec.get(`/presences/jour/${P.ajouterJours(lundi(5), 5)}`);
    expect(samedi.body.listes).toHaveLength(0);
    expect(samedi.body.raison).toMatch(/ouvrables/);
    const demain = await sec.get(`/presences/jour/${P.ajouterJours(P.aujourdhui(), 7)}`);
    expect(demain.body.listes).toHaveLength(0);
  });

  test('saisie : retard calculé, motif d’absence, contrôles', async () => {
    const sec = api(await login('cb.secretariat'));
    const date = P.ajouterJours(lundi(5), 2);
    const [cadres, agents] = (await sec.get(`/presences/jour/${date}`)).body.listes;
    const [a1, a2, a3] = agents.lignes;
    const r = await sec.put(`/presences/listes/${agents.id}`, { lignes: [
      { agent_id: a1.agent_id, heure_arrivee: '08:20', heure_depart: '15:30' },
      { agent_id: a2.agent_id, heure_arrivee: '08:10', heure_depart: '15:30' },
      { agent_id: a3.agent_id, motif: 'MISSION', heure_arrivee: '08:00', observation: 'Mission à Matadi' },
    ] });
    expect(r.status).toBe(200);
    const ligne = (id) => r.body.lignes.find((l) => l.agent_id === id);
    expect(ligne(a1.agent_id).retard_minutes).toBe(20); // au-delà de la tolérance de 15 minutes
    expect(ligne(a2.agent_id).retard_minutes).toBe(0);
    expect(ligne(a3.agent_id)).toMatchObject({ motif: 'MISSION', heure_arrivee: null });
    expect(r.body.bilan).toMatchObject({ retards: 1, absents: 1 });
    expect((await sec.put(`/presences/listes/${agents.id}`, { lignes: [{ agent_id: a1.agent_id, heure_arrivee: '10:00', heure_depart: '09:00' }] })).status).toBe(400);
    expect((await sec.put(`/presences/listes/${agents.id}`, { lignes: [{ agent_id: a1.agent_id, heure_arrivee: '8h' }] })).status).toBe(400);
    expect((await sec.put(`/presences/listes/${cadres.id}`, { lignes: [{ agent_id: a1.agent_id, heure_arrivee: '08:00' }] })).status).toBe(400); // agent d’une autre liste
    // Les Chefs consultent, sans saisir ; le Directeur ne crée pas de liste
    const cb = api(await login('cb.coi'));
    expect((await cb.put(`/presences/listes/${agents.id}`, { lignes: [{ agent_id: a1.agent_id, heure_arrivee: '08:00' }] })).status).toBe(403);
    const dir = api(await login('directeur'));
    const autre = await dir.get(`/presences/jour/${P.ajouterJours(lundi(5), 3)}`);
    expect(autre.body.listes).toHaveLength(0);
    // Transmission refusée tant que la semaine est incomplète
    const s = await db('presence_semaines').where({ semaine_debut: lundi(5) }).first();
    const t = await sec.post(`/presences/semaines/${s.id}/transmettre`, {});
    expect(t.status).toBe(400);
    expect(t.body.error.details.manquants.length).toBeGreaterThan(0);
  });

  test('rapport hebdomadaire : transmission, rejet, rectificatif, retransmission, verrouillage', async () => {
    const sec = api(await login('ag.secretariat1'));
    const dir = api(await login('directeur'));
    const debut = lundi(2);
    const bureau = await db('bureaux').where({ code: 'BUR-COI' }).first();
    const eligibles = await P.agentsEligibles();
    const agentCoi = eligibles.find((e) => e.bureau_id === bureau.id && e.categorie === 'AGENTS');
    const { semaine, lundi: listesLundi } = await semaineComplete(sec, debut, { [agentCoi.agent_id]: { heure_arrivee: '09:00', heure_depart: '15:30' } });
    expect(semaine.statut).toBe('EN_PREPARATION');
    expect(semaine.reference).toMatch(/^DEP\/PRES\/\d{4}\/S\d{2}$/);
    // Le Directeur ne voit pas un rapport en préparation
    expect((await dir.get(`/presences/semaines/${semaine.id}`)).status).toBe(403);

    const t = await sec.post(`/presences/semaines/${semaine.id}/transmettre`, {});
    expect(t.status).toBe(200);
    expect(t.body.statut).toBe('TRANSMIS');
    expect(await db('presence_listes').where({ semaine_id: semaine.id }).whereNot('statut', 'TRANSMISE').first()).toBeUndefined();
    const dirId = (await db('users').where({ username: 'directeur' }).first()).id;
    expect(await db('notifications').where({ user_id: dirId, type: 'PRESENCE' }).where('titre', 'like', `%${semaine.reference}%`).first()).toBeDefined();
    // Intangibilité : API et base
    const agentsLundi = listesLundi.find((l) => l.categorie === 'AGENTS');
    expect((await sec.put(`/presences/listes/${agentsLundi.id}`, { lignes: [{ agent_id: agentCoi.agent_id, heure_arrivee: '08:00', heure_depart: '15:30' }] })).status).toBe(400);
    await expect(db('presence_lignes').where({ liste_id: agentsLundi.id }).update({ heure_arrivee: '07:00' })).rejects.toThrow(/PRESENCE_LOCKED/);
    await expect(db('presence_listes').where({ id: agentsLundi.id }).update({ statut: 'BROUILLON' })).rejects.toThrow(/PRESENCE_LOCKED/);

    // Consultation : le Chef de Bureau ne voit que son Bureau ; le SG n’a que des agrégats
    const cb = api(await login('cb.coi'));
    const vue = await cb.get(`/presences/listes/${agentsLundi.id}`);
    expect(vue.status).toBe(200);
    expect(vue.body.lignes.length).toBeGreaterThan(0);
    expect(vue.body.lignes.every((l) => l.bureau_id === bureau.id)).toBe(true);
    expect((await cb.get(`/presences/semaines/${semaine.id}/export/pdf`)).status).toBe(403);
    const sg = api(await login('sg'));
    const vueSg = await sg.get(`/presences/semaines/${semaine.id}`);
    expect(vueSg.status).toBe(200);
    expect(vueSg.body.jours[0].listes[1].bilan.total).toBeGreaterThan(0);
    expect((await sg.get(`/presences/listes/${agentsLundi.id}`)).status).toBe(403);
    expect((await sg.get(`/presences/jour/${debut}`)).status).toBe(403);

    // Rejet par le Directeur, puis rectificatif et retransmission
    expect((await dir.post(`/presences/semaines/${semaine.id}/rejeter`, { motif: 'x' })).status).toBe(400);
    const rej = await dir.post(`/presences/semaines/${semaine.id}/rejeter`, { motif: 'Retard du lundi à justifier' });
    expect(rej.body.statut).toBe('REJETE');
    expect((await sec.post(`/presences/semaines/${semaine.id}/retransmettre`, {})).status).toBe(400);
    expect((await sec.post(`/presences/listes/${agentsLundi.id}/rectificatifs`, { motif: 'Aucune modification', lignes: [{ agent_id: agentCoi.agent_id, heure_arrivee: '09:00', heure_depart: '15:30' }] })).status).toBe(400);
    const rect = await sec.post(`/presences/listes/${agentsLundi.id}/rectificatifs`, { motif: 'Agent en formation, pièce transmise', lignes: [{ agent_id: agentCoi.agent_id, motif: 'FORMATION' }] });
    expect(rect.status).toBe(201);
    expect((await sec.post(`/presences/listes/${agentsLundi.id}/rectificatifs`, { motif: 'Second rectificatif', lignes: [{ agent_id: agentCoi.agent_id, motif: 'CONGE' }] })).status).toBe(409);
    expect((await sec.post(`/presences/semaines/${semaine.id}/retransmettre`, {})).body.statut).toBe('TRANSMIS');

    // Décision du Directeur : valeurs effectives modifiées, original intact
    const r = await db('presence_rectificatifs').where({ liste_id: agentsLundi.id }).first();
    expect(r.lignes[0].avant).toMatchObject({ heure_arrivee: '09:00', retard_minutes: 60 });
    expect((await sec.post(`/presences/rectificatifs/${r.id}/decision`, { decision: 'VALIDE' })).status).toBe(403);
    expect((await dir.post(`/presences/rectificatifs/${r.id}/decision`, { decision: 'REFUSE' })).status).toBe(400); // motif du refus exigé
    expect((await dir.post(`/presences/rectificatifs/${r.id}/decision`, { decision: 'VALIDE', commentaire: 'Pièce vue' })).body.statut).toBe('VALIDE');
    const apres = (await dir.get(`/presences/listes/${agentsLundi.id}`)).body.lignes.find((l) => l.agent_id === agentCoi.agent_id);
    expect(apres).toMatchObject({ motif: 'FORMATION', heure_arrivee: null, rectifiee: r.reference });
    expect((await db('presence_lignes').where({ liste_id: agentsLundi.id, agent_id: agentCoi.agent_id }).first()).heure_arrivee).toBe('09:00');
    await expect(db('presence_rectificatifs').where({ id: r.id }).del()).rejects.toThrow();

    const v = await dir.post(`/presences/semaines/${semaine.id}/verrouiller`, { commentaire: 'Reçu' });
    expect(v.body.statut).toBe('VERROUILLE');
    expect(await db('presence_listes').where({ semaine_id: semaine.id }).whereNot('statut', 'VERROUILLEE').first()).toBeUndefined();
    await expect(db('presence_semaines').where({ id: semaine.id }).update({ statut: 'TRANSMIS' })).rejects.toThrow(/PRESENCE_LOCKED/);
    const hist = (await dir.get(`/presences/semaines/${semaine.id}`)).body.historique.map((h) => h.action);
    expect(hist).toEqual(['TRANSMISSION', 'REJET', 'RECTIFICATIF', 'RETRANSMISSION', 'RECTIFICATIF_VALIDE', 'VERROUILLAGE']);

    // Présences personnelles de l’agent (valeurs effectives)
    const user = await db('users').where({ agent_id: agentCoi.agent_id }).first();
    if (user) {
      const moi = await api(await login(user.username)).get('/presences/moi');
      expect(moi.body.data.find((l) => l.date === debut)).toMatchObject({ motif: 'FORMATION', etat: 'ABSENT' });
    }

    // Exports au format de l’annexe 11
    const pdf = await binaire(dir.get(`/presences/semaines/${semaine.id}/export/pdf`));
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    const xlsx = await binaire(dir.get(`/presences/semaines/${semaine.id}/export/xlsx`));
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Cadres', 'Agents']);
    const textes = [];
    wb.getWorksheet('Agents').eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string') textes.push(c.value); }));
    expect(textes).toEqual(expect.arrayContaining(['H-A', 'H-D', 'Pour la DEP', 'Formation*']));
    expect(textes.some((t) => /^Liste des présences des Agents affectés à la Direction d’Études et Planification$/.test(t))).toBe(true);
    expect(textes.some((t) => /^I\.1 /.test(t))).toBe(true);

    // Tableau de bord du Directeur et rapports d’activités
    const tdb = (await dir.get('/dashboard')).body;
    expect(tdb.presencesSemaine).toMatchObject({ reference: expect.stringMatching(/^DEP\/PRES/) });
  });

  test('jours fériés et horaires de référence', async () => {
    const sec = api(await login('cb.secretariat'));
    const dir = api(await login('directeur'));
    const debut = lundi(3);
    const mercredi = P.ajouterJours(debut, 2);
    expect((await sec.post('/presences/feries', { date: P.ajouterJours(debut, 5), libelle: 'Samedi' })).status).toBe(400);
    const f = await dir.post('/presences/feries', { date: mercredi, libelle: 'Jour férié (essai)' });
    expect(f.status).toBe(201);
    const j = await sec.get(`/presences/jour/${mercredi}`);
    expect(j.body.listes).toHaveLength(0);
    expect(j.body.raison).toMatch(/férié/);
    // Horaires : modifiables par le Directeur ou le Secrétariat, pas par un Chef de Bureau
    expect((await api(await login('cb.coi')).put('/presences/parametres', { arrivee: '07:30', depart: '15:00', tolerance: 10 })).status).toBe(403);
    expect((await dir.put('/presences/parametres', { arrivee: '08:00', depart: '07:00', tolerance: 10 })).status).toBe(400);
    expect((await dir.put('/presences/parametres', { arrivee: '07:30', depart: '15:00', tolerance: 10 })).body.horaires).toEqual({ arrivee: '07:30', depart: '15:00', tolerance: 10 });
    // La semaine se transmet sans le jour férié, avec les horaires en vigueur à l’ouverture des listes
    const { semaine, lundi: l } = await semaineComplete(sec, debut);
    expect(l[0]).toMatchObject({ heure_arrivee_ref: '07:30', tolerance_minutes: 10 });
    const t = await sec.post(`/presences/semaines/${semaine.id}/transmettre`, {});
    expect(t.status).toBe(200);
    expect(t.body.jours[2]).toMatchObject({ ferie: 'Jour férié (essai)' });
    expect((await dir.post('/presences/feries', { date: debut, libelle: 'Trop tard' })).status).toBe(409);
    await dir.put('/presences/parametres', { arrivee: '08:00', depart: '15:30', tolerance: 15 });
    expect((await dir.del(`/presences/feries/${f.body.id}`)).status).toBe(200);
  });

  test('synthèse mensuelle : Direction, structure d’un Chef, agrégats du SG, exports', async () => {
    const mois = lundi(2).slice(0, 7);
    const dir = api(await login('directeur'));
    const r = await dir.get(`/presences/synthese?mois=${mois}`);
    expect(r.status).toBe(200);
    const d = r.body;
    expect(d.global.renseignes).toBeGreaterThan(0);
    expect(d.structures.reduce((t, x) => t + x.renseignes, 0)).toBe(d.global.renseignes);
    expect(d.agents.reduce((t, x) => t + x.retards, 0)).toBe(d.global.retards);
    expect(d.global.taux).toBeGreaterThan(0);
    expect(d.structures.map((x) => x.code)).toEqual(expect.arrayContaining(['I.1']));
    // Valeur rectifiée (rectificatif validé du scénario précédent) comptée comme absence pour formation
    expect(d.global.motifs.FORMATION).toBeGreaterThanOrEqual(1);
    // Chef de Bureau : son Bureau seulement ; SG : agrégats sans nom ; Agent : refus
    const bureau = await db('bureaux').where({ code: 'BUR-COI' }).first();
    const cb = (await api(await login('cb.coi')).get(`/presences/synthese?mois=${mois}`)).body;
    expect(cb.portee).toBe('Bureau');
    expect(cb.agents.length).toBeGreaterThan(0);
    expect(cb.structures.every((x) => x.code === cb.structures[0].code)).toBe(true);
    const lignesCoi = await db('presence_lignes').where({ bureau_id: bureau.id }).first();
    expect(cb.structures[0].code).toBe(lignesCoi.structure_code);
    const sg = (await api(await login('sg')).get(`/presences/synthese?mois=${mois}`)).body;
    expect(sg.agents).toBeNull();
    expect(sg.global.renseignes).toBe(d.global.renseignes);
    expect((await api(await login('ag.coi1')).get('/presences/synthese')).status).toBe(403);
    expect((await dir.get('/presences/synthese?mois=2026-13')).status).toBe(400);
    const pdf = await binaire(dir.get(`/presences/synthese/export/pdf?mois=${mois}`));
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    const xlsx = await binaire(dir.get(`/presences/synthese/export/xlsx?mois=${mois}`));
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Par structure', 'Par agent', 'Par jour']);
    const wbSg = new ExcelJS.Workbook();
    await wbSg.xlsx.load((await binaire(api(await login('sg')).get(`/presences/synthese/export/xlsx?mois=${mois}`))).body);
    expect(wbSg.worksheets.map((w) => w.name)).toEqual(['Par structure', 'Par jour']);
  });

  test('files « À traiter » et compteur du menu', async () => {
    const dir = api(await login('directeur'));
    const files = (await dir.get('/dashboard/a-traiter')).body.files;
    const examiner = files.find((f) => f.cle === 'presences_examiner');
    expect(examiner.total).toBeGreaterThan(0);
    expect(examiner.items[0].to).toMatch(/^\/presences\/semaines\/\d+$/);
    const transmis = Number((await db('presence_semaines').where('statut', 'TRANSMIS').count('* as n').first()).n);
    const proposes = Number((await db('presence_rectificatifs').where('statut', 'PROPOSE').count('* as n').first()).n);
    expect((await dir.get('/dashboard/compteurs')).body.presences).toBe(transmis + proposes);
    // Secrétariat : semaine écoulée encore en préparation à transmettre
    const sec = (await api(await login('cb.secretariat')).get('/dashboard/a-traiter')).body.files;
    expect(sec.find((f) => f.cle === 'presences_transmettre').items.map((i) => i.titre).join(' ')).toMatch(/DEP\/PRES/);
    // Le SG n’a pas de file de présences ; le tableau de bord du Directeur porte les indicateurs du mois
    expect((await api(await login('sg')).get('/dashboard/a-traiter')).body.files.some((f) => f.module === 'presences')).toBe(false);
    const tdb = (await dir.get('/dashboard')).body;
    if (tdb.presencesMois) expect(tdb.presencesMois).toMatchObject({ mois: P.aujourdhui().slice(0, 7) });
  });

  test('droits : l’Admin et les Agents hors Secrétariat n’ont pas accès', async () => {
    const ag = api(await login('ag.coi1'));
    expect((await ag.get('/presences/semaines')).status).toBe(403);
    expect((await ag.get(`/presences/jour/${lundi(1)}`)).status).toBe(403);
    expect((await ag.get('/presences/moi')).status).toBe(200);
    // Anciennes listes hebdomadaires : lecture seule
    const anciennes = await api(await login('directeur')).get('/presences/anciennes');
    expect(anciennes.status).toBe(200);
  });
});
