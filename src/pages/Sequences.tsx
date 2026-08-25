import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { SEQUENCES_QUERY } from "@/lib/pgQueries";

export default function Sequences() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(SEQUENCES_QUERY, schema);
  return (
    <MetadataPage
      title="Sequences"
      description={`Sequences in schema "${schema}".`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}