import { useEffect, useState } from "react";
import { runQuery, type ApiError } from "@/lib/api";
import { SCHEMAS_QUERY } from "@/lib/pgQueries";

export function useSchemas() {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    runQuery({ sql: SCHEMAS_QUERY })
      .then((res) => {
        if (cancelled || !res.ok || !res.data) return;
        const colName = res.data.columns[0]?.name;
        const names = (res.data.rows ?? [])
          .map((row) => (colName ? row[colName] : undefined))
          .filter((n): n is string => typeof n === "string");
        setSchemas(names);
      })
      .catch((_e: ApiError) => {
        /* keep empty list on error */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { schemas, loading, refresh: () => setNonce((n) => n + 1) };
}