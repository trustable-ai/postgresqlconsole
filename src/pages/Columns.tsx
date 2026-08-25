import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { COLUMNS_QUERY } from "@/lib/pgQueries";

export default function Columns() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(COLUMNS_QUERY, schema);
  return (
    <MetadataPage
      title="Columns"
      description={`All columns in tables and views of schema "${schema}".`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}