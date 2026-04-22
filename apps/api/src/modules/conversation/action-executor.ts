import type { ConversationContext, ActionResult, BookingSlot } from '@voicedesk/shared-types';
import { prisma } from '@voicedesk/database';
import { logger } from '../../shared/logger.js';

export class ActionExecutor {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async execute(
    actionType: string,
    data: Record<string, any>,
    context: ConversationContext
  ): Promise<ActionResult> {
    logger.info({ actionType, data }, 'Executing action');

    try {
      switch (actionType) {
        case 'check_availability':
          return await this.checkAvailability(
            data as { date: string; time: string; partySize: number }
          );

        case 'create_booking':
          return await this.createBooking(data, context);

        case 'modify_booking':
          return await this.modifyBooking(
            data as {
              bookingId: string;
              date?: string;
              time?: string;
              partySize?: number;
              specialRequests?: string;
            }
          );

        case 'cancel_booking':
          return await this.cancelBooking(
            data as { bookingId?: string; phone?: string; date?: string; time?: string }
          );

        case 'get_menu_info':
          return await this.getMenuInfo(
            data as { query: string; category?: string; dietaryFilter?: string }
          );

        case 'get_operating_hours':
          return await this.getOperatingHours(data);

        case 'transfer_to_human':
          return await this.initiateTransfer(
            data as { reason: string; priority?: string; summary?: string },
            context
          );

        case 'add_to_waitlist':
          return await this.addToWaitlist(data, context);

        default:
          logger.warn({ actionType }, 'Unknown action type');
          return { success: false, error: `Unknown action: ${actionType}` };
      }
    } catch (error: any) {
      logger.error({ error, actionType }, 'Action execution failed');
      return { success: false, error: error.message };
    }
  }

  private async checkAvailability(data: {
    date: string;
    time: string;
    partySize: number;
  }): Promise<ActionResult> {
    const { date, time, partySize } = data;

    // Get tenant config
    const tenant = await prisma.tenant.findUnique({
      where: { id: this.tenantId },
      select: { config: true, operatingHours: true },
    });

    if (!tenant) {
      return { success: false, error: 'Configuration not found' };
    }

    const config = tenant.config as any;
    const maxPartySize = config?.maxPartySize || 10;

    // Check party size
    if (partySize > maxPartySize) {
      return {
        success: true,
        data: { available: false },
        message: `I'm sorry, we can only accommodate parties up to ${maxPartySize} guests. For larger groups, you may want to speak with our manager about private dining options.`,
      };
    }

    // Check operating hours
    const requestedDate = new Date(date);
    const dayOfWeek = requestedDate
      .toLocaleDateString('en-US', { weekday: 'long' })
      .toLowerCase();
    const hours = (tenant.operatingHours as any)?.[dayOfWeek];

    if (!hours) {
      return {
        success: true,
        data: { available: false },
        message: `I'm sorry, we're closed on ${requestedDate.toLocaleDateString('en-US', { weekday: 'long' })}s.`,
      };
    }

    // Check if time is within hours
    const [openHour, openMin] = hours.open.split(':').map(Number);
    const [closeHour, closeMin] = hours.close.split(':').map(Number);
    const [reqHour, reqMin] = time.split(':').map(Number);

    const openMinutes = openHour * 60 + openMin;
    const closeMinutes = closeHour * 60 + closeMin;
    const reqMinutes = reqHour * 60 + reqMin;

    if (reqMinutes < openMinutes || reqMinutes > closeMinutes - 90) {
      return {
        success: true,
        data: { available: false },
        message: `I'm sorry, that time isn't available. We're open from ${hours.open} to ${hours.close}. Would you like to try a different time?`,
      };
    }

    // Check existing bookings
    const existingBookings = await prisma.booking.count({
      where: {
        tenantId: this.tenantId,
        date: requestedDate,
        time: time,
        status: { in: ['confirmed', 'pending'] },
      },
    });

    const capacity = config?.seatingCapacity || 50;
    const maxConcurrentBookings = Math.floor(capacity / 4); // Rough estimate

    if (existingBookings >= maxConcurrentBookings) {
      // Find alternative times
      const alternatives = await this.findAlternativeTimes(date, time, partySize);
      
      return {
        success: true,
        data: { available: false, alternatives },
        message: `That time is fully booked, but I have availability at ${alternatives.slice(0, 2).map(a => a.time).join(' or ')}. Would either of those work for you?`,
      };
    }

    return {
      success: true,
      data: { available: true },
      message: `Great news! We have availability for ${partySize} guests on ${requestedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${time}. Would you like me to book that for you?`,
    };
  }

  private async findAlternativeTimes(
    date: string,
    preferredTime: string,
    partySize: number
  ): Promise<BookingSlot[]> {
    const [prefHour] = preferredTime.split(':').map(Number);
    const alternatives: BookingSlot[] = [];

    // Check 30 min before and after
    const times = [
      `${(prefHour - 1).toString().padStart(2, '0')}:30`,
      `${prefHour.toString().padStart(2, '0')}:30`,
      `${(prefHour + 1).toString().padStart(2, '0')}:00`,
      `${(prefHour + 1).toString().padStart(2, '0')}:30`,
    ];

    for (const time of times) {
      const bookings = await prisma.booking.count({
        where: {
          tenantId: this.tenantId,
          date: new Date(date),
          time,
          status: { in: ['confirmed', 'pending'] },
        },
      });

      if (bookings < 10) {
        alternatives.push({ time, available: true });
      }
    }

    return alternatives;
  }

  private async createBooking(
    data: Record<string, any>,
    context: ConversationContext
  ): Promise<ActionResult> {
    const { date, time, partySize, guestName, guestPhone, guestEmail, specialRequests, occasion } = data;

    // Validate required fields
    if (!date || !time || !partySize || !guestName) {
      const missing = [];
      if (!date) missing.push('date');
      if (!time) missing.push('time');
      if (!partySize) missing.push('party size');
      if (!guestName) missing.push('name');

      return {
        success: false,
        message: `I just need a few more details. Could you please provide your ${missing.join(' and ')}?`,
      };
    }

    const booking = await prisma.booking.create({
      data: {
        tenantId: this.tenantId,
        customerId: context.customer?.id,
        callId: context.callId,
        date: new Date(date),
        time,
        partySize: Number(partySize),
        guestName,
        guestPhone: guestPhone || context.customer?.phone || '',
        guestEmail,
        specialRequests,
        occasion,
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });

    // Update customer booking count
    if (context.customer?.id) {
      await prisma.customer.update({
        where: { id: context.customer.id },
        data: { bookingCount: { increment: 1 } },
      });
    }

    const dateStr = new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    return {
      success: true,
      data: { bookingId: booking.id },
      message: `Perfect! I've booked a table for ${partySize} under ${guestName} on ${dateStr} at ${time}. You'll receive a confirmation text shortly. Is there anything else I can help with?`,
    };
  }

  private async modifyBooking(data: {
    bookingId: string;
    date?: string;
    time?: string;
    partySize?: number;
    specialRequests?: string;
  }): Promise<ActionResult> {
    const { bookingId, ...updates } = data;

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, tenantId: this.tenantId },
    });

    if (!booking) {
      return {
        success: false,
        message: "I couldn't find that reservation. Could you verify the booking details or the phone number it was made under?",
      };
    }

    const updateData: any = {};
    if (updates.date) updateData.date = new Date(updates.date);
    if (updates.time) updateData.time = updates.time;
    if (updates.partySize) updateData.partySize = updates.partySize;
    if (updates.specialRequests) updateData.specialRequests = updates.specialRequests;

    await prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
    });

    return {
      success: true,
      message: "I've updated your reservation. Is there anything else you'd like to change?",
    };
  }

  private async cancelBooking(data: {
    bookingId?: string;
    phone?: string;
    date?: string;
  }): Promise<ActionResult> {
    let booking;

    if (data.bookingId) {
      booking = await prisma.booking.findFirst({
        where: { id: data.bookingId, tenantId: this.tenantId },
      });
    } else if (data.phone && data.date) {
      booking = await prisma.booking.findFirst({
        where: {
          tenantId: this.tenantId,
          guestPhone: data.phone,
          date: new Date(data.date),
          status: 'confirmed',
        },
      });
    }

    if (!booking) {
      return {
        success: false,
        message: "I couldn't find a reservation matching those details. Could you provide the phone number or date for the booking?",
      };
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    });

    return {
      success: true,
      message: "I've cancelled your reservation. We hope to see you again soon. Is there anything else I can help with?",
    };
  }

  private async getMenuInfo(data: { query: string; category?: string; dietaryFilter?: string }): Promise<ActionResult> {
    const { query, category, dietaryFilter } = data;

    const where: any = { tenantId: this.tenantId, isAvailable: true };

    if (category) {
      where.category = category;
    }

    if (dietaryFilter === 'vegetarian') {
      where.isVegetarian = true;
    } else if (dietaryFilter === 'vegan') {
      where.isVegan = true;
    } else if (dietaryFilter === 'gluten-free') {
      where.isGlutenFree = true;
    }

    const items = await prisma.menuItem.findMany({
      where: {
        ...where,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 5,
    });

    if (items.length === 0) {
      // Try broader search
      const allItems = await prisma.menuItem.findMany({
        where: { tenantId: this.tenantId, isAvailable: true },
        take: 10,
      });

      if (query.toLowerCase().includes('special') || query.toLowerCase().includes('recommend')) {
        const specials = allItems.filter(i => i.isChefSpecial || i.isPopular);
        if (specials.length > 0) {
          const itemList = specials.map(i => `${i.name} at $${i.price}`).join(', ');
          return {
            success: true,
            data: { items: specials },
            message: `Our specials include ${itemList}. Would you like more details on any of these?`,
          };
        }
      }

      return {
        success: true,
        data: { items: [] },
        message: "I couldn't find specific items matching that. Could you tell me more about what you're looking for?",
      };
    }

    const itemDescriptions = items.map(item => {
      let desc = `${item.name} - $${item.price}`;
      if (item.isChefSpecial) desc += ' (Chef\'s Special)';
      if (item.isPopular) desc += ' (Popular)';
      return desc;
    }).join('. ');

    return {
      success: true,
      data: { items },
      message: itemDescriptions,
    };
  }

  private async getOperatingHours(data: { day?: string }): Promise<ActionResult> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: this.tenantId },
      select: { operatingHours: true },
    });

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    const hours = tenant.operatingHours as Record<string, any>;

    if (data.day) {
      const dayHours = hours[data.day.toLowerCase()];
      if (!dayHours) {
        return {
          success: true,
          message: `We're closed on ${data.day}s.`,
        };
      }
      return {
        success: true,
        message: `On ${data.day}s we're open from ${dayHours.open} to ${dayHours.close}.`,
      };
    }

    // Format all hours
    const formatted = Object.entries(hours)
      .filter(([, h]) => h !== null)
      .map(([day, h]: [string, any]) => `${day}: ${h.open}-${h.close}`)
      .join(', ');

    return {
      success: true,
      data: { hours },
      message: `Our hours are ${formatted}.`,
    };
  }

  private async initiateTransfer(
    data: { reason: string; priority?: string; summary?: string },
    context: ConversationContext
  ): Promise<ActionResult> {
    logger.info({ reason: data.reason, tenantId: this.tenantId }, 'Transfer initiated');

    return {
      success: true,
      data: { transferring: true },
      message: "I'll connect you with a team member right away. Please hold for just a moment.",
    };
  }

  private async addToWaitlist(
    data: Record<string, any>,
    context: ConversationContext
  ): Promise<ActionResult> {
    const { date, time, partySize, guestName, guestPhone } = data;

    // For now, create a booking with 'waitlist' status
    await prisma.booking.create({
      data: {
        tenantId: this.tenantId,
        customerId: context.customer?.id,
        date: new Date(date),
        time,
        partySize,
        guestName,
        guestPhone: guestPhone || context.customer?.phone || '',
        status: 'waitlist',
      },
    });

    return {
      success: true,
      message: "I've added you to our waitlist. We'll call you as soon as a table becomes available. Is there anything else I can help with?",
    };
  }
}
