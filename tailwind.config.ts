import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#11d493",
        "primary-dark": "#0ea371",
        "background-light": "#f6f8f7",
        "background-dark": "#10221c",
        "surface-dark": "#162e26",
        "surface-darker": "#0d1a16",
        "border-dark": "#23483c",
        "secondary-gold": "#ffd700",
        danger: "#ef4444"
      },
      fontFamily: {
        display: ["Manrope", "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 30px rgba(17, 212, 147, 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
