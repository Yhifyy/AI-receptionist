import type { 
  RoutingDecision, 
  RouteType, 
  SentimentAnalysis,
  CustomerContext,
  ConversationContext 
} from '@voicedesk/shared-types';
import { prisma } from '@voicedesk/database';
import { openaiService } from '../../integrations/openai/service.js';
import { logger } from '../../shared/logger.js';

export interface RoutingConfig {
  enableVipRouting: boolean;
  enableSentimentRouting: boolean;
  sentimentThreshold: number;
  vipCallbackPriority: boolean;
  escalationKeywords: string[];
  maxAiConversationTurns: number;
}

const DEFAULT_CONFIG: RoutingConfig = {
  enableVipRouting: true,
  enableSentimentRouting: true,
  sentimentThreshold: -0.5,
  vipCallbackPriority: true,
  escalationKeywords: [
    'manager', 'supervisor', 'complaint', 'unacceptable',
    'refund', 'lawsuit', 'lawyer', 'terrible', 'worst',
  ],
  maxAiConversationTurns: 20,
};

export class RoutingService {
  private tenantId: string;
  private config: RoutingConfig;

  constructor(tenantId: string, config?: Partial<RoutingConfig>) {
    this.tenantId = tenantId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async determineRoute(
    customer: CustomerContext | null,
    initialTranscript?: string
  ): Promise<RoutingDecision> {
    const factors: string[] = [];
    let priority = 5; // Default priority (1 = highest, 10 = lowest)

    // VIP check
    if (customer?.isVip && this.config.enableVipRouting) {
      factors.push('VIP customer');
      priority = 2;
      
      // VIPs might still go to AI but with special handling flag
      return {
        route: 'ai_vip',
        priority,
        reason: 'VIP customer - priority handling',
        metadata: { vip: true, customerId: customer.id },
      };
    }

    // Check for immediate escalation keywords in initial transcript
    if (initialTranscript && this.containsEscalationKeywords(initialTranscript)) {
      factors.push('Escalation keywords detected');
      return {
        route: 'human_immediate',
        priority: 1,
        reason: 'Escalation keywords in initial message',
        metadata: { keywords: this.findEscalationKeywords(initialTranscript) },
      };
    }

    // Returning customer with history
    if (customer && customer.callCount > 0) {
      // Check recent call sentiment
      if (customer.previousCalls.length > 0) {
        const recentSentiment = customer.previousCalls
          .slice(0, 3)
          .reduce((sum, c) => sum + (c.sentiment || 0), 0) / 
          Math.min(3, customer.previousCalls.length);

        if (recentSentiment < -0.3) {
          factors.push('Recent negative sentiment');
          priority = 3;
        }
      }

      // High-value customer
      if (customer.lifetimeValue > 500) {
        factors.push('High-value customer');
        priority = Math.min(priority, 3);
      }
    }

    // Default to AI handling
    return {
      route: 'ai_standard',
      priority,
      reason: factors.length > 0 ? factors.join(', ') : 'Standard AI handling',
      metadata: { customerId: customer?.id },
    };
  }

  async evaluateMidCallEscalation(
    context: ConversationContext
  ): Promise<{ shouldEscalate: boolean; reason?: string; priority?: number }> {
    // Check conversation length
    if (context.transcript.length > this.config.maxAiConversationTurns * 2) {
      return {
        shouldEscalate: true,
        reason: 'Extended conversation without resolution',
        priority: 3,
      };
    }

    // Check for repeated intents (stuck in loop)
    const recentIntents = context.detectedIntents.slice(0, 5).map(i => i.intent);
    const uniqueIntents = new Set(recentIntents);
    if (recentIntents.length >= 4 && uniqueIntents.size === 1) {
      return {
        shouldEscalate: true,
        reason: 'Conversation loop detected',
        priority: 2,
      };
    }

    // Analyze recent transcript for escalation signals
    const recentMessages = context.transcript
      .slice(-6)
      .filter(t => t.role === 'user')
      .map(t => t.content)
      .join(' ');

    if (this.containsEscalationKeywords(recentMessages)) {
      return {
        shouldEscalate: true,
        reason: 'Escalation keywords in conversation',
        priority: 1,
      };
    }

    // Real-time sentiment analysis on recent messages
    if (this.config.enableSentimentRouting && recentMessages.length > 20) {
      const sentiment = await this.analyzeSentiment(recentMessages);
      
      if (sentiment.score < this.config.sentimentThreshold) {
        return {
          shouldEscalate: true,
          reason: `Negative sentiment detected (${sentiment.score.toFixed(2)})`,
          priority: 2,
        };
      }
    }

    return { shouldEscalate: false };
  }

  async analyzeSentiment(text: string): Promise<SentimentAnalysis> {
    try {
      return await openaiService.analyzeSentiment(text);
    } catch (error) {
      logger.error({ error }, 'Sentiment analysis failed');
      return { score: 0, label: 'neutral', confidence: 0 };
    }
  }

  private containsEscalationKeywords(text: string): boolean {
    const normalized = text.toLowerCase();
    return this.config.escalationKeywords.some(keyword => 
      normalized.includes(keyword.toLowerCase())
    );
  }

  private findEscalationKeywords(text: string): string[] {
    const normalized = text.toLowerCase();
    return this.config.escalationKeywords.filter(keyword =>
      normalized.includes(keyword.toLowerCase())
    );
  }

  async logRoutingDecision(
    callId: string,
    decision: RoutingDecision
  ): Promise<void> {
    await prisma.callAction.create({
      data: {
        callId,
        type: 'TRANSFER_REQUESTED',
        data: {
          route: decision.route,
          priority: decision.priority,
          reason: decision.reason,
          metadata: decision.metadata,
        },
      },
    });
  }

  async getAvailableAgents(): Promise<Array<{
    id: string;
    name: string;
    available: boolean;
    skills: string[];
    currentCalls: number;
  }>> {
    // In a real implementation, this would query a workforce management system
    // For now, return mock data
    return [
      {
        id: 'agent-1',
        name: 'Sarah (Manager)',
        available: true,
        skills: ['complaints', 'vip', 'escalation'],
        currentCalls: 1,
      },
      {
        id: 'agent-2',
        name: 'Mike (Host)',
        available: true,
        skills: ['reservations', 'general'],
        currentCalls: 2,
      },
    ];
  }

  async selectBestAgent(
    decision: RoutingDecision
  ): Promise<{ agentId: string; name: string } | null> {
    const agents = await this.getAvailableAgents();
    const availableAgents = agents.filter(a => a.available);

    if (availableAgents.length === 0) {
      return null;
    }

    // Priority routing logic
    if (decision.route === 'human_immediate' || decision.priority === 1) {
      // Find agent with escalation/complaints skills
      const escalationAgent = availableAgents.find(a => 
        a.skills.includes('complaints') || a.skills.includes('escalation')
      );
      if (escalationAgent) {
        return { agentId: escalationAgent.id, name: escalationAgent.name };
      }
    }

    if (decision.metadata?.vip) {
      // Find VIP-skilled agent
      const vipAgent = availableAgents.find(a => a.skills.includes('vip'));
      if (vipAgent) {
        return { agentId: vipAgent.id, name: vipAgent.name };
      }
    }

    // Default: agent with lowest current calls
    const sortedByLoad = [...availableAgents].sort(
      (a, b) => a.currentCalls - b.currentCalls
    );

    return {
      agentId: sortedByLoad[0].id,
      name: sortedByLoad[0].name,
    };
  }
}

// Utility for analyzing call patterns
export async function analyzeCallPatterns(tenantId: string): Promise<{
  peakHours: number[];
  commonEscalationReasons: string[];
  avgResolutionTime: number;
}> {
  const calls = await prisma.call.findMany({
    where: { tenantId },
    select: {
      createdAt: true,
      duration: true,
      wasTransferred: true,
      actions: {
        where: { type: 'TRANSFER_REQUESTED' },
        select: { data: true },
      },
    },
    take: 1000,
    orderBy: { createdAt: 'desc' },
  });

  // Calculate peak hours
  const hourCounts = new Array(24).fill(0);
  calls.forEach(call => {
    const hour = new Date(call.createdAt).getHours();
    hourCounts[hour]++;
  });

  const avgCalls = hourCounts.reduce((a, b) => a + b, 0) / 24;
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter(h => h.count > avgCalls * 1.5)
    .map(h => h.hour);

  // Analyze escalation reasons
  const escalationReasons: Record<string, number> = {};
  calls.forEach(call => {
    call.actions.forEach(action => {
      const reason = (action.data as any)?.reason;
      if (reason) {
        escalationReasons[reason] = (escalationReasons[reason] || 0) + 1;
      }
    });
  });

  const commonEscalationReasons = Object.entries(escalationReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason]) => reason);

  // Calculate average resolution time
  const completedCalls = calls.filter(c => c.duration && !c.wasTransferred);
  const avgResolutionTime = completedCalls.length > 0
    ? completedCalls.reduce((sum, c) => sum + (c.duration || 0), 0) / completedCalls.length
    : 0;

  return {
    peakHours,
    commonEscalationReasons,
    avgResolutionTime,
  };
}
