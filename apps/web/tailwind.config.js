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
        surface: {
          DEFAULT: "#ffffff",
          secondary: "#f8f9fc",
          tertiary: "#f1f3f8",
          elevated: "#ffffff",
        },
        border: {
          DEFAULT: "#e2e6ef",
          secondary: "#eef1f7",
          strong: "#cdd3e0",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Fira Code", "monospace"],
      },
      fontSize: {
        "display": ["2.25rem", { lineHeight: "1.2", fontWeight: "800" }],
        "heading-1": ["1.75rem", { lineHeight: "1.25", fontWeight: "700" }],
        "heading-2": ["1.375rem", { lineHeight: "1.3", fontWeight: "700" }],
        "heading-3": ["1.125rem", { lineHeight: "1.35", fontWeight: "600" }],
        "body": ["0.938rem", { lineHeight: "1.5", fontWeight: "400" }],
        "body-sm": ["0.813rem", { lineHeight: "1.5", fontWeight: "400" }],
        "label": ["0.813rem", { lineHeight: "1.4", fontWeight: "600" }],
        "data": ["0.938rem", { lineHeight: "1.4", fontWeight: "500" }],
        "data-lg": ["1.75rem", { lineHeight: "1.2", fontWeight: "700" }],
        "mono": ["0.813rem", { lineHeight: "1.5", fontWeight: "400" }],
      },
      spacing: {
        "4.5": "1.125rem",
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
      },
      borderRadius: {
        "sm": "4px",
        "md": "6px",
        "lg": "8px",
        "xl": "12px",
        "2xl": "16px",
      },
      boxShadow: {
        "card": "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03)",
        "dropdown": "0 4px 16px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        "modal": "0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)",
        "panel": "0 20px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08)",
        "focus": "0 0 0 3px rgba(51,102,245,0.25)",
        // Neon glows for the dark theme
        "glow": "0 8px 30px -10px rgba(51,102,245,0.45)",
        "glow-sm": "0 0 18px -6px rgba(89,140,255,0.5)",
        "glow-violet": "0 8px 30px -10px rgba(139,92,246,0.45)",
        "card-glow": "0 0 0 1px rgba(255,255,255,0.05), 0 18px 40px -20px rgba(0,0,0,0.8)",
      },
      // Entrance/exit motion is framer's job now. What remains here is the
      // looping ambient set, whose @keyframes live in index.css — Tailwind only
      // emits keyframes for animate-* utilities that are actually referenced in
      // markup, which silently killed the JS-defined ones.
      animation: {
        "spin-slow": "spin 2s linear infinite",
      },
    },
  },
  plugins: [],
};