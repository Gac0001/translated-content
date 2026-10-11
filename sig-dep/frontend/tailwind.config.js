/** @type {import('tailwindcss').Config} */
// Style « Bleu État » conforme à la charte graphique du Gouvernement (RDC).
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Échelle construite sur le bleu institutionnel de la charte (#17418a = dep-700).
        dep: {
          50: '#eef3fa', 100: '#d9e4f4', 200: '#b3c8e8', 300: '#84a5d6', 400: '#5180c0',
          500: '#2d62aa', 600: '#1f509a', 700: '#17418a', 800: '#12346f', 900: '#0d2754',
        },
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
        sans: ['"Source Sans 3"', 'Segoe UI', 'system-ui', 'sans-serif'],
        // Typographie principale de la charte, pour les titres et les chiffres clés.
        display: ['"Cooper Hewitt"', '"Source Sans 3"', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
