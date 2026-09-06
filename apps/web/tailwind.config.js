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
        pos: token("pos"),
        neg: token("neg"),
        warn: token("warn"),
      },

      fontFamily: {
        sans: ["Archivo", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "SF Mono", "ui-monospace", "monospace"],
      },

      // One scale. Hand-written sizes (text-[13px]) are not allowed in new code.
      fontSize: {
        "display": ["2rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
        "heading-1": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "700" }],
        "heading-2": ["1.1875rem", { lineHeight: "1.25", letterSpacing: "-0.01em", fontWeight: "600" }],
        "heading-3": ["1rem", { lineHeight: "1.3", fontWeight: "600" }],
        "body": ["0.875rem", { lineHeight: "1.55", fontWeight: "400" }],
        "body-sm": ["0.8125rem", { lineHeight: "1.5", fontWeight: "400" }],
        "label": ["0.6875rem", { lineHeight: "1.3", letterSpacing: "0.07em", fontWeight: "600" }],
        "data": ["0.875rem", { lineHeight: "1.35", fontWeight: "500" }],
        "data-lg": ["1.625rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
      },

      // Tight, ledger-like. rounded-full stays for pills and dots only.
      borderRadius: {
        "sm": "2px",
        "md": "3px",
        "lg": "4px",
        "xl": "6px",
        "2xl": "8px",
      },

      // One card shadow plus two overlay shadows. Nothing else casts one, and
      // nothing glows — see DESIGN.md.
      boxShadow: {
        "card": "0 1px 2px rgb(var(--shadow) / 0.06)",
        "card-hover": "0 2px 6px rgb(var(--shadow) / 0.08)",
        "dropdown": "0 4px 14px rgb(var(--shadow) / 0.10), 0 1px 3px rgb(var(--shadow) / 0.06)",
        "modal": "0 16px 48px rgb(var(--shadow) / 0.18), 0 4px 12px rgb(var(--shadow) / 0.08)",
        "panel": "0 20px 60px rgb(var(--shadow) / 0.22)",
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
