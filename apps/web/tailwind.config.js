/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Purple brand (violet scale)
        brand: {
          50: "#f5f3ff", 100: "#ede9fe", 200: "#ddd6fe", 300: "#c4b5fd",
          400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9",
          800: "#5b21b6", 900: "#4c1d95", 950: "#2e1065",
        },
        // Neumorphic lavender surfaces — cards sit on the same family and are
        // distinguished by soft shadow, not hard borders.
        surface: {
          DEFAULT: "#eceafa",
          secondary: "#e8e6f4",
          tertiary: "#e3e1ef",
          elevated: "#f1effb",
        },
        border: {
          DEFAULT: "#dcd9ee",
          secondary: "#e6e3f2",
          strong: "#cbc7e2",
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
        // Neumorphic soft-UI shadows (light theme). Dark overrides live in index.css.
        "neu": "7px 7px 16px #c9c6de, -7px -7px 16px #ffffff",
        "neu-sm": "4px 4px 10px #cdcae0, -4px -4px 10px #ffffff",
        "neu-lg": "12px 12px 28px #c5c2da, -12px -12px 28px #ffffff",
        "neu-inset": "inset 3px 3px 7px #c9c6de, inset -3px -3px 7px #ffffff",
        "neu-pressed": "inset 4px 4px 9px #c5c2da, inset -4px -4px 9px #ffffff",
        "card": "7px 7px 16px #c9c6de, -7px -7px 16px #ffffff",
        "card-hover": "10px 10px 22px #c5c2da, -10px -10px 22px #ffffff",
        "dropdown": "8px 8px 20px #c5c2da, -6px -6px 16px #ffffff",
        "modal": "16px 16px 40px #bfbcd6, -12px -12px 32px #ffffff",
        "panel": "18px 18px 44px #bcb9d4, -14px -14px 36px #ffffff",
        "focus": "0 0 0 3px rgba(124,58,237,0.28)",
        "glow": "0 10px 30px -10px rgba(124,58,237,0.45)",
        "glow-sm": "0 0 18px -6px rgba(139,92,246,0.5)",
        "glow-violet": "0 10px 30px -10px rgba(139,92,246,0.5)",
        "card-glow": "6px 6px 16px rgba(0,0,0,0.45), -6px -6px 16px rgba(255,255,255,0.03)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-in": "slideIn 0.2s ease-out",
        "scale-in": "scaleIn 0.15s ease-out",
        "shimmer": "shimmer 2s infinite linear",
        "spin-slow": "spin 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};