export const SAFETY_GUARDRAILS = `## Safety Guardrails

### Information Accuracy
- ONLY provide information from verified sources (menu data, booking system, business config)
- If information is not available, say "Let me check on that" or "I don't have that information"
- Never guess prices, ingredients, or availability

### Booking Safety
- ALWAYS confirm booking details before finalizing
- Repeat: Date, Time, Party Size, Name
- Wait for explicit confirmation ("Yes", "That's correct", "Confirm")
- Do not assume silence means confirmation

### Privacy & Security
- Do not discuss other customers' reservations
- Do not share staff schedules or personal information
- Handle payment information only through secure channels
- Do not store or repeat sensitive information unnecessarily

### Escalation Triggers
Transfer to human immediately if:
- Customer explicitly asks for a human/manager
- Customer expresses serious complaint or frustration
- Medical emergency or safety concern
- Legal or liability issues
- Complex special requests beyond standard capabilities

### Prohibited Actions
- Never make promises outside business policy
- Never offer unauthorized discounts
- Never disparage competitors
- Never make medical or legal claims
- Never engage with inappropriate content`;

export const CONVERSATION_GUARDRAILS = `## Conversation Guardrails

### Response Length
- Maximum 2 sentences per turn for routine responses
- Can extend to 3-4 sentences for complex explanations
- Always prefer shorter responses on phone calls

### Confirmation Requirements
Actions requiring explicit confirmation:
- Creating a booking
- Modifying a booking
- Cancelling a booking
- Transferring to human
- Adding charges or upgrades

### Loop Prevention
- If repeating similar information 3+ times, offer to transfer to human
- If customer seems confused, simplify language and offer alternatives
- Track conversation loops and escalate if stuck

### Fallback Responses
When uncertain, use these progressively:
1. "Let me make sure I understand - you're asking about [X]?"
2. "I want to make sure I help you correctly. Could you tell me more about what you need?"
3. "I think a team member could help you better with this. Would you like me to connect you?"`;

export interface GuardrailCheck {
  type: 'safety' | 'accuracy' | 'policy';
  rule: string;
  triggered: boolean;
  action: 'block' | 'modify' | 'flag' | 'allow';
  reason?: string;
}

export function checkResponseGuardrails(
  response: string,
  context: { hasBookingPending: boolean; turnCount: number }
): GuardrailCheck[] {
  const checks: GuardrailCheck[] = [];

  // Check for making up information patterns
  const fabricationPatterns = [
    /I think the price is/i,
    /probably around/i,
    /I believe we have/i,
    /maybe we can/i,
  ];

  for (const pattern of fabricationPatterns) {
    if (pattern.test(response)) {
      checks.push({
        type: 'accuracy',
        rule: 'no_fabrication',
        triggered: true,
        action: 'modify',
        reason: 'Response contains uncertain language suggesting fabrication',
      });
    }
  }

  // Check response length
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length > 4) {
    checks.push({
      type: 'policy',
      rule: 'response_length',
      triggered: true,
      action: 'modify',
      reason: 'Response too long for phone conversation',
    });
  }

  // Check for booking confirmation without verification
  if (context.hasBookingPending && 
      /booked|confirmed|all set/i.test(response) &&
      !/correct|right|okay|yes/i.test(response)) {
    checks.push({
      type: 'safety',
      rule: 'booking_confirmation',
      triggered: true,
      action: 'block',
      reason: 'Booking confirmation without verification',
    });
  }

  // Check for prohibited content
  const prohibitedPatterns = [
    { pattern: /competitor/i, reason: 'Mentioning competitors' },
    { pattern: /guarantee|promise/i, reason: 'Making guarantees' },
    { pattern: /sue|lawsuit|legal/i, reason: 'Legal language' },
  ];

  for (const { pattern, reason } of prohibitedPatterns) {
    if (pattern.test(response)) {
      checks.push({
        type: 'safety',
        rule: 'prohibited_content',
        triggered: true,
        action: 'flag',
        reason,
      });
    }
  }

  return checks;
}

export function enforceGuardrails(
  response: string, 
  checks: GuardrailCheck[]
): { response: string; blocked: boolean; flags: string[] } {
  let modifiedResponse = response;
  const flags: string[] = [];
  let blocked = false;

  for (const check of checks) {
    if (!check.triggered) continue;

    switch (check.action) {
      case 'block':
        blocked = true;
        modifiedResponse = "Let me verify those details with you first.";
        break;
      
      case 'modify':
        if (check.rule === 'response_length') {
          const sentences = modifiedResponse.split(/[.!?]+/).filter(s => s.trim());
          modifiedResponse = sentences.slice(0, 2).join('. ') + '.';
        }
        break;
      
      case 'flag':
        flags.push(check.reason || check.rule);
        break;
    }
  }

  return { response: modifiedResponse, blocked, flags };
}
