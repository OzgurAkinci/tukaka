import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ExplainPlanNode, ExplainResponse } from '@tukaka/contracts';

interface ExplainPlanViewProps {
  plan: ExplainResponse;
}

function maxCost(nodes: ExplainPlanNode[]): number {
  return nodes.reduce(
    (max, node) => Math.max(max, node.cost ?? 0, maxCost(node.children)),
    0,
  );
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return value >= 1000 ? Math.round(value).toLocaleString() : String(Math.round(value * 100) / 100);
}

function PlanRow({
  node,
  depth,
  highestCost,
}: {
  node: ExplainPlanNode;
  depth: number;
  highestCost: number;
}) {
  const [open, setOpen] = useState(true);
  const share = highestCost > 0 && node.cost !== null ? node.cost / highestCost : 0;

  // Maliyet payına göre renk: yeşil → sarı → kırmızı.
  const barColor = share > 0.66 ? 'bg-red-500/60' : share > 0.33 ? 'bg-amber-500/60' : 'bg-emerald-500/50';

  return (
    <>
      <tr className="hover:bg-(--c-202530)">
        <td className="border-b border-(--c-252a33) py-2 pr-4">
          <div className="flex items-start gap-1.5" style={{ paddingLeft: depth * 18 + 12 }}>
            {node.children.length > 0 ? (
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="mt-0.5 text-gray-500 hover:text-white"
                title={open ? 'Collapse' : 'Expand'}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <span className="w-3" />
            )}
            <div className="min-w-0">
              <div className="text-xs text-gray-100">{node.label}</div>
              {node.detail && (
                <div className="mt-0.5 break-all font-mono text-[10px] text-gray-500">
                  {node.detail}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="w-48 border-b border-(--c-252a33) py-2 pr-4">
          {node.cost !== null && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-(--c-252a33)">
                <div
                  className={`h-1.5 rounded-full ${barColor}`}
                  style={{ width: `${Math.max(2, share * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-[11px] tabular-nums text-gray-400">
                {formatNumber(node.cost)}
              </span>
            </div>
          )}
        </td>
        <td className="w-24 border-b border-(--c-252a33) py-2 pr-4 text-right text-[11px] tabular-nums text-gray-400">
          {formatNumber(node.rows)}
        </td>
      </tr>

      {open &&
        node.children.map((child) => (
          <PlanRow key={child.id} node={child} depth={depth + 1} highestCost={highestCost} />
        ))}
    </>
  );
}

export default function ExplainPlanView({ plan }: ExplainPlanViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const highestCost = maxCost(plan.nodes);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-(--c-292d36) px-4 text-[10px] text-gray-500">
        <span>Estimated plan · the query was not executed</span>
        <button
          type="button"
          onClick={() => setShowRaw((value) => !value)}
          className="hover:text-white"
        >
          {showRaw ? 'Show tree' : 'Show raw output'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {showRaw ? (
          <pre className="p-4 font-mono text-[11px] leading-relaxed text-gray-300 whitespace-pre">
            {plan.raw}
          </pre>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-(--c-1b1f28) text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 pl-4 font-medium">Operation</th>
                <th className="py-2 pr-4 font-medium">Cost</th>
                <th className="py-2 pr-4 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {plan.nodes.map((node) => (
                <PlanRow key={node.id} node={node} depth={0} highestCost={highestCost} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
