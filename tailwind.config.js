/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: '#0070F3',
        'accent-hover': '#005cc5',
        surface: '#FAFAFA',
        hover: '#F5F5F5',
      },
      borderColor: {
        default: '#EAEAEA',
        light: '#F0F0F0',
      },
      textColor: {
        primary: '#171717',
        secondary: '#666666',
        tertiary: '#999999',
      },
      fontFamily: {
        sans: ['var(--font-outfit)', 'Outfit', '"PingFang SC"', '-apple-system', 'BlinkMacSystemFont', '"Microsoft YaHei"', '"Noto Sans SC"', 'STHeiti', '"Helvetica Neue"', 'sans-serif'],
        mono: ['var(--font-mono-jb)', '"JetBrains Mono"', '"SF Mono"', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
