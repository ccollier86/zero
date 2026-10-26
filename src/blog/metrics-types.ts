/** Optional aggregate article observations. These are not unique-human analytics, audit evidence or proof of attention. */
export interface BlogMetricObservation { kind: 'view' | 'engagement'; observedAt: number; visibleMs: number }
export interface BlogMetricTicket { ticket: string; expiresAt: number }
export interface BlogMetricDay { postId: string; day: string; views: number; engagements: number; visibleMs: number }
export interface BlogMetricsQuery { postId?: string; since?: string; until?: string; limit?: number; offset?: number }
export interface BlogMetricsPage { items: readonly BlogMetricDay[]; total: number; limit: number; offset: number; hasMore: boolean }
export interface BlogMetricsApi {
  capabilities(): Promise<{ enabled: boolean; retentionDays: number }>;
  page(query?: BlogMetricsQuery, options?: { signal?: AbortSignal }): Promise<BlogMetricsPage>;
}
