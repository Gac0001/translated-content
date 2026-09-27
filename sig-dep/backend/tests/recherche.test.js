'use strict';
/** Recherche globale : les résultats respectent toujours le périmètre administratif. */
const { login, loginAdmin, api } = require('./helpers');

describe('Recherche globale', () => {
  test('requête trop courte refusée', async () => {
    expect((await api(await login('directeur')).get('/recherche?q=a')).status).toBe(400);
  });

  test('le Directeur trouve un Agent du Bureau Secrétariat ; un Chef de Division non', async () => {
    const d = await api(await login('directeur')).get(`/recherche?q=${encodeURIComponent('KAPINGA')}`);
    expect(d.body.resultats.agents.map((a) => a.titre)).toEqual(expect.arrayContaining([expect.stringContaining('KAPINGA')]));
    const cd = await api(await login('cd.etudes')).get(`/recherche?q=${encodeURIComponent('KAPINGA')}`);
    expect(cd.body.resultats.agents).toHaveLength(0);
  });

  test('un Agent ne dispose pas de la catégorie Personnel et ne voit que ses éléments', async () => {
    const r = await api(await login('ag.sta1')).get('/recherche?q=DEP');
    expect(r.body.resultats.agents).toBeUndefined();
    expect(r.body.resultats.courriers || []).toHaveLength(0);
  });

  test('l’Admin technique ne trouve aucune donnée fonctionnelle', async () => {
    const r = await api(await loginAdmin()).get('/recherche?q=DEP');
    expect(r.body.total).toBe(0);
  });

  test('un courrier confidentiel n’apparaît pas hors de sa chaîne', async () => {
    const cbs = api(await login('cb.secretariat'));
    await cbs.post('/courriers', { sens: 'ENTRANT', expediteur: 'Cabinet du Ministre', destinataire: 'Directeur', objet: 'Dossier Zéphyr confidentiel', date_courrier: '2026-09-22', confidentialite: 'CONFIDENTIEL' });
    const ag = await api(await login('ag.secretariat2')).get('/recherche?q=Zéphyr');
    expect(ag.body.resultats.courriers).toHaveLength(0);
    const dir = await api(await login('directeur')).get('/recherche?q=Zéphyr');
    expect(dir.body.resultats.courriers).toHaveLength(1);
  });
});
