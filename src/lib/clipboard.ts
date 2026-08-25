// Clipboard helper with toast feedback (sonner is already wired in App.tsx).
import { toast } from "sonner";

export async function copyText(text: string, label = "Copied to clipboard"): Promise<void> {
  if (text === "") {
    toast.message("Nothing to copy");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error("Copy failed — clipboard unavailable");
  }
}