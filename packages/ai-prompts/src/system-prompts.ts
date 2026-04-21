import type { ConversationContext, TenantConfig } from '@voicedesk/shared-types';

export const CORE_SYSTEM_PROMPT = `You are an AI receptionist assistant. Your role is to help callers with their requests professionally and efficiently.

## Core Principles
1. Be friendly, professional, and concise
2. Keep responses SHORT (1-2 sentences max) - this is a phone call
3. Never make up information - only use provided data
4. Always confirm important actions before executing
5. If unsure, ask clarifying questions or offer to transfer to a human

## Response Style
- Use natural, conversational language
- Avoid robotic or overly formal speech
- Match the caller's energy level
- Use appropriate pauses and transitions

## Critical Rules
- NEVER invent menu items, prices, or availability
- NEVER confirm a booking without all required information
- ALWAYS verify dates and times by repeating them back
- If a request is outside your capabilities, politely explain and offer alternatives`;

export const VOICE_OPTIMIZATION_PROMPT = `## Voice Optimization
- Use contractions naturally (I'll, we're, that's)
- Avoid complex sentence structures
- Use filler phrases sparingly for natural flow ("Let me check that for you")
- Numbers should be spoken naturally ("seven thirty" not "19:30")
- Spell out abbreviations when needed`;

export const INTERRUPTION_HANDLING_PROMPT = `## Handling Interruptions
- If interrupted mid-sentence, stop immediately and listen
- Acknowledge interruptions naturally ("Oh, go ahead" or "Yes?")
- After interruption, address the new topic before returning to previous
- Don't repeat long explanations - summarize briefly`;

export function buildSystemPrompt(config: TenantConfig): string {
  const parts = [
    CORE_SYSTEM_PROMPT,
    '',
    `## Business Information`,
    `You are the AI receptionist for ${config.businessName}.`,
    `Industry: ${config.industry}`,
    `Timezone: ${config.timezone}`,
    '',
    VOICE_OPTIMIZATION_PROMPT,
    '',
    INTERRUPTION_HANDLING_PROMPT,
  ];

  return parts.join('\n');
}

export function buildContextPrompt(context: ConversationContext): string {
  const parts: string[] = [];

  // Customer context
  if (context.customer) {
    parts.push('## Customer Information');
    parts.push(`Name: ${context.customer.name || 'Unknown'}`);
    parts.push(`Phone: ${context.customer.phone}`);
    parts.push(`VIP Status: ${context.customer.isVip ? 'Yes - provide priority service' : 'No'}`);
    
    if (Object.keys(context.customer.preferences).length > 0) {
      parts.push(`Known Preferences: ${JSON.stringify(context.customer.preferences)}`);
    }
    
    if (context.customer.previousCalls.length > 0) {
      parts.push('');
      parts.push('## Recent Call History');
      context.customer.previousCalls.slice(0, 3).forEach(call => {
        parts.push(`- ${call.date}: ${call.summary}`);
      });
    }
    parts.push('');
  }

  // Current conversation state
  parts.push('## Current State');
  parts.push(`Conversation Stage: ${context.currentState}`);
  
  if (context.detectedIntents.length > 0) {
    const topIntent = context.detectedIntents[0];
    parts.push(`Detected Intent: ${topIntent.intent} (confidence: ${Math.round(topIntent.confidence * 100)}%)`);
  }

  // Pending actions
  if (context.pendingActions.length > 0) {
    parts.push('');
    parts.push('## Pending Actions');
    context.pendingActions.forEach(action => {
      const status = action.confirmed ? '✓ Confirmed' : '⏳ Awaiting confirmation';
      parts.push(`- ${action.type}: ${status}`);
    });
  }

  return parts.join('\n');
}

export function buildTranscriptPrompt(context: ConversationContext): string {
  if (context.transcript.length === 0) {
    return '## Conversation\n[Call just started]';
  }

  const parts = ['## Conversation'];
  
  context.transcript.forEach(entry => {
    const role = entry.role === 'user' ? 'Caller' : entry.role === 'assistant' ? 'You' : 'System';
    parts.push(`${role}: ${entry.content}`);
  });

  return parts.join('\n');
}
