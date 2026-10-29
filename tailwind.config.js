/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./renderer.js"],
  theme: {
    extend: {
      colors: {
        coral: {
          50: "#fdf5f6",
          100: "#fbe9eb",
          200: "#f6d4d8",
          300: "#efb5bc",
          400: "#f4a7ae",
          500: "#f09199",
          600: "#d96f79",
          700: "#a94d57"
        }
      },
      fontFamily: {
        sans: ["Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "sans-serif"]
      }
    }
  },
  plugins: []
};
