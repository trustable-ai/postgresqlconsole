import { useEffect, useState } from "react";
import { fetchHealth, type ApiError, type HealthData } from "@/lib/api";

export interface ServerInfo {
  connected: boolean;
  version?: string;
  database?: string;
  user?: string;
  statementTimeoutMs?: number;
  error?: ApiError | null;
  loading: boolean;
}

export function useServerInfo(): ServerInfo & { refresh: () => void } {
  const [info, setInfo] = useState<ServerInfo>({ connected: false, loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setInfo((prev) => ({ ...prev, loading: true }));
    fetchHealth()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setInfo({ connected: false, loading: false, error: res.error });
          return;
        }
        const d: HealthData = res.data;
        setInfo({
          connected: d.connected,
          loading: false,
          version: d.serverVersion,
          database: d.database,
          user: d.currentUser,
          statementTimeoutMs: d.statementTimeoutMs,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setInfo({
          connected: false,
          loading: false,
          error: { type: "NetworkError", message: "Health request failed" },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...info, refresh: () => setNonce((n) => n + 1) };
}