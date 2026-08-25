import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { INDEXES_QUERY } from "@/lib/pgQueries";

export default function Indexes() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(INDEXES_QUERY, schema);
  return (
    <MetadataPage
      title="Indexes"
      description={`Indexes in schema "${schema}".`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}