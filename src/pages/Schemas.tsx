import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { SCHEMAS_QUERY } from "@/lib/pgQueries";

export default function Schemas() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(() => SCHEMAS_QUERY, schema);
  return (
    <MetadataPage
      title="Schemas"
      description="All non-system schemas in this database."
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}