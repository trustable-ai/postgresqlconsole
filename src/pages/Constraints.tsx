import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { CONSTRAINTS_QUERY } from "@/lib/pgQueries";

export default function Constraints() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(CONSTRAINTS_QUERY, schema);
  return (
    <MetadataPage
      title="Constraints"
      description={`Primary, unique, foreign and check constraints in schema "${schema}".`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}