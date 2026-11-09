/** @type {import('tailwindcss').Config} */
// Thème « Dégradé bleu » (1.48.0) : bleu franc, menu latéral en dégradé, cartes nettes ; tricolore de la charte conservé.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Échelle bleue du thème « Dégradé bleu » : dep-600 et plus foncé portent du texte blanc (contraste ≥ 5,6:1).
        dep: {
          50: '#eaf3fc', 100: '#d3e6f8', 200: '#a9cdf1', 300: '#74aee6', 400: '#3f8dd8',
          500: '#1f77c9', 600: '#1669b8', 700: '#135ca3', 800: '#0f4b86', 900: '#0b3866',
        },
        // Menu latéral : dégradé vertical (texte blanc ≥ 5:1 sur toute sa hauteur).
        // Maquette : #006eae → #0091c0 ; le bas est foncé à #007db0 pour garder le texte blanc lisible (4,6:1).
        menu: { haut: '#006eae', bas: '#007db0', actif: '#015b8d' },
        // Page de connexion (maquette : #267dff, foncé à #1a6fe8 pour le texte blanc à 4,7:1) et accent vert des maquettes.
        accueil: { bleu: '#1a6fe8', fond: '#e7e6eb', titre: '#6f6f73' },
        accent: { vert: '#12c79c' },
        // Fond des pages et bandeaux de titre des cartes.
        fond: { page: '#f8f8fa', bandeau: '#f3f4f7', bordure: '#e6e9ee' },
        // Gris du texte secondaire légèrement assombri (#64748b par défaut) : contraste AA (4,5:1) maintenu
        // sur les fonds clairs (survol des lignes, en-têtes et pieds de tableaux, encadrés).
        slate: { 500: '#5b677a' },
        // Couleurs du drapeau, valeurs officielles de la charte (Pantone 801 C, 803 C, 485 C).
        rdc: { bleu: '#0095c9', jaune: '#fff24b', rouge: '#db3832' },
        // Couleurs complémentaires de la charte.
        charte: {
          institutionnel: '#17418a', marine: '#115780', ciel: '#0f89cb', vert: '#65b32e', orange: '#ed7016',
          brique: '#d44816', ardoise: '#193540', or: '#9f6e26', argent: '#afb8be', anthracite: '#323230',
        },
      },
      fontFamily: {
        // Polices des maquettes de référence : Nunito Sans pour le texte, Ubuntu pour les titres et chiffres clés.
        sans: ['"Nunito Sans"', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Ubuntu', '"Nunito Sans"', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
