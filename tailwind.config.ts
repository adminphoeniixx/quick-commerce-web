import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        plane: "var(--plane)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-2": "var(--ink-2)",
        muted: "var(--muted)",
        hair: "var(--border)",
        blinkit: "var(--blinkit)",
        zepto: "var(--zepto)",
        instamart: "var(--instamart)",
        bigbasket: "var(--bigbasket)",
        good: "var(--good)",
        warn: "var(--warn)",
        crit: "var(--crit)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
