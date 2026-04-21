import { prisma } from '@voicedesk/database';
import type { CustomerContext, CallSummary } from '@voicedesk/shared-types';
import { openaiService } from '../../integrations/openai/service.js';
import { PineconeService } from '../../integrations/pinecone/service.js';
import { getRedisClient } from '../../shared/redis.js';
import { logger } from '../../shared/logger.js';

export class MemoryService {
  private tenantId: string;
  private pinecone: PineconeService;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.pinecone = new PineconeService();
  }

  async loadCustomerContext(phone: string): Promise<CustomerContext | null> {
    // Check Redis cache first
    const redis = getRedisClient();
    const cacheKey = `customer:${this.tenantId}:${phone}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      logger.debug({ phone }, 'Customer loaded from cache');
      return JSON.parse(cached);
    }

    // Load from database
    const customer = await prisma.customer.findFirst({
      where: { tenantId: this.tenantId, phone },
      include: {
        calls: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            createdAt: true,
            summary: true,
            outcome: true,
            sentiment: true,
          },
        },
      },
    });

    if (!customer) {
      return null;
    }

    const context: CustomerContext = {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      isVip: customer.isVip,
      preferences: customer.preferences as Record<string, any>,
      previousCalls: customer.calls.map(c => ({
        id: c.id,
        date: c.createdAt.toISOString(),
        summary: c.summary || '',
        outcome: c.outcome || '',
        sentiment: c.sentiment || 0,
      })),
      lifetimeValue: Number(customer.lifetimeValue),
    };

    // Cache for 30 minutes
    await redis.setex(cacheKey, 1800, JSON.stringify(context));

    return context;
  }

  async updateCustomerPreferences(
    customerId: string,
    preferences: Record<string, any>
  ): Promise<void> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { preferences: true },
    });

    const existingPrefs = (customer?.preferences as Record<string, any>) || {};
    const mergedPrefs = { ...existingPrefs, ...preferences };

    await prisma.customer.update({
      where: { id: customerId },
      data: { preferences: mergedPrefs },
    });

    // Invalidate cache
    const phone = (await prisma.customer.findUnique({
      where: { id: customerId },
      select: { phone: true },
    }))?.phone;

    if (phone) {
      const redis = getRedisClient();
      await redis.del(`customer:${this.tenantId}:${phone}`);
    }

    logger.info({ customerId }, 'Customer preferences updated');
  }

  async saveCallMemory(
    customerId: string,
    callId: string,
    transcript: Array<{ role: string; content: string }>,
    outcome: string
  ): Promise<void> {
    // Generate summary using LLM
    const summary = await openaiService.generateSummary(transcript);

    // Update call record
    await prisma.call.update({
      where: { id: callId },
      data: { summary },
    });

    // Extract key information for long-term memory
    const keyInfo = await this.extractKeyInformation(transcript, summary);

    // Store in Pinecone for semantic retrieval
    for (const info of keyInfo) {
      const embedding = await openaiService.generateEmbedding(info.content);
      
      await this.pinecone.upsert({
        id: `${customerId}-${callId}-${Date.now()}`,
        values: embedding,
        metadata: {
          tenantId: this.tenantId,
          customerId,
          callId,
          type: info.type,
          content: info.content,
          timestamp: Date.now(),
        },
      });

      // Also store in PostgreSQL for reference
      await prisma.customerMemory.create({
        data: {
          customerId,
          content: info.content,
          type: info.type,
          importance: info.importance,
        },
      });
    }

    // Update customer metrics
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        callCount: { increment: 1 },
        lastCallAt: new Date(),
      },
    });

    logger.info({ customerId, callId, memoryCount: keyInfo.length }, 'Call memory saved');
  }

  async retrieveRelevantMemories(
    customerId: string,
    currentContext: string,
    limit: number = 5
  ): Promise<Array<{ content: string; type: string; relevance: number }>> {
    const embedding = await openaiService.generateEmbedding(currentContext);

    const results = await this.pinecone.query({
      vector: embedding,
      filter: {
        tenantId: this.tenantId,
        customerId,
      },
      topK: limit,
    });

    return results.map(r => ({
      content: r.metadata.content,
      type: r.metadata.type,
      relevance: r.score,
    }));
  }

  private async extractKeyInformation(
    transcript: Array<{ role: string; content: string }>,
    summary: string
  ): Promise<Array<{ type: string; content: string; importance: number }>> {
    const conversationText = transcript
      .map(t => `${t.role}: ${t.content}`)
      .join('\n');

    const response = await openaiService.chat(
      [{
        role: 'user',
        content: `Extract key customer preferences and information from this conversation that would be useful to remember for future calls.

Conversation:
${conversationText}

Summary: ${summary}

Return as JSON array:
[
  {
    "type": "preference|feedback|request|behavior",
    "content": "specific information",
    "importance": 0.0-1.0
  }
]

Focus on:
- Dietary preferences/allergies
- Seating preferences
- Favorite dishes
- Special occasions mentioned
- Communication style preferences
- Any complaints or feedback`,
      }],
      { temperature: 0.3, maxTokens: 500 }
    );

    try {
      return JSON.parse(response.text);
    } catch {
      return [];
    }
  }

  async getPersonalizationContext(customerId: string): Promise<string> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        calls: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { summary: true, outcome: true },
        },
        memoryEmbeddings: {
          orderBy: { importance: 'desc' },
          take: 5,
          select: { content: true, type: true },
        },
      },
    });

    if (!customer) {
      return '';
    }

    const parts: string[] = [];

    // Add preferences
    const prefs = customer.preferences as Record<string, any>;
    if (prefs && Object.keys(prefs).length > 0) {
      parts.push(`Known preferences: ${JSON.stringify(prefs)}`);
    }

    // Add recent memories
    if (customer.memoryEmbeddings.length > 0) {
      const memories = customer.memoryEmbeddings
        .map(m => `- ${m.type}: ${m.content}`)
        .join('\n');
      parts.push(`Recent notes:\n${memories}`);
    }

    // Add recent call summaries
    if (customer.calls.length > 0) {
      const summaries = customer.calls
        .filter(c => c.summary)
        .map(c => c.summary)
        .join('; ');
      if (summaries) {
        parts.push(`Recent interactions: ${summaries}`);
      }
    }

    return parts.join('\n\n');
  }
}

// Helper to calculate customer VIP status
export async function calculateVipStatus(customerId: string): Promise<boolean> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { callCount: true, bookingCount: true, lifetimeValue: true },
  });

  if (!customer) return false;

  // VIP criteria: high call count, booking count, or lifetime value
  const vipThresholds = {
    callCount: 10,
    bookingCount: 5,
    lifetimeValue: 500,
  };

  return (
    customer.callCount >= vipThresholds.callCount ||
    customer.bookingCount >= vipThresholds.bookingCount ||
    Number(customer.lifetimeValue) >= vipThresholds.lifetimeValue
  );
}
