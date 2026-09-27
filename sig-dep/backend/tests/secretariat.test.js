'use strict';
/**
 * Règle particulière du Bureau Secrétariat de Direction :
 * rang BUREAU, rattachement direct au Directeur, aucune Division, aucune permission de Division,
 * jamais présenté ni comptabilisé comme une Division.
 */
const { db, login, loginAdmin, api, userId } = require('./helpers');
const { DIVISION_ONLY_PERMISSIONS } = require('../src/constants');

let bsd;
beforeAll(async () => { bsd = await db('bureaux').where({ est_secretariat_direction: true }).first(); });

describe('Base de données', () => {
  test('représentation conforme du Bureau Secrétariat de Direction', async () => {
    const dep = await db('directions').where({ code: 'DEP' }).first();
    expect(dep.nom).toBe('Direction d’Études et Planification');
    expect(bsd).toMatchObject({
      type_structure: 'BUREAU', rang_organique: 'BUREAU', direction_id: dep.id, division_id: null,
      parent_type: 'DIRECTION', responsable_role: 'CHEF_BUREAU', perimetre_acces: 'BUREAU', superieur_direct: 'DIRECTEUR',
    });
  });

  test('n’est pas une ligne de la table des Divisions', async () => {
    const d = await db('divisions').whereILike('nom', '%Secrétariat%');
    expect(d).toHaveLength(0);
  });

  test('les contraintes interdisent le rang DIVISION ou un rattachement à une Division', async () => {
    await expect(db('bureaux').where({ id: bsd.id }).update({ rang_organique: 'DIVISION' })).rejects.toThrow(/bureaux_rang_chk/);
    await expect(db('bureaux').where({ id: bsd.id }).update({ type_structure: 'DIVISION' })).rejects.toThrow(/bureaux_rang_chk/);
    const div = await db('divisions').first();
    await expect(db('bureaux').where({ id: bsd.id }).update({ division_id: div.id })).rejects.toThrow(/rattachement_chk/);
    await expect(db('bureaux').where({ id: bsd.id }).update({ perimetre_acces: 'DIVISION' })).rejects.toThrow(/bureaux_rang_chk/);
  });

  test('le déclencheur refuse toute permission de Division au Chef du Bureau Secrétariat', async () => {
    const uid = await userId('cb.secretariat');
    for (const code of DIVISION_ONLY_PERMISSIONS) {
      const p = await db('permissions').where({ code }).first();
      await expect(db('user_permissions').insert({ user_id: uid, permission_id: p.id })).rejects.toThrow(/SECRETARIAT_DIVISION_PERMISSION/);
    }
    const role = await db('roles').where({ code: 'CHEF_DIVISION' }).first();
    await expect(db('user_roles').insert({ user_id: uid, role_id: role.id })).rejects.toThrow(/SECRETARIAT_DIVISION_PERMISSION/);
  });

  test('le déclencheur protège aussi les Agents du Bureau Secrétariat', async () => {
    const uid = await userId('ag.secretariat1');
    const p = await db('permissions').where({ code: 'division.superviser' }).first();
    await expect(db('user_permissions').insert({ user_id: uid, permission_id: p.id })).rejects.toThrow(/SECRETARIAT_DIVISION_PERMISSION/);
  });
});

describe('API — rang, rattachement et permissions', () => {
  test('le contexte du Chef du Bureau Secrétariat conserve le périmètre BUREAU sans permission de Division', async () => {
    const res = await api(await login('cb.secretariat')).get('/auth/me');
    expect(res.body.user.perimetre).toBe('BUREAU');
    expect(res.body.user.primaryRole).toBe('CHEF_BUREAU');
    for (const p of DIVISION_ONLY_PERMISSIONS) expect(res.body.user.permissions).not.toContain(p);
  });

  test('l’Admin ne peut pas attribuer le rôle Chef de Division au Chef du Bureau Secrétariat', async () => {
    const res = await api(await loginAdmin()).put(`/users/${await userId('cb.secretariat')}/roles`, { roles: ['CHEF_DIVISION'] });
    expect([400, 403]).toContain(res.status);
    const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', await userId('cb.secretariat')).pluck('r.code');
    expect(roles).toEqual(['CHEF_BUREAU']);
  });

  test('aucune permission réservée aux Divisions ne peut être ajoutée au rôle Chef de Bureau', async () => {
    const admin = api(await loginAdmin());
    const roles = await admin.get('/users/roles');
    const cb = roles.body.roles.find((r) => r.code === 'CHEF_BUREAU');
    const res = await admin.put('/users/roles/CHEF_BUREAU/permissions', { permissions: [...cb.permissions, 'division.gerer'] });
    expect(res.status).toBe(403);
  });

  test('le Directeur ne peut déléguer qu’une permission délégable (jamais une permission de Division)', async () => {
    const dir = api(await login('directeur'));
    const res = await dir.post(`/users/${await userId('cb.secretariat')}/delegations`, { permission: 'division.gerer', motif: 'Test interdit' });
    expect(res.status).toBe(400);
  });

  test('la liste des Divisions n’inclut jamais le Bureau Secrétariat de Direction', async () => {
    const res = await api(await login('directeur')).get('/organisation/divisions');
    expect(res.status).toBe(200);
    expect(res.body.data.map((d) => d.nom).join(' ')).not.toMatch(/Secrétariat/);
  });

  test('l’organigramme distingue rang et rattachement et affiche le badge approprié', async () => {
    const res = await api(await login('sg')).get('/organisation/organigramme');
    const o = res.body;
    expect(o.divisions.map((d) => d.code)).not.toContain('BSD');
    expect(o.divisions.every((d) => d.rangOrganique === 'DIVISION')).toBe(true);
    const b = o.bureauxRattachesDirection.find((x) => x.code === 'BSD');
    expect(b.rangOrganique).toBe('BUREAU');
    expect(b.typeStructure).toBe('BUREAU');
    expect(b.responsableTitre).toBe('Chef de Bureau');
    expect(b.badge).toBe('Bureau directement rattaché au Directeur');
    expect(b.rattachement).toMatchObject({ parentType: 'DIRECTION', divisionId: null, superieurDirect: 'DIRECTEUR' });
    const nbDivisions = await db('divisions').where({ actif: true }).count('* as n').first().then((r) => Number(r.n));
    expect(o.statistiques.divisions).toBe(nbDivisions);
    expect(o.divisions).toHaveLength(nbDivisions);
  });

  test('la fiche d’un Agent du Bureau Secrétariat : Division = Aucune, supérieur = Chef du Bureau Secrétariat', async () => {
    const agentId = (await db('users').where({ username: 'ag.secretariat1' }).first()).agent_id;
    const res = await api(await login('directeur')).get(`/agents/${agentId}`);
    expect(res.body.direction).toBe('Direction d’Études et Planification');
    expect(res.body.division).toBe('Aucune');
    expect(res.body.bureau_nom).toBe('Bureau Secrétariat de Direction');
    expect(res.body.superieur.titre).toBe('Chef du Bureau Secrétariat de Direction');
  });

  test('le Chef du Bureau Secrétariat rend compte directement au Directeur', async () => {
    const res = await api(await login('cb.secretariat')).get('/hierarchie/contacts?sens=ASCENDANT');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].username).toBe('directeur');
    expect(res.body.noeud.parent).toMatch(/^DIR:/);
  });

  test('aucun Chef de Division ne peut superviser le Bureau Secrétariat (instruction refusée)', async () => {
    const res = await api(await login('cd.edi')).post('/instructions', { destinataire_user_id: await userId('cb.secretariat'), objet: 'Test interdit', contenu: 'Contenu' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CHAINE_HIERARCHIQUE');
  });

  test('le Directeur adresse directement ses instructions au Chef du Bureau Secrétariat', async () => {
    const res = await api(await login('directeur')).post('/instructions', { destinataire_user_id: await userId('cb.secretariat'), objet: 'Préparer les listes de présence', contenu: 'Pour la semaine prochaine' });
    expect(res.status).toBe(201);
    expect(res.body.division_id).toBeNull();
    expect(res.body.bureau_id).toBe(bsd.id);
  });

  test('un Chef de Division ne voit pas les Agents du Bureau Secrétariat', async () => {
    const res = await api(await login('cd.edi')).get('/agents');
    expect(res.body.data.some((a) => a.bureau_id === bsd.id)).toBe(false);
  });

  test('tableau de bord du Chef du Bureau Secrétariat = tableau de bord de Chef de Bureau', async () => {
    const res = await api(await login('cb.secretariat')).get('/dashboard');
    expect(res.body.role).toBe('CHEF_BUREAU');
    expect(res.body.perimetre).toBe('BUREAU');
    expect(res.body.bureau.rangOrganique).toBe('BUREAU');
    expect(res.body.bureau.rattachement).toBe('Bureau directement rattaché au Directeur');
    expect(res.body.bureau.superieurDirect).toBe('Directeur');
    expect(res.body.division).toBeUndefined();
    expect(res.body.bureaux).toBeUndefined();
  });

  test('les statistiques ne comptent jamais le Bureau Secrétariat comme une Division', async () => {
    const res = await api(await login('directeur')).get('/rapports/activites?periode=ANNUEL&annee=2026');
    const nbDivisions = await db('divisions').where({ actif: true }).count('* as n').first().then((r) => Number(r.n));
    expect(res.body.performance.divisions).toHaveLength(nbDivisions);
    expect(res.body.performance.divisions.map((d) => d.code)).not.toContain('BSD');
    const l = res.body.lignes.find((x) => x.code === 'BSD');
    expect(l.rang).toBe('BUREAU');
    expect(l.niveau).toBe('Bureau rattaché au Directeur');
    const sg = await api(await login('sg')).get('/dashboard');
    expect(sg.body.vueGlobale.divisions).toBe(nbDivisions);
    const nbDirect = await db('bureaux').where({ actif: true, parent_type: 'DIRECTION' }).count('* as n').first().then((r) => Number(r.n));
    expect(sg.body.vueGlobale.bureauxRattachesDirection).toBe(nbDirect);
  });

  test('le Bureau Secrétariat ne peut être rattaché à une Division via l’API', async () => {
    const div = await db('divisions').first();
    const res = await api(await login('directeur')).put(`/organisation/bureaux/${bsd.id}`, { code: 'BSD', nom: bsd.nom, rattachement: 'DIVISION', division_id: div.id });
    expect(res.status).toBe(403);
  });
});
