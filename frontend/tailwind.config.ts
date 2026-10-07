import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--ink) / <alpha-value>)", panel: "rgb(var(--panel) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)", fg: "rgb(var(--fg) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)", signal: "rgb(var(--signal) / <alpha-value>)",
        sup: "rgb(var(--sup) / <alpha-value>)", ref: "rgb(var(--ref) / <alpha-value>)", amber: "rgb(var(--amber) / <alpha-value>)",
      },
      fontFamily: { display: ["var(--font-display)", "serif"], mono: ["var(--font-mono)", "monospace"], sans: ["var(--font-sans)", "sans-serif"] },
    },
  },
} satisfies Config;
