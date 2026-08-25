import { useFixedQuery, MetadataPage } from "@/components/useQuery";
import { ACTIVITY_QUERY } from "@/lib/pgQueries";

export default function Activity() {
  const { data, loading, error, refresh } = useFixedQuery(ACTIVITY_QUERY);
  return (
    <MetadataPage
      title="Activity"
      description="Live backend processes from pg_stat_activity (up to 50 rows)."
      loading={loading}
      error={error}
      data={data}
      onRefresh={refresh}
    />
  );
}