// Local Monaco Editor setup: bundle monaco-editor and run the editor worker
// locally (no CDN), so the console works without external network access.
import * as monaco from "monaco-editor";
import type { Environment } from "monaco-editor";
import { loader } from "@monaco-editor/react";

let configured = false;

export function configureMonaco(): void {
  if (configured) return;
  configured = true;

  const env: Environment = {
    getWorker() {
      // Vite/Rolldown native worker pattern: resolve the worker entry relative
      // to this module so it is bundled (not loaded from a CDN).
      return new Worker(
        new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
        { type: "module" },
      );
    },
  };
  (window as unknown as { MonacoEnvironment?: Environment }).MonacoEnvironment = env;

  loader.config({ monaco });
}

export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}