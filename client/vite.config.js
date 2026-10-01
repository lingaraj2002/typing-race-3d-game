import { defineConfig } from "vite";
import obfuscator from "vite-plugin-javascript-obfuscator";

export default defineConfig({
  build: {
    sourcemap: false, // never ship source maps
    minify: "terser",
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
  },
  plugins: [
    obfuscator({
      apply: "build", // only obfuscate production builds
      options: {
        compact: true,
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.75,
        identifierNamesGenerator: "hexadecimal",
        controlFlowFlattening: false, // slow, so keep it off for games
        deadCodeInjection: false, // bloats and slows the bundle
        renameGlobals: false,
      },
    }),
  ],
});
