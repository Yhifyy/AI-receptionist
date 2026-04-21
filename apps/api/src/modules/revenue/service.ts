import { prisma } from '@voicedesk/database';
import type { ConversationContext } from '@voicedesk/shared-types';
import { logger } from '../../shared/logger.js';

export interface UpsellOpportunity {
  id: string;
  trigger: string;
  offer: string;
  script: string;
  value: number;
  successRate?: number;
}

export interface ConversionScript {
  id: string;
  name: string;
  scenario: string;
  script: string;
  successRate?: number;
}

export class RevenueService {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  // Upselling logic
  async detectUpsellOpportunity(
    context: ConversationContext
  ): Promise<UpsellOpportunity | null> {
    const opportunities = await this.getUpsellOpportunities();
    
    for (const opp of opportunities) {
      if (this.evaluateTrigger(opp.trigger, context)) {
        logger.info({ opportunityId: opp.id }, 'Upsell opportunity detected');
        return opp;
      }
    }

    return null;
  }

  private async getUpsellOpportunities(): Promise<UpsellOpportunity[]> {
    // Base opportunities for restaurants
    const baseOpportunities: UpsellOpportunity[] = [
      {
        id: 'large_party_private_dining',
        trigger: 'party_size >= 6',
        offer: 'private_dining_room',
        script: "Since you're coming with a larger group, I should mention we have a private dining room available for an additional $50 - would you like me to check availability?",
        value: 50,
      },
      {
        id: 'special_occasion_package',
        trigger: 'occasion_mentioned',
        offer: 'celebration_package',
        script: "That's wonderful! For special occasions, we offer a celebration package that includes a complimentary dessert and a photo. Would you like me to add that?",
        value: 25,
      },
      {
        id: 'weekend_prix_fixe',
        trigger: 'weekend_dinner',
        offer: 'prix_fixe_menu',
        script: "On weekend evenings, our chef offers a special prix fixe menu - three courses for $65 per person. It's very popular. Would you like me to reserve that for your table?",
        value: 65,
      },
      {
        id: 'wine_pairing',
        trigger: 'main_course_inquiry',
        offer: 'wine_recommendation',
        script: "That dish pairs beautifully with our house Chianti. Would you like me to have the sommelier prepare a recommendation for your table?",
        value: 15,
      },
      {
        id: 'returning_customer_special',
        trigger: 'returning_vip',
        offer: 'loyalty_offer',
        script: "As a valued guest, I'd like to offer you a complimentary appetizer on your next visit. Shall I make a note of that?",
        value: 12,
      },
    ];

    // Load custom opportunities from database
    const customOpportunities = await prisma.customPrompt.findMany({
      where: {
        tenantId: this.tenantId,
        type: 'upsell',
        isActive: true,
      },
    });

    const custom = customOpportunities.map(p => ({
      id: p.id,
      trigger: (p.content as any).trigger || '',
      offer: (p.content as any).offer || '',
      script: (p.content as any).script || p.content,
      value: (p.content as any).value || 0,
      successRate: p.successRate || undefined,
    }));

    return [...baseOpportunities, ...custom];
  }

  private evaluateTrigger(trigger: string, context: ConversationContext): boolean {
    const pendingBooking = context.pendingActions.find(a => a.type === 'create_booking');
    const partySize = pendingBooking?.data?.partySize || 0;
    const specialRequests = pendingBooking?.data?.specialRequests?.toLowerCase() || '';
    const date = pendingBooking?.data?.date;

    switch (trigger) {
      case 'party_size >= 6':
        return partySize >= 6;

      case 'occasion_mentioned':
        return /birthday|anniversary|celebration|special/i.test(specialRequests);

      case 'weekend_dinner':
        if (date) {
          const dayOfWeek = new Date(date).getDay();
          const time = pendingBooking?.data?.time;
          const isEvening = time && parseInt(time.split(':')[0]) >= 17;
          return (dayOfWeek === 5 || dayOfWeek === 6) && isEvening;
        }
        return false;

      case 'main_course_inquiry':
        return context.currentState === 'menu_qa' &&
               context.detectedIntents.some(i => 
                 i.entities.some(e => e.type === 'item' && 
                   /pasta|steak|fish|chicken|main/i.test(e.value))
               );

      case 'returning_vip':
        return context.customer?.isVip === true && 
               (context.customer?.callCount || 0) > 3;

      default:
        return false;
    }
  }

  // Conversion scripts
  async getConversionScript(scenario: string): Promise<ConversionScript | null> {
    const scripts: Record<string, ConversionScript> = {
      hesitant_caller: {
        id: 'hesitant',
        name: 'Hesitant Caller',
        scenario: 'Caller seems undecided about booking',
        script: "I can hold that table for you for 10 minutes while you check with everyone. Would that help?",
        successRate: 0.65,
      },
      price_sensitive: {
        id: 'price_sensitive',
        name: 'Price Sensitive',
        scenario: 'Caller asking about prices or seems concerned about cost',
        script: "Just so you know, our prix fixe menu is excellent value at $45 per person for three courses. And we have complimentary valet parking on weekends.",
        successRate: 0.55,
      },
      busy_time: {
        id: 'busy_time',
        name: 'High Demand Time',
        scenario: 'Popular time slot with limited availability',
        script: "That's one of our most requested times! I have just two tables left. Would you like me to secure one for you?",
        successRate: 0.78,
      },
      callback_convert: {
        id: 'callback',
        name: 'Callback Conversion',
        scenario: 'Caller wants to think about it',
        script: "Of course, take your time! I can also send you a text with our menu and a link to book online when you're ready. Would that be helpful?",
        successRate: 0.42,
      },
      alternative_time: {
        id: 'alternative',
        name: 'Alternative Time',
        scenario: 'Requested time unavailable',
        script: "While 7pm is fully booked, I have a great table available at 7:30 - it's actually by the window with a lovely view. Would that work for you?",
        successRate: 0.71,
      },
    };

    return scripts[scenario] || null;
  }

  // A/B Testing
  async selectVariant(testId: string): Promise<'A' | 'B'> {
    const test = await prisma.aBTest.findUnique({
      where: { id: testId },
    });

    if (!test || test.status !== 'running') {
      return 'A';
    }

    // Random selection based on traffic split
    return Math.random() < test.trafficSplit ? 'B' : 'A';
  }

  async recordTestResult(
    testId: string,
    variant: 'A' | 'B',
    success: boolean
  ): Promise<void> {
    const updateData: any = {};

    if (variant === 'A') {
      updateData.variantACalls = { increment: 1 };
      if (success) updateData.variantASuccess = { increment: 1 };
    } else {
      updateData.variantBCalls = { increment: 1 };
      if (success) updateData.variantBSuccess = { increment: 1 };
    }

    await prisma.aBTest.update({
      where: { id: testId },
      data: updateData,
    });
  }

  async evaluateTest(testId: string): Promise<{
    winner: 'A' | 'B' | null;
    confidence: number;
    recommendation: string;
  }> {
    const test = await prisma.aBTest.findUnique({
      where: { id: testId },
    });

    if (!test) {
      return { winner: null, confidence: 0, recommendation: 'Test not found' };
    }

    const rateA = test.variantACalls > 0 ? test.variantASuccess / test.variantACalls : 0;
    const rateB = test.variantBCalls > 0 ? test.variantBSuccess / test.variantBCalls : 0;
    const totalCalls = test.variantACalls + test.variantBCalls;

    // Simple statistical significance check
    const minSampleSize = 100;
    if (totalCalls < minSampleSize) {
      return {
        winner: null,
        confidence: 0,
        recommendation: `Need ${minSampleSize - totalCalls} more calls for statistical significance`,
      };
    }

    const difference = Math.abs(rateA - rateB);
    const pooledRate = (test.variantASuccess + test.variantBSuccess) / totalCalls;
    const standardError = Math.sqrt(
      (pooledRate * (1 - pooledRate)) * (1/test.variantACalls + 1/test.variantBCalls)
    );
    
    const zScore = difference / standardError;
    const confidence = Math.min(0.99, 1 - Math.exp(-zScore * zScore / 2));

    const winner = rateA > rateB ? 'A' : 'B';
    const winnerRate = Math.max(rateA, rateB) * 100;
    const loserRate = Math.min(rateA, rateB) * 100;

    let recommendation: string;
    if (confidence >= 0.95) {
      recommendation = `Variant ${winner} is the clear winner with ${winnerRate.toFixed(1)}% vs ${loserRate.toFixed(1)}%. Consider promoting it.`;
    } else if (confidence >= 0.80) {
      recommendation = `Variant ${winner} is trending better but needs more data to confirm.`;
    } else {
      recommendation = 'No significant difference detected. Continue testing.';
    }

    return { winner: confidence >= 0.95 ? winner : null, confidence, recommendation };
  }

  // Revenue tracking
  async trackRevenue(callId: string, amount: number, source: string): Promise<void> {
    await prisma.call.update({
      where: { id: callId },
      data: {
        revenueImpact: { increment: amount },
      },
    });

    await prisma.callAction.create({
      data: {
        callId,
        type: source === 'upsell' ? 'UPSELL_ACCEPTED' : 'BOOKING_CREATED',
        data: { amount, source },
      },
    });

    logger.info({ callId, amount, source }, 'Revenue tracked');
  }
}
