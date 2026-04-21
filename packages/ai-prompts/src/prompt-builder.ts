import type { ConversationContext, TenantConfig, ConversationState } from '@voicedesk/shared-types';
import { 
  buildSystemPrompt, 
  buildContextPrompt, 
  buildTranscriptPrompt 
} from './system-prompts.js';
import { 
  buildRestaurantContext, 
  BOOKING_FLOW_PROMPT, 
  MENU_QA_PROMPT,
  selectUpsellPrompt 
} from './restaurant-prompts.js';
import { SAFETY_GUARDRAILS, CONVERSATION_GUARDRAILS } from './guardrails.js';

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export class PromptBuilder {
  private config: TenantConfig;
  
  constructor(config: TenantConfig) {
    this.config = config;
  }

  build(context: ConversationContext): BuiltPrompt {
    const systemParts: string[] = [];
    const userParts: string[] = [];

    // Core system prompt
    systemParts.push(buildSystemPrompt(this.config));
    
    // Guardrails
    systemParts.push('');
    systemParts.push(SAFETY_GUARDRAILS);
    systemParts.push('');
    systemParts.push(CONVERSATION_GUARDRAILS);

    // Industry-specific context
    if (this.config.industry === 'RESTAURANT' && this.config.restaurantConfig) {
      systemParts.push('');
      systemParts.push(buildRestaurantContext(context, this.config.restaurantConfig));
    }

    // State-specific prompts
    const statePrompt = this.getStatePrompt(context.currentState);
    if (statePrompt) {
      systemParts.push('');
      systemParts.push(statePrompt);
    }

    // Customer context
    userParts.push(buildContextPrompt(context));
    
    // Conversation transcript
    userParts.push('');
    userParts.push(buildTranscriptPrompt(context));

    // Upsell opportunity (if applicable)
    if (context.currentState === 'confirmation') {
      const upsellPrompt = selectUpsellPrompt(context);
      if (upsellPrompt) {
        userParts.push('');
        userParts.push('## Upsell Opportunity');
        userParts.push(`Consider offering: ${upsellPrompt}`);
      }
    }

    // Final instruction
    userParts.push('');
    userParts.push('## Your Response');
    userParts.push('Respond naturally as the AI receptionist. Keep it brief (1-2 sentences). If you need to take an action, use the appropriate tool.');

    return {
      systemPrompt: systemParts.join('\n'),
      userPrompt: userParts.join('\n'),
      tools: this.getToolsForState(context.currentState),
    };
  }

  private getStatePrompt(state: ConversationState): string | null {
    const statePrompts: Partial<Record<ConversationState, string>> = {
      booking_flow: BOOKING_FLOW_PROMPT,
      menu_qa: MENU_QA_PROMPT,
      human_handoff: `## Transferring to Human
Politely explain that you're connecting them with a team member.
Keep them engaged while the transfer happens.
Thank them for their patience.`,
      closing: `## Closing the Call
- Thank them for calling
- Confirm any actions taken
- Mention they'll receive a confirmation if applicable
- Wish them well`,
    };

    return statePrompts[state] || null;
  }

  private getToolsForState(state: ConversationState): ToolDefinition[] {
    const allTools: Record<string, ToolDefinition> = {
      check_availability: {
        type: 'function',
        function: {
          name: 'check_availability',
          description: 'Check table availability for a specific date, time, and party size',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
              partySize: { type: 'integer', description: 'Number of guests' },
            },
            required: ['date', 'time', 'partySize'],
          },
        },
      },
      create_booking: {
        type: 'function',
        function: {
          name: 'create_booking',
          description: 'Create a new reservation after collecting all required information',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              time: { type: 'string', description: 'Time in HH:MM format' },
              partySize: { type: 'integer', description: 'Number of guests' },
              guestName: { type: 'string', description: 'Name for the reservation' },
              guestPhone: { type: 'string', description: 'Contact phone number' },
              guestEmail: { type: 'string', description: 'Email address (optional)' },
              specialRequests: { type: 'string', description: 'Any special requests or notes' },
              occasion: { type: 'string', description: 'Special occasion if mentioned' },
            },
            required: ['date', 'time', 'partySize', 'guestName', 'guestPhone'],
          },
        },
      },
      modify_booking: {
        type: 'function',
        function: {
          name: 'modify_booking',
          description: 'Modify an existing reservation',
          parameters: {
            type: 'object',
            properties: {
              bookingId: { type: 'string', description: 'Booking ID or confirmation code' },
              date: { type: 'string', description: 'New date (if changing)' },
              time: { type: 'string', description: 'New time (if changing)' },
              partySize: { type: 'integer', description: 'New party size (if changing)' },
              specialRequests: { type: 'string', description: 'Updated special requests' },
            },
            required: ['bookingId'],
          },
        },
      },
      cancel_booking: {
        type: 'function',
        function: {
          name: 'cancel_booking',
          description: 'Cancel an existing reservation',
          parameters: {
            type: 'object',
            properties: {
              bookingId: { type: 'string', description: 'Booking ID or confirmation code' },
              reason: { type: 'string', description: 'Reason for cancellation (optional)' },
            },
            required: ['bookingId'],
          },
        },
      },
      get_menu_info: {
        type: 'function',
        function: {
          name: 'get_menu_info',
          description: 'Get information about menu items, prices, ingredients, or allergens',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'What to look up (item name, category, or dietary requirement)' },
              category: { type: 'string', description: 'Filter by category (appetizer, main, dessert, drink)' },
              dietaryFilter: { 
                type: 'string', 
                enum: ['vegetarian', 'vegan', 'gluten-free'],
                description: 'Filter by dietary requirement' 
              },
            },
            required: ['query'],
          },
        },
      },
      get_operating_hours: {
        type: 'function',
        function: {
          name: 'get_operating_hours',
          description: 'Get business operating hours',
          parameters: {
            type: 'object',
            properties: {
              day: { type: 'string', description: 'Specific day to check (optional)' },
            },
          },
        },
      },
      transfer_to_human: {
        type: 'function',
        function: {
          name: 'transfer_to_human',
          description: 'Transfer the call to a human staff member',
          parameters: {
            type: 'object',
            properties: {
              reason: { type: 'string', description: 'Reason for transfer' },
              priority: { 
                type: 'string', 
                enum: ['normal', 'high', 'urgent'],
                description: 'Priority level for the transfer' 
              },
              summary: { type: 'string', description: 'Brief summary of the conversation so far' },
            },
            required: ['reason'],
          },
        },
      },
      add_to_waitlist: {
        type: 'function',
        function: {
          name: 'add_to_waitlist',
          description: 'Add customer to waitlist when no tables are available',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'Desired date' },
              time: { type: 'string', description: 'Desired time' },
              partySize: { type: 'integer', description: 'Number of guests' },
              guestName: { type: 'string', description: 'Guest name' },
              guestPhone: { type: 'string', description: 'Contact phone' },
            },
            required: ['date', 'time', 'partySize', 'guestName', 'guestPhone'],
          },
        },
      },
    };

    // Return tools relevant to current state
    const stateTools: Record<string, string[]> = {
      greeting: ['transfer_to_human'],
      intent_detection: ['get_menu_info', 'get_operating_hours', 'transfer_to_human'],
      booking_flow: ['check_availability', 'create_booking', 'add_to_waitlist', 'transfer_to_human'],
      booking_modification: ['modify_booking', 'cancel_booking', 'transfer_to_human'],
      booking_cancellation: ['cancel_booking', 'transfer_to_human'],
      menu_qa: ['get_menu_info', 'transfer_to_human'],
      general_inquiry: ['get_operating_hours', 'get_menu_info', 'transfer_to_human'],
      confirmation: ['create_booking', 'modify_booking', 'transfer_to_human'],
      human_handoff: ['transfer_to_human'],
      closing: [],
    };

    const toolNames = stateTools[state] || ['transfer_to_human'];
    return toolNames.map(name => allTools[name]).filter(Boolean);
  }
}

export function createPromptBuilder(config: TenantConfig): PromptBuilder {
  return new PromptBuilder(config);
}
