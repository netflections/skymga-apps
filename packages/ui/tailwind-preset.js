/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        sky: {
          50: '#f0f7ff',
          100: '#e0efff',
          200: '#b9dfff',
          300: '#7cc5ff',
          400: '#4B8DCC',  // Primary Blue
          500: '#3a7ab8',
          600: '#2d6699',
          700: '#1E3851',  // Dark Navy
          800: '#1a3048',
          900: '#15263a',
          950: '#0d1824',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
    },
  },
}
