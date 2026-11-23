import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Key, Loader2, Maximize2, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import type { ConnectionProfile, ErDiagramResponse, ErTable } from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';

interface ErDiagramViewProps {
  connectionId: string;
  schema: string;
  connection: ConnectionProfile | undefined;
  onOpenTable: (table: string, type: 'table' | 'view') => void;
}

const BOX_WIDTH = 240;
const HEADER = 30;
const ROW = 20;
const MAX_ROWS = 14;
const GAP_X = 90;
const GAP_Y = 60;

interface Point {
  x: number;
  y: number;
}

const boxHeight = (table: ErTable) =>
  HEADER + Math.min(table.columns.length, MAX_ROWS) * ROW + (table.columns.length > MAX_ROWS ? ROW : 0) + 6;

/** Kolonun kutu içindeki dikey konumu (gizli kolonlar başlığa bağlanır). */
function columnOffset(table: ErTable, column: string | undefined): number {
  const index = column ? table.columns.findIndex((item) => item.name === column) : -1;
  return index >= 0 && index < MAX_ROWS ? HEADER + index * ROW + ROW / 2 : HEADER / 2;
}

/**
 * Başlangıç yerleşimi: ilişkili tablolar (bağlı bileşenler) yan yana gelecek
 * şekilde sıralanır, ardından ızgaraya dizilir.
 */
function initialLayout(data: ErDiagramResponse): Record<string, Point> {
  const neighbours = new Map<string, Set<string>>();

  for (const table of data.tables) neighbours.set(table.name, new Set());
  for (const key of data.relationships) {
    neighbours.get(key.table)?.add(key.referencedTable);
    neighbours.get(key.referencedTable)?.add(key.table);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  // En çok bağlantısı olan tablodan başlayarak BFS.
  const byDegree = [...data.tables].sort(
    (a, b) => (neighbours.get(b.name)?.size ?? 0) - (neighbours.get(a.name)?.size ?? 0),
  );

  for (const start of byDegree) {
    if (seen.has(start.name)) continue;

    const queue = [start.name];
    seen.add(start.name);

    while (queue.length) {
      const name = queue.shift()!;
      order.push(name);

      for (const next of neighbours.get(name) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }

  const byName = new Map(data.tables.map((table) => [table.name, table]));
  const perRow = Math.max(1, Math.ceil(Math.sqrt(order.length * 1.6)));
  const positions: Record<string, Point> = {};
  let y = 40;

  for (let start = 0; start < order.length; start += perRow) {
    const row = order.slice(start, start + perRow);
    let rowHeight = 0;

    row.forEach((name, column) => {
      positions[name] = { x: 40 + column * (BOX_WIDTH + GAP_X), y };
      rowHeight = Math.max(rowHeight, boxHeight(byName.get(name)!));
    });

    y += rowHeight + GAP_Y;
  }

  return positions;
}

function ToolButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1.5 hover:bg-(--c-292e39) hover:text-white disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export default function ErDiagramView({
  connectionId,
  schema,
  connection,
  onOpenTable,
}: ErDiagramViewProps) {
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: ErDiagramResponse | null;
    error: string | null;
  } | null>(null);
  const [positions, setPositions] = useState<{ key: string; value: Record<string, Point> } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [hovered, setHovered] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | { kind: 'pan'; start: Point; origin: Point }
    | { kind: 'box'; table: string; start: Point; origin: Point }
    | null
  >(null);

  const requestKey = `${connectionId}|${schema}|${reloadToken}`;

  useEffect(() => {
    let cancelled = false;

    connectionsApi
      .getErDiagram(connectionId, schema)
      .then(
        (data) => ({ data, error: null }),
        (loadError: unknown) => ({
          data: null,
          error: errorMessage(loadError, 'ER diagram could not be loaded.'),
        }),
      )
      .then((value) => {
        if (!cancelled) setResult({ key: requestKey, ...value });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey, connectionId, schema]);

  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;

  // Yerleşim veriye bağlıdır; veri değişince başlangıç yerleşimi kullanılır.
  const resultKey = result?.key;
  const layout = useMemo<Record<string, Point>>(() => {
    if (positions && positions.key === resultKey) return positions.value;
    return data ? initialLayout(data) : {};
  }, [positions, resultKey, data]);

  const tablesByName = useMemo(
    () => new Map((data?.tables ?? []).map((table) => [table.name, table])),
    [data],
  );

  const bounds = useMemo(() => {
    const boxes = (data?.tables ?? []).map((table) => ({
      ...layout[table.name],
      height: boxHeight(table),
    }));

    return {
      width: Math.max(800, ...boxes.map((box) => (box.x ?? 0) + BOX_WIDTH + 40)),
      height: Math.max(500, ...boxes.map((box) => (box.y ?? 0) + box.height + 40)),
    };
  }, [data, layout]);

  const toSvgPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const fit = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const zoom = Math.min(1.2, Math.max(0.2, Math.min(rect.width / bounds.width, rect.height / bounds.height)));
    setView({ x: (rect.width - bounds.width * zoom) / 2, y: 10, zoom });
  };

  const zoomBy = (factor: number) =>
    setView((current) => ({ ...current, zoom: Math.min(3, Math.max(0.2, current.zoom * factor)) }));

  const exportSvg = () => {
    if (!svgRef.current) return;

    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    clone.setAttribute('width', String(bounds.width));
    clone.setAttribute('height', String(bounds.height));
    clone.querySelector('g[data-viewport]')?.removeAttribute('transform');

    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${connection?.name ?? 'database'}-${schema}-er.svg`.replace(/[^\w.-]+/g, '_');
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onMouseMove = (event: React.MouseEvent) => {
    const current = drag.current;
    if (!current) return;

    const point = toSvgPoint(event);
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;

    if (current.kind === 'pan') {
      setView((value) => ({ ...value, x: current.origin.x + dx, y: current.origin.y + dy }));
    } else {
      setPositions({
        key: result?.key ?? '',
        value: {
          ...layout,
          [current.table]: {
            x: current.origin.x + dx / view.zoom,
            y: current.origin.y + dy / view.zoom,
          },
        },
      });
    }
  };

  const edges = (data?.relationships ?? []).flatMap((key) => {
    const from = tablesByName.get(key.table);
    const to = tablesByName.get(key.referencedTable);
    const fromPos = layout[key.table];
    const toPos = layout[key.referencedTable];

    if (!from || !to || !fromPos || !toPos) return [];

    const y1 = fromPos.y + columnOffset(from, key.columns[0]);
    const y2 = toPos.y + columnOffset(to, key.referencedColumns[0]);
    const selfReference = key.table === key.referencedTable;
    const fromRight = selfReference || fromPos.x + BOX_WIDTH / 2 <= toPos.x + BOX_WIDTH / 2;
    const x1 = fromRight ? fromPos.x + BOX_WIDTH : fromPos.x;
    const x2 = selfReference ? toPos.x + BOX_WIDTH : fromRight ? toPos.x : toPos.x + BOX_WIDTH;
    const bend = selfReference ? 50 : Math.max(40, Math.abs(x2 - x1) / 2);
    const c1 = fromRight ? x1 + bend : x1 - bend;
    const c2 = selfReference ? x2 + bend : fromRight ? x2 - bend : x2 + bend;

    return [
      {
        id: `${key.table}.${key.name}`,
        path: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`,
        end: { x: x2, y: y2, dir: selfReference ? 1 : fromRight ? -1 : 1 },
        active: hovered === key.table || hovered === key.referencedTable,
        label: `${key.table}(${key.columns.join(', ')}) → ${key.referencedTable}(${key.referencedColumns.join(', ')})`,
      },
    ];
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--c-111318)">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-(--c-292d36) bg-(--c-171a21) px-4">
        <div className="text-xs text-gray-400">
          <span className="font-semibold text-white">ER diagram</span> · {schema} ·{' '}
          {connection?.name ?? 'Unknown connection'}
          {data && (
            <span className="ml-3 text-gray-500">
              {data.tables.length} tables · {data.relationships.length} relationships
              {data.truncated && <span className="ml-2 text-amber-400">(limited to 150 tables)</span>}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 text-gray-400">
          <ToolButton title="Zoom in" disabled={!data} onClick={() => zoomBy(1.2)}>
            <ZoomIn size={14} />
          </ToolButton>
          <ToolButton title="Zoom out" disabled={!data} onClick={() => zoomBy(1 / 1.2)}>
            <ZoomOut size={14} />
          </ToolButton>
          <ToolButton title="Fit to screen" disabled={!data} onClick={fit}>
            <Maximize2 size={14} />
          </ToolButton>
          <ToolButton title="Reset layout" disabled={!data} onClick={() => setPositions(null)}>
            <RefreshCw size={14} />
          </ToolButton>
          <ToolButton title="Export SVG" disabled={!data} onClick={exportSvg}>
            <Download size={14} />
          </ToolButton>
          <button
            type="button"
            title="Reload from database"
            onClick={() => setReloadToken((token) => token + 1)}
            className="ml-2 rounded px-2 py-1 text-[11px] hover:bg-(--c-292e39) hover:text-white"
          >
            Reload
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Loading schema…
          </div>
        )}

        {!loading && result?.error && (
          <div className="flex h-40 items-center justify-center px-6 text-center text-xs text-red-400">
            {result.error}
          </div>
        )}

        {!loading && data && data.tables.length === 0 && (
          <div className="flex h-40 items-center justify-center text-xs text-gray-500">
            No tables in this schema.
          </div>
        )}

        {data && data.tables.length > 0 && (
          <svg
            ref={svgRef}
            role="img"
            aria-label={`ER diagram of ${schema}`}
            className="h-full w-full cursor-grab select-none active:cursor-grabbing"
            onMouseDown={(event) => {
              drag.current = {
                kind: 'pan',
                start: toSvgPoint(event),
                origin: { x: view.x, y: view.y },
              };
            }}
            onMouseMove={onMouseMove}
            onMouseUp={() => (drag.current = null)}
            onMouseLeave={() => (drag.current = null)}
            onWheel={(event) => zoomBy(event.deltaY < 0 ? 1.08 : 1 / 1.08)}
          >
            <defs>
              <marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-6b7280)" />
              </marker>
              <marker id="er-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-60a5fa)" />
              </marker>
            </defs>

            <rect width="100%" height="100%" fill="var(--c-111318)" />

            <g data-viewport transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              {edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  stroke={edge.active ? 'var(--c-60a5fa)' : 'var(--c-4b5563)'}
                  strokeWidth={edge.active ? 2 : 1.25}
                  markerEnd={`url(#${edge.active ? 'er-arrow-active' : 'er-arrow'})`}
                >
                  <title>{edge.label}</title>
                </path>
              ))}

              {data.tables.map((table) => {
                const position = layout[table.name];
                if (!position) return null;

                const height = boxHeight(table);
                const active = hovered === table.name;

                return (
                  <g
                    key={table.name}
                    transform={`translate(${position.x} ${position.y})`}
                    onMouseEnter={() => setHovered(table.name)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <rect
                      width={BOX_WIDTH}
                      height={height}
                      rx={6}
                      fill="var(--c-1a1e27)"
                      stroke={active ? 'var(--c-60a5fa)' : 'var(--c-343a46)'}
                      strokeWidth={active ? 1.5 : 1}
                    />
                    <rect
                      width={BOX_WIDTH}
                      height={HEADER}
                      rx={6}
                      fill={table.type === 'view' ? 'var(--c-2a2140)' : 'var(--c-1f2b3d)'}
                      className="cursor-move"
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        drag.current = {
                          kind: 'box',
                          table: table.name,
                          start: toSvgPoint(event),
                          origin: position,
                        };
                      }}
                      onDoubleClick={() => onOpenTable(table.name, table.type)}
                    >
                      <title>Drag to move · double-click to open</title>
                    </rect>
                    <text
                      x={12}
                      y={19}
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--c-f3f4f6)"
                      pointerEvents="none"
                    >
                      {table.name.length > 28 ? `${table.name.slice(0, 27)}…` : table.name}
                    </text>
                    {table.type === 'view' && (
                      <text x={BOX_WIDTH - 12} y={19} fontSize={9} fill="var(--c-a78bfa)" textAnchor="end" pointerEvents="none">
                        VIEW
                      </text>
                    )}

                    {table.columns.slice(0, MAX_ROWS).map((column, index) => (
                      <g key={column.name} transform={`translate(0 ${HEADER + index * ROW})`}>
                        {column.isPrimaryKey && (
                          <Key x={10} y={5} width={10} height={10} color="var(--c-fbbf24)" />
                        )}
                        <text
                          x={26}
                          y={14}
                          fontSize={11}
                          fill={column.isForeignKey ? 'var(--c-c4b5fd)' : column.isPrimaryKey ? 'var(--c-fde68a)' : 'var(--c-d1d5db)'}
                        >
                          {column.name.length > 20 ? `${column.name.slice(0, 19)}…` : column.name}
                        </text>
                        <text x={BOX_WIDTH - 10} y={14} fontSize={10} fill="var(--c-6b7280)" textAnchor="end">
                          {column.dataType.length > 14 ? `${column.dataType.slice(0, 13)}…` : column.dataType}
                        </text>
                      </g>
                    ))}

                    {table.columns.length > MAX_ROWS && (
                      <text x={26} y={HEADER + MAX_ROWS * ROW + 14} fontSize={10} fill="var(--c-6b7280)">
                        … {table.columns.length - MAX_ROWS} more columns
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
