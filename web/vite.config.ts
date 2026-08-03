import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({ plugins: [react(), viteSingleFile()], test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", css: true } });
