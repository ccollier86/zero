/**
 * vector-ai-bridge.ts
 *
 * Convenience composition between Zero AI embeddings and vector storage. This
 * file owns orchestration only; AIService still generates embeddings and
 * VectorService still owns persistence/search.
 */

import type { AIEmbedRequest, AIService } from '../ai';
import type { VectorService, VectorScope } from './vector-service';
import type {
  StoredVectorRecord,
  VectorFilter,
  VectorMetadata,
  VectorQueryOptions,
  VectorRecord,
  VectorWriteResult,
} from './vector-types';

/** Options for creating an AI/vector bridge. */
export interface AIVectorBridgeOptions {
  ai: AIService;
  vectors: VectorService;
  embeddingModel?: string;
}

/** Input accepted by bridge upsert helpers. */
export interface AIVectorRecordInput {
  id: string;
  text: string;
  metadata?: VectorMetadata;
  model?: string;
  providerOptions?: AIEmbedRequest['providerOptions'];
}

/** Text query accepted by bridge search helpers. */
export interface AIVectorTextQuery extends Omit<VectorQueryOptions, 'vector'> {
  text: string;
  model?: string;
  providerOptions?: AIEmbedRequest['providerOptions'];
}

/** Small helper API for embedding text before vector writes/searches. */
export interface AIVectorBridge {
  embedText(text: string, options?: Omit<AIEmbedRequest, 'value'>): Promise<number[]>;
  embedAndUpsert(index: string, record: AIVectorRecordInput): Promise<VectorWriteResult>;
  embedAndUpsertMany(index: string, records: readonly AIVectorRecordInput[]): Promise<VectorWriteResult>;
  embedAndQuery(index: string, query: AIVectorTextQuery): Promise<StoredVectorRecord[]>;
  scope(index: string, filter: VectorFilter): ScopedAIVectorBridge;
}

/** Scope-bound AI/vector helper. */
export interface ScopedAIVectorBridge {
  embedAndUpsert(record: AIVectorRecordInput): Promise<VectorWriteResult>;
  embedAndUpsertMany(records: readonly AIVectorRecordInput[]): Promise<VectorWriteResult>;
  embedAndQuery(query: AIVectorTextQuery): Promise<StoredVectorRecord[]>;
}

/** Create a bridge between configured AI embeddings and vector storage. */
export function createAIVectorBridge(options: AIVectorBridgeOptions): AIVectorBridge {
  return new DefaultAIVectorBridge(options.ai, options.vectors, options.embeddingModel);
}

class DefaultAIVectorBridge implements AIVectorBridge {
  constructor(
    private readonly ai: AIService,
    private readonly vectors: VectorService,
    private readonly embeddingModel?: string
  ) {}

  async embedText(text: string, options: Omit<AIEmbedRequest, 'value'> = {}): Promise<number[]> {
    const result = await this.ai.embed({
      ...options,
      model: options.model ?? this.embeddingModel,
      value: text,
    });
    return result.embedding;
  }

  async embedAndUpsert(index: string, record: AIVectorRecordInput): Promise<VectorWriteResult> {
    return this.embedAndUpsertMany(index, [record]);
  }

  async embedAndUpsertMany(index: string, records: readonly AIVectorRecordInput[]): Promise<VectorWriteResult> {
    const vectorRecords: VectorRecord[] = [];
    for (const record of records) {
      vectorRecords.push({
        id: record.id,
        text: record.text,
        metadata: record.metadata,
        vector: await this.embedText(record.text, {
          model: record.model,
          providerOptions: record.providerOptions,
          metadata: { index, recordId: record.id },
        }),
      });
    }
    return this.vectors.upsert(index, vectorRecords);
  }

  async embedAndQuery(index: string, query: AIVectorTextQuery): Promise<StoredVectorRecord[]> {
    const vector = await this.embedText(query.text, {
      model: query.model,
      providerOptions: query.providerOptions,
      metadata: { index, operation: 'vector_query' },
    });
    return this.vectors.query(index, {
      ...query,
      vector,
    });
  }

  scope(index: string, filter: VectorFilter): ScopedAIVectorBridge {
    return new DefaultScopedAIVectorBridge(this, this.vectors.scope(index, filter));
  }
}

class DefaultScopedAIVectorBridge implements ScopedAIVectorBridge {
  constructor(
    private readonly bridge: DefaultAIVectorBridge,
    private readonly scope: VectorScope
  ) {}

  async embedAndUpsert(record: AIVectorRecordInput): Promise<VectorWriteResult> {
    return this.embedAndUpsertMany([record]);
  }

  async embedAndUpsertMany(records: readonly AIVectorRecordInput[]): Promise<VectorWriteResult> {
    const vectorRecords: VectorRecord[] = [];
    for (const record of records) {
      vectorRecords.push({
        id: record.id,
        text: record.text,
        metadata: record.metadata,
        vector: await this.bridge.embedText(record.text, {
          model: record.model,
          providerOptions: record.providerOptions,
          metadata: { recordId: record.id },
        }),
      });
    }
    return this.scope.upsert(vectorRecords);
  }

  async embedAndQuery(query: AIVectorTextQuery): Promise<StoredVectorRecord[]> {
    const vector = await this.bridge.embedText(query.text, {
      model: query.model,
      providerOptions: query.providerOptions,
      metadata: { operation: 'vector_scope_query' },
    });
    return this.scope.query({
      ...query,
      vector,
    });
  }
}
