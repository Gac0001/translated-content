/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        dep: {
          50: '#eef4fa', 100: '#d6e4f2', 200: '#adc8e4', 300: '#7ea6d1', 400: '#4d7fb8',
          500: '#2c619d', 600: '#1b4c83', 700: '#0b3d6e', 800: '#0a3059', 900: '#082543',
        },
        rdc: { bleu: '#007fff', jaune: '#f7d618', rouge: '#ce1021' },
      },
      fontFamily: { sans: ['"Source Sans 3"', 'Segoe UI', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
