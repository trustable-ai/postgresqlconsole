// SQL formatting helper backed by sql-formatter (PostgreSQL dialect).
import { format } from "sql-formatter";

export function formatSQL(sql: string): string {
  if (!sql || !sql.trim()) return sql;
  try {
    return format(sql, {
      language: "postgresql",
      tabWidth: 2,
      keywordCase: "upper",
      linesBetweenQueries: 2,
    });
  } catch {
    // If the formatter cannot parse the input, return it unchanged.
    return sql;
  }
}