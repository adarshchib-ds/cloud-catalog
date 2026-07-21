import React, { useState, useEffect } from 'react';

export interface MatrixRow {
  id: string;
  instanceType: string;
  displayName: string;
  vcpu: number;
  memoryGib: number;
  networkPerformance: string;
  storageSummary: string;
  onDemandHourlyCost: string;
  potentialHourlyCost: string;
  savingsPercent: number;
}

export interface RecommendationResponse {
  autoSuggestedFamily: string;
  matrixRows: MatrixRow[];
}

interface RecommendedInstancesTableProps {
  reqVcpu: number;
  reqMemoryGib: number;
  workloadType: 'IN_MEMORY_DB' | 'HEAVY_COMPUTE' | 'GENERAL_PURPOSE';
  processorPreference: 'INTEL' | 'AMD' | 'AWS_GRAVITON';
}

export const RecommendedInstancesTable: React.FC<RecommendedInstancesTableProps> = ({
  reqVcpu,
  reqMemoryGib,
  workloadType,
  processorPreference,
}) => {
  const [data, setData] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRecommendations = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/v1/instances/recommend', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reqVcpu,
            reqMemoryGib,
            workloadType,
            processorPreference,
          }),
        });

        const json = await response.json();
        if (json.success && json.data) {
          setData(json.data);
        } else {
          setError(json.error?.message || 'Failed to fetch recommendations');
        }
      } catch (err: any) {
        setError(err.message || 'An error occurred while connecting to the engine.');
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [reqVcpu, reqMemoryGib, workloadType, processorPreference]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-zinc-900 border border-zinc-800 rounded-lg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-2"></div>
        <p className="text-sm text-zinc-400">Resolving optimized capabilities matrix...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-lg text-red-400 text-sm">
        <h4 className="font-semibold mb-1">Recommendation Engine Error</h4>
        <p>{error}</p>
      </div>
    );
  }

  if (!data || data.matrixRows.length === 0) {
    return (
      <div className="p-8 text-center bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-500">
        No configurations found matching the minimum criteria.
      </div>
    );
  }

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden shadow-2xl font-sans text-zinc-200">
      {/* Header and Smart Intent Matching Badge */}
      <div className="p-5 border-b border-zinc-800 bg-zinc-900/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            <span>🚀 Smart Recommendation Matrix</span>
            <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full text-xs font-semibold">
              Intent Optimized
            </span>
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Comparing size options in the resolved optimal instance category.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-zinc-800/80 px-3 py-1.5 rounded-md border border-zinc-700/50 self-start sm:self-auto">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">Suggested Family:</span>
          <span className="text-xs font-semibold text-indigo-400 font-mono">{data.autoSuggestedFamily}</span>
        </div>
      </div>

      {/* EC2 Console Style Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 font-semibold uppercase tracking-wider">
              <th className="py-3 px-4">Instance Name</th>
              <th className="py-3 px-4">vCPUs</th>
              <th className="py-3 px-4">Memory</th>
              <th className="py-3 px-4">Network Performance</th>
              <th className="py-3 px-4">Storage</th>
              <th className="py-3 px-4 text-right">On-Demand Cost</th>
              <th className="py-3 px-4 text-right">Potential Cost</th>
              <th className="py-3 px-4 text-right">Est. Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {data.matrixRows.map((row) => (
              <tr key={row.id} className="hover:bg-zinc-900/30 transition-colors">
                <td className="py-3.5 px-4 font-mono font-medium text-white">{row.instanceType}</td>
                <td className="py-3.5 px-4 font-mono">{row.vcpu} vCPUs</td>
                <td className="py-3.5 px-4 font-mono">{row.memoryGib} GiB</td>
                <td className="py-3.5 px-4 text-zinc-300">{row.networkPerformance}</td>
                <td className="py-3.5 px-4 text-zinc-300">{row.storageSummary}</td>
                <td className="py-3.5 px-4 text-right font-mono text-zinc-300">${row.onDemandHourlyCost}/hr</td>
                <td className="py-3.5 px-4 text-right font-mono text-zinc-100">${row.potentialHourlyCost}/hr</td>
                <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold bg-emerald-500/5">
                  -{row.savingsPercent}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
