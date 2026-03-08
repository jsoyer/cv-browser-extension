import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "path"
import { copyFileSync, mkdirSync, existsSync } from "fs"

// ---------------------------------------------------------------------------
// Custom plugin: copy manifest.json and icons to dist root
// ---------------------------------------------------------------------------
function copyExtensionAssets() {
  return {
    name: "copy-extension-assets",
    closeBundle() {
      // Manifest
      copyFileSync("src/manifest.json", "dist/manifest.json")

      // Icons
      const iconsDir = "dist/icons"
      if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true })

      const iconFiles = ["icon-16.png", "icon-48.png", "icon-128.png"]
      for (const icon of iconFiles) {
        const src = `public/icons/${icon}`
        const dest = `${iconsDir}/${icon}`
        if (existsSync(src)) {
          copyFileSync(src, dest)
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyExtensionAssets()],

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: true,

    rollupOptions: {
      input: {
        // Pages
        popup: resolve(__dirname, "src/popup/index.html"),
        options: resolve(__dirname, "src/options/index.html"),
        // Scripts (no HTML entry)
        "background/service-worker": resolve(
          __dirname,
          "src/background/service-worker.ts"
        ),
        "content/index": resolve(__dirname, "src/content/index.ts"),
      },

      output: {
        // Keep script paths predictable so manifest.json references work
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background/service-worker")
            return "background/service-worker.js"
          if (chunkInfo.name === "content/index") return "content/index.js"
          return "[name].js"
        },
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "styles/[name]-[hash].css"
          return "assets/[name]-[hash][extname]"
        },
      },
    },
  },

  // Silence chrome.* globals in type-checking (they come from @types/chrome)
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
})
