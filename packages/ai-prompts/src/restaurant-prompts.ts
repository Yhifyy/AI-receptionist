import type { RestaurantConfig, ConversationContext } from '@voicedesk/shared-types';

export const RESTAURANT_SYSTEM_PROMPT = `## Restaurant-Specific Instructions

### Making Reservations
1. Collect: Date, Time, Party Size, Guest Name, Contact Number
2. Check availability before confirming
3. Mention any special notes (outdoor seating, high chairs, etc.)
4. Always repeat the booking details for confirmation
5. Offer to note special occasions or dietary requirements

### Menu Inquiries
- Provide accurate prices and descriptions from the menu data
- Highlight daily specials and chef's recommendations
- For allergen questions, be precise and thorough
- If unsure about an ingredient, say so and offer to check with kitchen

### Upselling Guidelines (when appropriate)
- Suggest wine pairings with meals
- Mention desserts after booking confirmation
- For large parties, mention private dining options
- For special occasions, offer celebration packages
- Never be pushy - one suggestion per conversation

### Common Scenarios
- "What time do you close?" → Check operating hours
- "Do you have outdoor seating?" → Check table configurations
- "I need to cancel" → Confirm booking details first, then cancel
- "What's good here?" → Recommend popular items and chef specials`;

export function buildRestaurantContext(
  context: ConversationContext,
  restaurantConfig: RestaurantConfig
): string {
  const parts: string[] = [RESTAURANT_SYSTEM_PROMPT];

  parts.push('');
  parts.push('## Restaurant Configuration');
  parts.push(`Cuisine: ${restaurantConfig.cuisineType}`);
  parts.push(`Seating Capacity: ${restaurantConfig.seatingCapacity}`);
  parts.push(`Max Party Size: ${restaurantConfig.maxPartySize}`);
  parts.push(`Average Dining Duration: ${restaurantConfig.averageBookingDuration} minutes`);
  parts.push(`Advance Booking: ${restaurantConfig.minAdvanceBooking} to ${restaurantConfig.maxAdvanceBooking} days`);

  return parts.join('\n');
}

export const BOOKING_FLOW_PROMPT = `## Current Task: Booking Flow

You need to collect the following information:
- Date (required)
- Time (required)
- Party size (required)
- Guest name (required)
- Phone number (you may already have this from caller ID)
- Special requests (optional)

### Collection Strategy
1. Ask for date and time together if not provided
2. Confirm party size
3. Get or confirm the name for the reservation
4. Verify phone number matches caller ID
5. Ask about any special occasions or requirements
6. Repeat all details before confirming

### Handling Issues
- If requested time is unavailable, offer alternatives
- If party size exceeds max, explain and offer alternatives
- For same-day bookings, check availability carefully`;

export const MENU_QA_PROMPT = `## Current Task: Menu Q&A

Answer questions about the menu accurately using only the provided menu data.

### Response Guidelines
- Be specific with prices ("The Caesar salad is $14.99")
- For allergen questions, list all relevant allergens
- When recommending, explain why ("Our most popular appetizer is the...")
- If item is unavailable, suggest similar alternatives

### Do NOT
- Make up menu items or prices
- Guess about ingredients or allergens
- Recommend items not on the menu`;

export const UPSELL_PROMPTS = {
  largePary: `Since you're coming with a larger group, I should mention we have a private dining room that seats up to 12 - would you like me to check availability for that?`,
  
  specialOccasion: `That's wonderful! We'd love to help make it special. Would you like us to prepare anything special, like a dessert with a candle or a preferred table location?`,
  
  weekendEvening: `Just so you know, on weekend evenings we offer a special prix fixe menu that's quite popular - three courses for $65 per person. Would you like me to add that to your reservation?`,
  
  winePairing: `Our sommelier has put together some excellent wine pairings for that dish. Would you like me to note any wine preferences for your server?`,
  
  returningCustomer: `I see you enjoyed {previous_favorite} last time. Our chef just added a new {related_dish} that I think you might love. Would you like me to make a note for your server to tell you about it?`,
};

export function selectUpsellPrompt(context: ConversationContext): string | null {
  const pendingBooking = context.pendingActions.find(a => a.type === 'create_booking');
  
  if (!pendingBooking) return null;

  const { partySize, specialRequests, date } = pendingBooking.data;

  // Large party upsell
  if (partySize >= 6) {
    return UPSELL_PROMPTS.largePary;
  }

  // Special occasion upsell
  if (specialRequests?.toLowerCase().includes('birthday') || 
      specialRequests?.toLowerCase().includes('anniversary')) {
    return UPSELL_PROMPTS.specialOccasion;
  }

  // Weekend evening upsell
  if (date) {
    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6) { // Friday or Saturday
      return UPSELL_PROMPTS.weekendEvening;
    }
  }

  // Returning customer with preferences
  if (context.customer?.preferences?.favoriteDishes?.length > 0) {
    return UPSELL_PROMPTS.returningCustomer
      .replace('{previous_favorite}', context.customer.preferences.favoriteDishes[0])
      .replace('{related_dish}', 'seasonal special');
  }

  return null;
}
