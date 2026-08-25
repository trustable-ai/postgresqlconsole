import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { FUNCTIONS_QUERY } from "@/lib/pgQueries";

export default function Functions() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(FUNCTIONS_QUERY, schema);
  return (
    <MetadataPage
      title="Functions"
      description={`Functions and procedures in schema "${schema}".`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}