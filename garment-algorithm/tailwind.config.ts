import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          0: "#0F0F0E",   // app chrome
          1: "#141413",   // panels
          2: "#1A1A19",   // workspace
          3: "#21211F",   // hover surfaces
          line: "#262624",
          "line-hi": "#3A3A37"
        },
        fg: {
          hi: "#E8E6E1",
          mid: "#9C9A93",
          low: "#67655F"
        }
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas", "monospace"]
      }
    }
  },
  plugins: []
};
export default config;
