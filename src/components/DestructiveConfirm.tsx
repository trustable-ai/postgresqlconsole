import { AlertTriangle, X } from "lucide-react";
import type { Classification } from "@/lib/safety";

interface DestructiveConfirmProps {
  open: boolean;
  classification: Classification | null;
  sql: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DestructiveConfirm({ open, classification, sql, onConfirm, onCancel }: DestructiveConfirmProps) {
  if (!open || !classification) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-lg border border-destructive/40 bg-card shadow-lg">
        <div className="flex items-start gap-3 border-b border-border p-4">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-destructive">Destructive operation</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The statement is classified as <span className="font-mono font-semibold">{classification.label}</span>.
              This can cause data loss. Confirm only if you understand the consequences.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="Cancel"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4">
          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[12px] text-foreground">
{sql}
          </pre>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            I understand — run it
          </button>
        </div>
      </div>
    </div>
  );
}