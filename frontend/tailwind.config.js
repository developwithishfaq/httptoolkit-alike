/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // devtools-ish dark palette (still used by the modal overlays)
        ink: {
          900: "#0b0d10",
          850: "#101317",
          800: "#15191e",
          700: "#1c2128",
          600: "#262c35",
          500: "#323a45",
        },
        // HTTP Toolkit-style light surfaces for the main screen
        paper: {
          0: "#ffffff",
          50: "#f7f8fa",
          100: "#eceef1",
          200: "#e0e3e8",
          300: "#cdd2da",
        },
        // text tones on the light surfaces
        slate: {
          ink: "#1c2128",
        },
        // HTTP Toolkit's signature dark-navy chrome (sidebar)
        rail: {
          DEFAULT: "#1e2028",
          hover: "#2b2e3a",
          active: "#383b4a",
        },
        accent: "#4f9cf9",
        brand: "#e1421f", // HTTP Toolkit orange/red
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
