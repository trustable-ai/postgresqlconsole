import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { TABLES_QUERY } from "@/lib/pgQueries";

export default function Tables() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(TABLES_QUERY, schema);
  return (
    <MetadataPage
      title="Tables"
      description={`Tables in schema "${schema}". Use the header selector to change schema.`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}