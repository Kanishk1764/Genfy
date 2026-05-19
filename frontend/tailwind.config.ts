import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/landing/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "#FF6B2B", // var(--orange)
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "rgba(255,107,43,0.1)",
          foreground: "#FF9066",
        },
        accent: {
          DEFAULT: "#E040C8", // var(--pink)
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "rgba(255,255,255,0.06)",
          foreground: "rgba(255,255,255,0.45)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
