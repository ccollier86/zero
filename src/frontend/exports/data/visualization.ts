/** Vector visualization and chart facades. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── SDK Core (vanilla JS — no React required) ──────────────────────────
export type * from '../../../vector/visualization-types';
export { createVectorVisualizationClient, parseVectorVisualizationSnapshot, parseVectorVisualizationMap } from '../../client/vector-visualization-client';
export type { VectorVisualizationClientOptions } from '../../client/vector-visualization-client';
export { VectorVisualizationController } from '../../client/vector-visualization-controller';
export type { VectorVisualizationObservation } from '../../client/vector-visualization-controller';
export { createVectorVisualizationStory } from '../../client/vector-visualization-story';
export type { VectorVisualizationStory, VectorVisualizationStoryFrame } from '../../client/vector-visualization-story';
export { useVectorVisualization, useVectorOperation } from '../../client/vector-visualization-hooks';
export type { UseVectorVisualizationOptions } from '../../client/vector-visualization-hooks';
export * from '../../../components/vector-visualization';
export * from '../../../components/charts';
export { useChartQuery, projectChartQueryRows, ChartQueryError, CHART_QUERY_DEFAULT_MAX_ROWS, CHART_QUERY_MAX_ROWS } from '../../client/chart-query';
export type { ChartQueryOptions, ChartQueryResult, ChartQueryProjection, ChartQueryProjectionResult, ChartQueryErrorCode } from '../../client/chart-query';
