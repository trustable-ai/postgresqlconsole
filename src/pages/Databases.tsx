import { useSchema } from "@/lib/schema-context";
import { useSchemaQuery, MetadataPage } from "@/components/useQuery";
import { DATABASES_QUERY } from "@/lib/pgQueries";

export default function Databases() {
  const { schema } = useSchema();
  const { data, loading, error, refresh } = useSchemaQuery(() => DATABASES_QUERY, schema);
  return (
    <MetadataPage
      title="Databases"
      description="All databases on this PostgreSQL server."
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}