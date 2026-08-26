import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { runQuery } from "@/lib/api";

interface SchemaContextValue {
  schema: string;
  setSchema: (s: string) => void;
}

const SchemaContext = createContext<SchemaContextValue | undefined>(undefined);

export function SchemaProvider({ children }: { children: ReactNode }) {
  // Start from "public" so the UI can render immediately, then resolve the
  // database's actual default schema (current_schema()) on mount. The user's
  // objects live in their default schema (e.g. "<user>_schema"), not in
  // public, so defaulting to public left every section page (Tables…Functions)
  // empty. A manual selection via the header selector is never overridden.
  const [schema, setSchemaState] = useState<string>("public");
  const userTouched = useRef(false);

  const setSchema = (s: string) => {
    userTouched.current = true;
    setSchemaState(s);
  };

  useEffect(() => {
    let cancelled = false;
    runQuery({ sql: "SELECT current_schema() AS s" })
      .then((res) => {
        if (cancelled || userTouched.current) return;
        const row = res.ok && res.data && res.data.rows.length > 0 ? res.data.rows[0] : null;
        const s = row ? String((row as Record<string, unknown>).s ?? "") : "";
        if (s) setSchemaState(s);
      })
      .catch(() => {
        /* keep "public" when the backend is unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SchemaContext.Provider value={{ schema, setSchema }}>
      {children}
    </SchemaContext.Provider>
  );
}

export function useSchema(): SchemaContextValue {
  const ctx = useContext(SchemaContext);
  if (!ctx) {
    throw new Error("useSchema must be used within a SchemaProvider");
  }
  return ctx;
}