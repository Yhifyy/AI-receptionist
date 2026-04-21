import type { ConversationContext, IntentResult, ExtractedEntity } from '@voicedesk/shared-types';
import { openaiService } from '../../integrations/openai/service.js';
import { logger } from '../../shared/logger.js';

export class IntentClassifier {
  private industry: string;
  private intentPatterns: Map<string, RegExp[]>;

  constructor(industry: string) {
    this.industry = industry;
    this.intentPatterns = this.buildPatterns();
  }

  async classify(
    utterance: string,
    context: ConversationContext
  ): Promise<IntentResult> {
    const normalized = utterance.toLowerCase().trim();

    // Quick pattern matching for common intents
    const patternMatch = this.matchPatterns(normalized);
    if (patternMatch && patternMatch.confidence > 0.9) {
      return patternMatch;
    }

    // Use LLM for complex classification
    const llmResult = await this.classifyWithLLM(utterance, context);

    // Merge with pattern match if both found
    if (patternMatch && llmResult.confidence < patternMatch.confidence) {
      return patternMatch;
    }

    return llmResult;
  }

  private matchPatterns(text: string): IntentResult | null {
    for (const [intent, patterns] of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          const entities = this.extractEntities(text, intent);
          return {
            intent,
            confidence: 0.95,
            entities,
            suggestedState: this.getSuggestedState(intent),
            suggestedActions: this.getSuggestedActions(intent),
          };
        }
      }
    }
    return null;
  }

  private async classifyWithLLM(
    utterance: string,
    context: ConversationContext
  ): Promise<IntentResult> {
    const availableIntents = this.getAvailableIntents();

    try {
      const result = await openaiService.classifyIntent(utterance, availableIntents);

      // Extract entities from the LLM response
      const entities: ExtractedEntity[] = Object.entries(result.entities || {}).map(
        ([type, value]) => ({
          type,
          value: String(value),
          confidence: result.confidence,
        })
      );

      return {
        intent: result.intent,
        confidence: result.confidence,
        entities,
        suggestedState: this.getSuggestedState(result.intent),
        suggestedActions: this.getSuggestedActions(result.intent),
      };
    } catch (error) {
      logger.error({ error }, 'Intent classification failed');
      return {
        intent: 'general_inquiry',
        confidence: 0.3,
        entities: [],
        suggestedState: 'intent_detection' as any,
        suggestedActions: [],
      };
    }
  }

  private extractEntities(text: string, intent: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // Date patterns
    const datePatterns = [
      { pattern: /\b(today|tonight)\b/i, normalize: () => new Date().toISOString().split('T')[0] },
      { pattern: /\b(tomorrow)\b/i, normalize: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
      }},
      { pattern: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, normalize: (match: string) => this.getNextWeekday(match) },
      { pattern: /\b(\d{1,2})\/(\d{1,2})\b/, normalize: (match: string) => {
        const [, month, day] = match.match(/(\d{1,2})\/(\d{1,2})/) || [];
        const year = new Date().getFullYear();
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }},
    ];

    for (const { pattern, normalize } of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        entities.push({
          type: 'date',
          value: match[0],
          confidence: 0.9,
          normalized: normalize(match[0]),
        });
        break;
      }
    }

    // Time patterns
    const timePatterns = [
      { pattern: /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i, normalize: (match: string) => this.normalizeTime(match) },
      { pattern: /\b(\d{1,2})\s*(am|pm)\b/i, normalize: (match: string) => this.normalizeTime(match) },
      { pattern: /\b(noon|midday)\b/i, normalize: () => '12:00' },
      { pattern: /\b(evening|dinner)\b/i, normalize: () => '19:00' },
      { pattern: /\b(lunch)\b/i, normalize: () => '12:30' },
    ];

    for (const { pattern, normalize } of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        entities.push({
          type: 'time',
          value: match[0],
          confidence: 0.9,
          normalized: normalize(match[0]),
        });
        break;
      }
    }

    // Party size
    const partySizeMatch = text.match(/\b(\d+)\s*(people|persons|guests|of us)\b/i) ||
                          text.match(/\bparty\s*of\s*(\d+)\b/i) ||
                          text.match(/\bfor\s*(\d+)\b/i) ||
                          text.match(/\btable\s*for\s*(\d+)\b/i);
    if (partySizeMatch) {
      entities.push({
        type: 'party_size',
        value: partySizeMatch[1],
        confidence: 0.95,
        normalized: partySizeMatch[1],
      });
    }

    // Name extraction (simple pattern)
    const nameMatch = text.match(/\b(?:name\s+is|under|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
    if (nameMatch) {
      entities.push({
        type: 'name',
        value: nameMatch[1],
        confidence: 0.8,
      });
    }

    return entities;
  }

  private normalizeTime(timeStr: string): string {
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return timeStr;

    let hours = parseInt(match[1]);
    const minutes = match[2] || '00';
    const meridiem = match[3]?.toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  }

  private getNextWeekday(day: string): string {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(day.toLowerCase());
    const today = new Date();
    const todayDay = today.getDay();
    
    let daysUntil = targetDay - todayDay;
    if (daysUntil <= 0) daysUntil += 7;
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    
    return targetDate.toISOString().split('T')[0];
  }

  private buildPatterns(): Map<string, RegExp[]> {
    const patterns = new Map<string, RegExp[]>();

    // Booking intents
    patterns.set('make_reservation', [
      /\b(book|reserve|make|get)\s*(a)?\s*(table|reservation|booking)\b/i,
      /\bi('d| would)\s*like\s*(to)?\s*(book|reserve)\b/i,
      /\bcan\s*(i|we)\s*(book|reserve|get)\b/i,
      /\btable\s*for\s*\d+\b/i,
    ]);

    patterns.set('modify_reservation', [
      /\b(change|modify|update|edit)\s*(my|the|a)?\s*(reservation|booking)\b/i,
      /\bmove\s*(my|the)?\s*(reservation|booking)\b/i,
    ]);

    patterns.set('cancel_reservation', [
      /\b(cancel|delete|remove)\s*(my|the|a)?\s*(reservation|booking)\b/i,
      /\bi\s*(need|want)\s*to\s*cancel\b/i,
    ]);

    patterns.set('check_availability', [
      /\b(do you have|is there|any)\s*(availability|tables|space)\b/i,
      /\bwhat('s| is)\s*(available|open)\b/i,
      /\bare\s*you\s*(open|available)\b/i,
    ]);

    // Menu intents
    patterns.set('menu_inquiry', [
      /\bwhat('s| is)\s*on\s*(the|your)?\s*menu\b/i,
      /\bdo\s*you\s*(have|serve)\b/i,
      /\btell\s*me\s*about\s*(the|your)?\s*(menu|food|dishes)\b/i,
      /\bwhat\s*(do\s*you|are\s*your)\s*(recommend|specials)\b/i,
    ]);

    patterns.set('price_inquiry', [
      /\bhow\s*much\s*(is|does|for)\b/i,
      /\bwhat('s| is)\s*the\s*price\b/i,
      /\bwhat\s*does\s*.+\s*cost\b/i,
    ]);

    patterns.set('allergen_inquiry', [
      /\b(allerg|gluten|dairy|nut|vegan|vegetarian)\b/i,
      /\bdoes\s*.+\s*(have|contain)\b/i,
      /\bi('m| am)\s*(allergic|sensitive)\b/i,
    ]);

    // General inquiries
    patterns.set('hours_inquiry', [
      /\bwhat\s*(are|time)\s*(your|do you)\s*(hours|open|close)\b/i,
      /\b(when|what time)\s*(do\s*you|are\s*you)\s*(open|close)\b/i,
      /\bare\s*you\s*open\s*(on|at)\b/i,
    ]);

    patterns.set('location_inquiry', [
      /\bwhere\s*(are\s*you|is\s*the)\s*(located|at)\b/i,
      /\bwhat('s| is)\s*(your|the)\s*(address|location)\b/i,
      /\bhow\s*(do\s*i|to)\s*(get\s*there|find\s*you)\b/i,
    ]);

    // Transfer/escalation
    patterns.set('speak_to_human', [
      /\b(speak|talk)\s*(to|with)\s*(a)?\s*(human|person|someone|manager|staff)\b/i,
      /\b(real|actual|live)\s*person\b/i,
      /\btransfer\s*me\b/i,
      /\bi\s*need\s*(a|to speak to a)\s*(person|human)\b/i,
    ]);

    patterns.set('complaint', [
      /\b(complaint|complain|upset|angry|frustrated|terrible|horrible|worst)\b/i,
      /\bthis\s*is\s*(ridiculous|unacceptable)\b/i,
      /\bi\s*want\s*(to\s*)?(complain|refund|compensation)\b/i,
    ]);

    // Goodbye
    patterns.set('goodbye', [
      /\b(bye|goodbye|thanks|thank you|that('s| is) all)\b/i,
      /\bi('m| am)\s*(done|good|all set)\b/i,
      /\bno\s*(thanks|thank you|that's all)\b/i,
    ]);

    return patterns;
  }

  private getAvailableIntents(): string[] {
    const baseIntents = [
      'make_reservation',
      'modify_reservation',
      'cancel_reservation',
      'check_availability',
      'menu_inquiry',
      'price_inquiry',
      'allergen_inquiry',
      'hours_inquiry',
      'location_inquiry',
      'special_request',
      'speak_to_human',
      'complaint',
      'general_inquiry',
      'goodbye',
    ];

    return baseIntents;
  }

  private getSuggestedState(intent: string): any {
    const stateMap: Record<string, string> = {
      'make_reservation': 'booking_flow',
      'modify_reservation': 'booking_modification',
      'cancel_reservation': 'booking_cancellation',
      'check_availability': 'booking_flow',
      'menu_inquiry': 'menu_qa',
      'price_inquiry': 'menu_qa',
      'allergen_inquiry': 'menu_qa',
      'speak_to_human': 'human_handoff',
      'complaint': 'human_handoff',
      'goodbye': 'closing',
    };

    return stateMap[intent] || 'intent_detection';
  }

  private getSuggestedActions(intent: string): string[] {
    const actionMap: Record<string, string[]> = {
      'make_reservation': ['check_availability', 'create_booking'],
      'modify_reservation': ['modify_booking'],
      'cancel_reservation': ['cancel_booking'],
      'check_availability': ['check_availability'],
      'menu_inquiry': ['get_menu_info'],
      'speak_to_human': ['transfer_to_human'],
      'complaint': ['transfer_to_human'],
    };

    return actionMap[intent] || [];
  }
}
