import type { 
  ConversationContext, 
  ConversationState, 
  IntentResult,
  PendingAction,
  ActionResult,
  TenantConfig 
} from '@voicedesk/shared-types';
import { createPromptBuilder, type ToolDefinition } from '@voicedesk/ai-prompts';
import { checkResponseGuardrails, enforceGuardrails } from '@voicedesk/ai-prompts';
import { OpenAIService, type LLMResponse } from '../../integrations/openai/service.js';
import { logger } from '../../shared/logger.js';
import { IntentClassifier } from './intent-classifier.js';
import { ActionExecutor } from './action-executor.js';

export interface ConversationResponse {
  text: string;
  newState?: ConversationState;
  actions?: Array<{ type: string; data: any }>;
  intents?: IntentResult[];
  shouldTransfer?: boolean;
  confidence?: number;
}

export class ConversationEngine {
  private openai: OpenAIService;
  private promptBuilder: ReturnType<typeof createPromptBuilder>;
  private intentClassifier: IntentClassifier;
  private actionExecutor: ActionExecutor;
  private config: TenantConfig;

  constructor(tenant: any) {
    this.openai = new OpenAIService();
    this.config = this.buildTenantConfig(tenant);
    this.promptBuilder = createPromptBuilder(this.config);
    this.intentClassifier = new IntentClassifier(tenant.industry);
    this.actionExecutor = new ActionExecutor(tenant.id);
  }

  async process(
    context: ConversationContext,
    userMessage: string
  ): Promise<ConversationResponse> {
    const startTime = Date.now();

    try {
      // Step 1: Classify intent
      const intentResult = await this.intentClassifier.classify(userMessage, context);
      context.detectedIntents = [intentResult, ...context.detectedIntents.slice(0, 4)];

      logger.debug({
        intent: intentResult.intent,
        confidence: intentResult.confidence,
      }, 'Intent classified');

      // Step 2: Update conversation state based on intent
      const newState = this.determineState(intentResult, context);
      if (newState !== context.currentState) {
        logger.debug({ from: context.currentState, to: newState }, 'State transition');
        context.currentState = newState;
      }

      // Step 3: Build prompt
      const { systemPrompt, userPrompt, tools } = this.promptBuilder.build(context);

      // Step 4: Generate response
      const messages = [
        ...context.transcript.slice(-10).map(t => ({
          role: t.role as 'user' | 'assistant',
          content: t.content,
        })),
        { role: 'user' as const, content: userMessage },
      ];

      const llmResponse = await this.openai.chat(messages, {
        systemPrompt: `${systemPrompt}\n\n${userPrompt}`,
        tools: this.convertTools(tools),
        temperature: 0.7,
        maxTokens: 200,
      });

      // Step 5: Process tool calls
      const actions: Array<{ type: string; data: any }> = [];
      
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        for (const toolCall of llmResponse.toolCalls) {
          actions.push({
            type: toolCall.name,
            data: toolCall.arguments,
          });

          // Execute action and get result
          const result = await this.actionExecutor.execute(
            toolCall.name,
            toolCall.arguments,
            context
          );

          // If action affects response, note it
          if (result.message) {
            llmResponse.text = result.message;
          }
        }
      }

      // Step 6: Apply guardrails
      const guardrailChecks = checkResponseGuardrails(llmResponse.text, {
        hasBookingPending: context.pendingActions.some(a => a.type === 'create_booking'),
        turnCount: context.transcript.length,
      });

      const { response: finalText, blocked, flags } = enforceGuardrails(
        llmResponse.text,
        guardrailChecks
      );

      if (flags.length > 0) {
        logger.warn({ flags }, 'Guardrail flags raised');
      }

      // Step 7: Check for escalation triggers
      const shouldTransfer = this.checkEscalationTriggers(context, intentResult);

      const latency = Date.now() - startTime;
      logger.info({
        latency,
        state: context.currentState,
        intent: intentResult.intent,
        actionsCount: actions.length,
      }, 'Conversation turn processed');

      return {
        text: finalText,
        newState: context.currentState,
        actions,
        intents: [intentResult],
        shouldTransfer,
        confidence: intentResult.confidence,
      };

    } catch (error) {
      logger.error({ error }, 'Conversation processing error');
      
      return {
        text: "I apologize, I'm having some trouble. Could you please repeat that?",
        newState: context.currentState,
        confidence: 0,
      };
    }
  }

  private determineState(
    intentResult: IntentResult,
    context: ConversationContext
  ): ConversationState {
    const { intent, confidence } = intentResult;

    // Low confidence - stay in current state or go to detection
    if (confidence < 0.5) {
      return context.currentState === 'greeting' 
        ? 'intent_detection' as ConversationState
        : context.currentState;
    }

    // Map intents to states
    const intentStateMap: Record<string, ConversationState> = {
      'make_reservation': 'booking_flow' as ConversationState,
      'modify_reservation': 'booking_modification' as ConversationState,
      'cancel_reservation': 'booking_cancellation' as ConversationState,
      'check_availability': 'booking_flow' as ConversationState,
      'menu_inquiry': 'menu_qa' as ConversationState,
      'price_inquiry': 'menu_qa' as ConversationState,
      'allergen_inquiry': 'menu_qa' as ConversationState,
      'hours_inquiry': 'general_inquiry' as ConversationState,
      'location_inquiry': 'general_inquiry' as ConversationState,
      'speak_to_human': 'human_handoff' as ConversationState,
      'complaint': 'human_handoff' as ConversationState,
      'goodbye': 'closing' as ConversationState,
    };

    return intentStateMap[intent] || 'intent_detection' as ConversationState;
  }

  private checkEscalationTriggers(
    context: ConversationContext,
    intentResult: IntentResult
  ): boolean {
    // Check explicit transfer request
    if (intentResult.intent === 'speak_to_human') {
      return true;
    }

    // Check complaint intent
    if (intentResult.intent === 'complaint' && intentResult.confidence > 0.7) {
      return true;
    }

    // Check for conversation loops (repeated similar intents without resolution)
    const recentIntents = context.detectedIntents.slice(0, 5);
    const sameIntentCount = recentIntents.filter(
      i => i.intent === intentResult.intent
    ).length;
    
    if (sameIntentCount >= 3) {
      logger.warn({ intent: intentResult.intent }, 'Conversation loop detected');
      return true;
    }

    // Check for long conversation without resolution
    if (context.transcript.length > 20 && 
        !context.pendingActions.some(a => a.confirmed)) {
      return true;
    }

    return false;
  }

  private convertTools(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: tool.function,
    }));
  }

  private buildTenantConfig(tenant: any): TenantConfig {
    return {
      businessName: tenant.name,
      industry: tenant.industry,
      timezone: tenant.timezone || 'America/New_York',
      operatingHours: tenant.operatingHours || {},
      voiceConfig: {
        voiceId: tenant.voiceId || '',
        stability: 0.5,
        similarityBoost: 0.75,
      },
      features: {
        enableUpselling: true,
        enableMemory: true,
        enableABTesting: tenant.plan !== 'STARTER',
        enableSentimentAnalysis: true,
        enableCallRecording: true,
        maxCallDuration: 1800,
      },
      integrations: {},
      restaurantConfig: tenant.config,
    };
  }
}
