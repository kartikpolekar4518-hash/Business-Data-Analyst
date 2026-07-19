/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff", 100: "#d9e6ff", 200: "#bcd3ff", 300: "#8eb4ff",
          400: "#598cff", 500: "#3366f5", 600: "#1f47e0", 700: "#1a38c0",
          800: "#1b319b", 900: "#1c2e7a", 950: "#111a45",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
