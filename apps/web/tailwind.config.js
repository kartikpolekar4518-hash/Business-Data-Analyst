/** @type {import('tailwindcss').Config} */

// Semantic tokens resolve to CSS variables declared in index.css, so a component
// names a role ("surface", "ink-soft") and the role resolves per theme. The
// channel-triple form is what lets Tailwind's /alpha modifiers keep working.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The accent ramp — ink-blue, per DESIGN.md. Kept under the `brand` key
        // so existing call sites recolour rather than break; new code uses the
        // semantic `accent` token below.
        brand: {
          50: "#f2f5f9", 100: "#e2e9f1", 200: "#c6d5e5", 300: "#9db6d0",
          400: "#6e90b4", 500: "#446c97", 600: "#2c5179", 700: "#1f3a5f",
          800: "#1a2f4c", 900: "#16263c", 950: "#0f1926",
        },

        canvas: token("canvas"),
        sunken: token("sunken"),
        surface: {
          DEFAULT: token("surface"),
          secondary: token("sunken"),
          tertiary: token("canvas"),
          elevated: token("surface"),
          sunken: token("sunken"),
        },
        ink: {
          DEFAULT: token("ink"),
          soft: token("ink-soft"),
          faint: token("ink-faint"),
        },
        border: {
          DEFAULT: token("rule"),
          secondary: token("rule-soft"),
          strong: token("rule-strong"),
        },
        rule: {
          DEFAULT: token("rule"),
          soft: token("rule-soft"),
          strong: token("rule-strong"),
        },
        accent: {
          DEFAULT: token("accent"),
          fg: token("accent-fg"),
          soft: token("accent-soft"),
        },
        pos: { DEFAULT: token("pos"), soft: token("pos-soft") },
        neg: { DEFAULT: token("neg"), soft: token("neg-soft") },
        warn: { DEFAULT: token("warn"), soft: token("warn-soft") },
      },

      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "SF Mono", "ui-monospace", "monospace"],
      },

      fontSize: {
        "display": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" }],
        "heading-1": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "700" }],
        "heading-2": ["1.25rem", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        "heading-3": ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body": ["0.875rem", { lineHeight: "1.5", fontWeight: "400" }],
        "body-sm": ["0.8125rem", { lineHeight: "1.5", fontWeight: "400" }],
        "label": ["0.75rem", { lineHeight: "1.3", letterSpacing: "0.05em", fontWeight: "600" }],
        "data": ["0.875rem", { lineHeight: "1.35", fontWeight: "500" }],
        "data-lg": ["1.75rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
      },

      borderRadius: {
        "sm": "4px",
        "md": "6px",
        "lg": "8px",
        "xl": "12px",
        "2xl": "16px",
      },

      boxShadow: {
        "card": "0 1px 3px 0 rgb(var(--shadow) / 0.1), 0 1px 2px -1px rgb(var(--shadow) / 0.1)",
        "card-hover": "0 4px 6px -1px rgb(var(--shadow) / 0.1), 0 2px 4px -2px rgb(var(--shadow) / 0.1)",
        "dropdown": "0 10px 15px -3px rgb(var(--shadow) / 0.1), 0 4px 6px -4px rgb(var(--shadow) / 0.1)",
        "modal": "0 20px 25px -5px rgb(var(--shadow) / 0.1), 0 8px 10px -6px rgb(var(--shadow) / 0.1)",
        "panel": "0 25px 50px -12px rgb(var(--shadow) / 0.25)",
      },

      spacing: {
        "4.5": "1.125rem",
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
      },

      animation: {
        "spin-slow": "spin 2s linear infinite",
      },
    },
  },
  plugins: [],
};
