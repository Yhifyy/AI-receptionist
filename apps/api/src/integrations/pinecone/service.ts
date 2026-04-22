import { logger } from '../../shared/logger.js';

interface PineconeVector {
  id: string;
  values: number[];
  metadata: Record<string, any>;
}

interface QueryResult {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

export class PineconeService {
  private apiKey: string;
  private environment: string;
  private indexName: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.PINECONE_API_KEY || '';
    this.environment = process.env.PINECONE_ENVIRONMENT || '';
    this.indexName = process.env.PINECONE_INDEX || 'voicedesk-memory';
    this.baseUrl = `https://${this.indexName}-${this.environment}.svc.pinecone.io`;
  }

  async upsert(vector: PineconeVector): Promise<void> {
    if (!this.apiKey) {
      logger.warn('Pinecone not configured, skipping upsert');
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/vectors/upsert`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors: [vector],
          namespace: vector.metadata.tenantId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Pinecone upsert failed: ${response.statusText}`);
      }

      logger.debug({ vectorId: vector.id }, 'Vector upserted');
    } catch (error) {
      logger.error({ error }, 'Pinecone upsert failed');
      throw error;
    }
  }

  async upsertBatch(vectors: PineconeVector[], namespace: string): Promise<void> {
    if (!this.apiKey) {
      logger.warn('Pinecone not configured, skipping batch upsert');
      return;
    }

    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);

      const response = await fetch(`${this.baseUrl}/vectors/upsert`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vectors: batch,
          namespace,
        }),
      });

      if (!response.ok) {
        throw new Error(`Pinecone batch upsert failed: ${response.statusText}`);
      }
    }

    logger.info({ count: vectors.length, namespace }, 'Vectors batch upserted');
  }

  async query(options: {
    vector: number[];
    filter?: Record<string, any>;
    topK?: number;
    namespace?: string;
  }): Promise<QueryResult[]> {
    if (!this.apiKey) {
      logger.warn('Pinecone not configured, returning empty results');
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/query`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vector: options.vector,
          filter: options.filter,
          topK: options.topK || 10,
          includeMetadata: true,
          namespace: options.namespace || options.filter?.tenantId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Pinecone query failed: ${response.statusText}`);
      }

      const data = (await response.json()) as { matches?: QueryResult[] };
      return data.matches || [];
    } catch (error) {
      logger.error({ error }, 'Pinecone query failed');
      return [];
    }
  }

  async deleteByFilter(
    filter: Record<string, any>,
    namespace: string
  ): Promise<void> {
    if (!this.apiKey) return;

    try {
      await fetch(`${this.baseUrl}/vectors/delete`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter,
          namespace,
        }),
      });

      logger.debug({ filter, namespace }, 'Vectors deleted');
    } catch (error) {
      logger.error({ error }, 'Pinecone delete failed');
    }
  }

  async deleteNamespace(namespace: string): Promise<void> {
    if (!this.apiKey) return;

    try {
      await fetch(`${this.baseUrl}/vectors/delete`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deleteAll: true,
          namespace,
        }),
      });

      logger.info({ namespace }, 'Namespace deleted');
    } catch (error) {
      logger.error({ error }, 'Pinecone namespace delete failed');
    }
  }

  async getStats(): Promise<{
    namespaces: Record<string, { vectorCount: number }>;
    totalVectors: number;
  }> {
    if (!this.apiKey) {
      return { namespaces: {}, totalVectors: 0 };
    }

    try {
      const response = await fetch(`${this.baseUrl}/describe_index_stats`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Pinecone stats failed: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        namespaces?: Record<string, { vectorCount: number }>;
        totalVectorCount?: number;
      };
      return {
        namespaces: data.namespaces || {},
        totalVectors: data.totalVectorCount || 0,
      };
    } catch (error) {
      logger.error({ error }, 'Pinecone stats failed');
      return { namespaces: {}, totalVectors: 0 };
    }
  }
}
