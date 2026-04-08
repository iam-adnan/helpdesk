/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: { 50:'#f7f7f8', 100:'#ececf1', 200:'#d9d9e3', 300:'#c5c5d2', 400:'#acacbe', 500:'#8e8ea0', 600:'#565869', 700:'#40414f', 800:'#2d2d3a', 900:'#1e1e2e', 950:'#121218' },
        accent: { DEFAULT:'#e8792f', light:'#f09d5c', dark:'#c4621f' },
        success: '#22c55e',
        warning: '#eab308',
        danger: '#ef4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
