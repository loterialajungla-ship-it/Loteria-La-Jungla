import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          DEFAULT: "var(--surface)",
          muted: "var(--surface-muted)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
        },
        brand: {
          50: "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
          950: "var(--brand-950)",
        },
        accent: {
          50: "var(--accent-50)",
          100: "var(--accent-100)",
          700: "var(--accent-700)",
          800: "var(--accent-800)",
        },
        danger: {
          50: "var(--danger-50)",
          100: "var(--danger-100)",
          700: "var(--danger-700)",
          800: "var(--danger-800)",
        },
        success: {
          50: "var(--success-50)",
          700: "var(--success-700)",
        },
      },
      borderRadius: {
        "lj-sm": "var(--radius-sm)",
        "lj-md": "var(--radius-md)",
        "lj-lg": "var(--radius-lg)",
      },
      boxShadow: {
        surface: "var(--shadow-sm)",
        card: "var(--shadow-md)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      ringColor: {
        focus: "var(--focus-ring)",
      },
    },
  },
  plugins: [],
};
export default config;
