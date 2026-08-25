import { useEffect, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Database as DbIcon,
  Boxes,
  Table2,
  Eye,
  Layers,
  Hash,
  FunctionSquare,
  type LucideIcon,
} from "lucide-react";
import {
  fetchSchemas,
  fetchObjects,
  type SchemaInfo,
  type ObjectKind,
  type ApiError,
} from "@/lib/explorerApi";
import { useServerInfo } from "@/hooks/useServerInfo";
import { ErrorPanel } from "@/components/useQuery";
import { cn } from "@/lib/utils";

export interface SelectedObject {
  schema: string;
  name: string;
  kind: ObjectKind;
  object?: Record<string, unknown>;
}

interface ExplorerTreeProps {
  onSelect: (obj: SelectedObject) => void;
  selected: SelectedObject | null;
}

interface KindNode {
  kind: ObjectKind;
  label: string;
  icon: LucideIcon;
}

const KIND_NODES: KindNode[] = [
  { kind: "tables", label: "Tables", icon: Table2 },
  { kind: "views", label: "Views", icon: Eye },
  { kind: "matviews", label: "Materialized Views", icon: Layers },
  { kind: "sequences", label: "Sequences", icon: Hash },
  { kind: "functions", label: "Functions", icon: FunctionSquare },
  { kind: "types", label: "Types", icon: Boxes },
];

export function ExplorerTree({ onSelect, selected }: ExplorerTreeProps) {
  const info = useServerInfo();
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSystem, setShowSystem] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [objects, setObjects] = useState<Record<string, unknown[]>>({});
  const [loadingKinds, setLoadingKinds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    fetchSchemas().then((res) => {
      if (res.ok && res.data) {
        setSchemas(res.data.schemas || []);
        setError(null);
      } else {
        setError(res.error);
      }
      setLoading(false);
    });
  }, []);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandKind = (schema: string, kind: ObjectKind) => {
    const id = `t:${schema}:${kind}`;
    if (objects[id] || loadingKinds.has(id)) {
      toggle(id);
      return;
    }
    setLoadingKinds((prev) => new Set(prev).add(id));
    fetchObjects(kind, schema).then((res) => {
      setObjects((prev) => ({ ...prev, [id]: res.ok && res.data ? res.data.objects : [] }));
      setLoadingKinds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setExpanded((prev) => new Set(prev).add(id));
    });
  };

  const userSchemas = schemas.filter((s) => !s.is_internal);
  const systemSchemas = schemas.filter((s) => s.is_internal);

  const renderSchema = (s: SchemaInfo) => {
    const sid = `s:${s.name}`;
    const isOpen = expanded.has(sid);
    return (
      <div key={sid}>
        <TreeRow
          icon={DbIcon}
          label={s.name}
          sublabel={s.is_internal ? "system" : undefined}
          depth={1}
          active={false}
          expanded={isOpen}
          onToggle={() => toggle(sid)}
          muted={s.is_internal}
        />
        {isOpen && (
          <div>
            {KIND_NODES.map((kn) => {
              const kid = `t:${s.name}:${kn.kind}`;
              const kOpen = expanded.has(kid);
              const kLoading = loadingKinds.has(kid);
              const list = objects[kid];
              const count = list ? list.length : undefined;
              return (
                <div key={kid}>
                  <TreeRow
                    icon={kn.icon}
                    label={kn.label}
                    sublabel={count !== undefined ? String(count) : undefined}
                    depth={2}
                    active={false}
                    expanded={kOpen}
                    loading={kLoading}
                    onToggle={() => expandKind(s.name, kn.kind)}
                  />
                  {kOpen && list && (
                    <div>
                      {list.length === 0 ? (
                        <div className="py-1 pl-12 text-xs text-muted-foreground/70">— none —</div>
                      ) : (
                        list.map((obj) => {
                          const name = (obj as { name: string }).name;
                          const oid = `o:${s.name}:${kn.kind}:${name}`;
                          const isSel =
                            selected?.schema === s.name &&
                            selected?.name === name &&
                            selected?.kind === kn.kind;
                          return (
                            <TreeRow
                              key={oid}
                              icon={DotIcon}
                              label={name}
                              depth={3}
                              active={isSel}
                              expanded={false}
                              onToggle={() => onSelect({ schema: s.name, name, kind: kn.kind, object: obj as Record<string, unknown> })}
                              selectable
                            />
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Explorer</span>
        <button
          type="button"
          onClick={() => setShowSystem((v) => !v)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            showSystem ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
          )}
          title="Toggle system schemas"
        >
          {showSystem ? "Hide system" : "Show system"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1">
        {loading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Loading schemas…</div>
        ) : error ? (
          <div className="p-2"><ErrorPanel error={error} /></div>
        ) : (
          <>
            <TreeRow
              icon={DbIcon}
              label={info.database || "Database"}
              sublabel={info.connected ? "connected" : undefined}
              depth={0}
              active={false}
              expanded
              onToggle={() => {}}
            />
            {userSchemas.map(renderSchema)}
            {systemSchemas.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setShowSystem((v) => !v)}
                  className="flex w-full items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:bg-accent/60"
                >
                  {showSystem ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  <span>System schemas ({systemSchemas.length})</span>
                </button>
                {showSystem && systemSchemas.map(renderSchema)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface TreeRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sublabel?: string;
  depth: number;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  loading?: boolean;
  muted?: boolean;
  selectable?: boolean;
}

function TreeRow({ icon: Icon, label, sublabel, depth, active, expanded, onToggle, loading, muted, selectable }: TreeRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        muted && !active && "text-muted-foreground",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {loading ? (
        <ChevronRight className="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
      ) : selectable ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          <Icon className="size-2.5 text-muted-foreground" />
        </span>
      ) : (
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      )}
      {!selectable && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className={cn("truncate", selectable && "font-mono text-[13px]")}>{label}</span>
      {sublabel && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{sublabel}</span>}
    </button>
  );
}

function DotIcon({ className }: { className?: string }) {
  return <span className={cn("inline-block size-1.5 rounded-full bg-current", className)} />;
}