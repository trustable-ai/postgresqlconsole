import { createContext, useContext, useState, type ReactNode } from "react";

interface SchemaContextValue {
  schema: string;
  setSchema: (s: string) => void;
}

const SchemaContext = createContext<SchemaContextValue | undefined>(undefined);

export function SchemaProvider({ children }: { children: ReactNode }) {
  const [schema, setSchema] = useState<string>("public");
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