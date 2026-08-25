import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { VIEWS_QUERY } from "@/lib/pgQueries";

export default function Views() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(VIEWS_QUERY, schema);
  return (
    <MetadataPage
      title="Views"
      description={`Views in schema "${schema}".`}
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}