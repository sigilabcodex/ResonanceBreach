import type { SimulationDiagnostics } from '../../../types/world';

export const buildHotspotSummary = (diagnostics: SimulationDiagnostics): string[] => {
  const speciesEntries = Object.entries(diagnostics.speciesUpdateTimeMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([type, timeMs]) => `${type} ${timeMs.toFixed(2)} ms`);

  const querySummary = [
    `field ${diagnostics.queryCounts.terrainSamples}`,
    `neighbors ${diagnostics.queryCounts.neighbors}`,
    `food ${diagnostics.queryCounts.foodSearches}`,
    `residue ${diagnostics.queryCounts.residueSearches}`,
  ]
    .sort((a, b) => Number(b.split(' ')[1]) - Number(a.split(' ')[1]))
    .slice(0, 2);

  return [...speciesEntries, ...querySummary];
};
