'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const config = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/auth');
const { DEP_NOM } = require('./constants');

const app = express();
app.set('trust proxy', config.isProd ? 1 : false);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));

app.get('/api/health', (req, res) => res.json({ statut: 'ok', application: 'SIG-DEP', direction: DEP_NOM }));
// Statut public (page de connexion, page de maintenance) : aucun détail technique
app.get('/api/statut-public', async (req, res) => {
  const m = await require('./services/maintenance').etat();
  res.json({ maintenance: { active: m.active, message: m.active ? m.message : '', fin: m.active ? m.fin : '' } });
});

// Vérification publique des cartes de service (QR code ou matricule), sans authentification
app.use('/api/public/cartes', require('./modules/cartes/public'));

app.use('/api/auth', require('./modules/auth/routes'));

// Toutes les routes suivantes exigent une authentification
const protectedModules = {
  organisation: './modules/organisation/routes',
  agents: './modules/agents/routes',
  users: './modules/users/routes',
  dashboard: './modules/dashboard/routes',
  presences: './modules/presences/routes',
  courriers: './modules/courriers/routes',
  instructions: './modules/instructions/routes',
  taches: './modules/tasks/routes',
  documents: './modules/documents/routes',
  pip: './modules/pip/routes',
  notifications: './modules/notifications/routes',
  audit: './modules/audit/routes',
  attachments: './modules/attachments/routes',
  rapports: './modules/rapports/routes',
  systeme: './modules/systeme/routes',
  hierarchie: './modules/hierarchie/routes',
  recherche: './modules/recherche/routes',
  imports: './modules/imports/routes',
  'liste-declarative': './modules/listeDeclarative/routes',
  enrolement: './modules/enrolement/routes',
  securite: './modules/securite/routes',
  supervision: './modules/supervision/routes',
  sauvegardes: './modules/sauvegardes/routes',
  maintenance: './modules/maintenance/routes',
  actes: './modules/actes/routes',
  gouvernance: './modules/gouvernance/routes',
  cartes: './modules/cartes/routes',
  'demandes-information': './modules/demandesInformation/routes',
};
for (const [path, mod] of Object.entries(protectedModules)) {
  // Un module manquant doit empêcher le démarrage, jamais être ignoré.
  app.use(`/api/${path}`, authenticate, require(mod));
}

app.use('/api', (req, res) => res.status(404).json({ error: { code: 'INTROUVABLE', message: 'Ressource introuvable.' } }));
app.use(errorHandler);

module.exports = app;
