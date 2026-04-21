import { prisma } from '@voicedesk/database';
import type { BookingRequest, BookingConfirmation, BookingSlot } from '@voicedesk/shared-types';
import { logger } from '../../shared/logger.js';

export class RestaurantService {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async getAvailability(
    date: Date,
    partySize: number
  ): Promise<BookingSlot[]> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: this.tenantId },
      select: { config: true, operatingHours: true },
    });

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const config = tenant.config as any;
    const dayName = date.toLocaleDateString('en-US', { weekday: 'lowercase' });
    const hours = (tenant.operatingHours as any)?.[dayName];

    if (!hours) {
      return []; // Closed on this day
    }

    // Generate time slots
    const slots: BookingSlot[] = [];
    const [openHour, openMin] = hours.open.split(':').map(Number);
    const [closeHour, closeMin] = hours.close.split(':').map(Number);
    
    const slotDuration = 30; // 30-minute slots
    const bookingDuration = config?.averageBookingDuration || 90;

    // Get existing bookings for the date
    const existingBookings = await prisma.booking.findMany({
      where: {
        tenantId: this.tenantId,
        date: date,
        status: { in: ['confirmed', 'pending'] },
      },
      select: { time: true, partySize: true },
    });

    // Calculate capacity per slot
    const capacity = config?.seatingCapacity || 50;
    const maxPartiesPerSlot = Math.floor(capacity / 4); // Average party of 4

    const bookingsBySlot: Record<string, number> = {};
    existingBookings.forEach(b => {
      bookingsBySlot[b.time] = (bookingsBySlot[b.time] || 0) + 1;
    });

    // Generate available slots
    let currentMinutes = openHour * 60 + openMin;
    const lastBookingMinutes = closeHour * 60 + closeMin - bookingDuration;

    while (currentMinutes <= lastBookingMinutes) {
      const hour = Math.floor(currentMinutes / 60);
      const min = currentMinutes % 60;
      const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
      
      const bookedCount = bookingsBySlot[time] || 0;
      const available = bookedCount < maxPartiesPerSlot;

      slots.push({
        time,
        available,
        tableOptions: available ? await this.getTableOptions(partySize) : undefined,
      });

      currentMinutes += slotDuration;
    }

    return slots;
  }

  private async getTableOptions(partySize: number): Promise<string[]> {
    // In a real system, this would query actual table configurations
    const options: string[] = [];
    
    if (partySize <= 2) {
      options.push('Bar seating', 'Window table', 'Patio');
    } else if (partySize <= 4) {
      options.push('Booth', 'Window table', 'Patio', 'Main dining');
    } else if (partySize <= 6) {
      options.push('Large booth', 'Main dining', 'Patio');
    } else {
      options.push('Private dining room', 'Main dining (combined tables)');
    }

    return options;
  }

  async createBooking(request: BookingRequest): Promise<BookingConfirmation> {
    // Validate availability
    const availability = await this.getAvailability(
      new Date(request.date),
      request.partySize
    );

    const slot = availability.find(s => s.time === request.time);
    if (!slot?.available) {
      throw new Error('Selected time slot is no longer available');
    }

    // Create the booking
    const booking = await prisma.booking.create({
      data: {
        tenantId: this.tenantId,
        date: new Date(request.date),
        time: request.time,
        partySize: request.partySize,
        guestName: request.guestName,
        guestPhone: request.guestPhone,
        guestEmail: request.guestEmail,
        specialRequests: request.specialRequests,
        occasion: request.occasion,
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });

    // Generate confirmation code
    const confirmationCode = this.generateConfirmationCode(booking.id);

    logger.info({
      bookingId: booking.id,
      date: request.date,
      time: request.time,
      partySize: request.partySize,
    }, 'Booking created');

    return {
      id: booking.id,
      date: request.date,
      time: request.time,
      partySize: request.partySize,
      guestName: request.guestName,
      confirmationCode,
    };
  }

  private generateConfirmationCode(bookingId: string): string {
    // Generate a short, readable confirmation code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async getMenuItems(options: {
    category?: string;
    search?: string;
    dietary?: 'vegetarian' | 'vegan' | 'gluten-free';
    onlyAvailable?: boolean;
  } = {}): Promise<any[]> {
    const where: any = { tenantId: this.tenantId };

    if (options.onlyAvailable !== false) {
      where.isAvailable = true;
    }

    if (options.category) {
      where.category = options.category;
    }

    if (options.dietary === 'vegetarian') {
      where.isVegetarian = true;
    } else if (options.dietary === 'vegan') {
      where.isVegan = true;
    } else if (options.dietary === 'gluten-free') {
      where.isGlutenFree = true;
    }

    if (options.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
      ];
    }

    return prisma.menuItem.findMany({
      where,
      orderBy: [
        { isChefSpecial: 'desc' },
        { isPopular: 'desc' },
        { name: 'asc' },
      ],
    });
  }

  async getPopularItems(limit: number = 5): Promise<any[]> {
    return prisma.menuItem.findMany({
      where: {
        tenantId: this.tenantId,
        isAvailable: true,
        OR: [
          { isPopular: true },
          { isChefSpecial: true },
        ],
      },
      take: limit,
      orderBy: { isChefSpecial: 'desc' },
    });
  }

  async getItemDetails(itemName: string): Promise<any | null> {
    return prisma.menuItem.findFirst({
      where: {
        tenantId: this.tenantId,
        name: { contains: itemName, mode: 'insensitive' },
      },
    });
  }

  async getTodayBookings(): Promise<any[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return prisma.booking.findMany({
      where: {
        tenantId: this.tenantId,
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: { in: ['confirmed', 'pending'] },
      },
      include: {
        customer: {
          select: { name: true, phone: true, isVip: true },
        },
      },
      orderBy: { time: 'asc' },
    });
  }

  async getUpcomingBookings(customerId: string): Promise<any[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return prisma.booking.findMany({
      where: {
        tenantId: this.tenantId,
        customerId,
        date: { gte: today },
        status: 'confirmed',
      },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: 5,
    });
  }

  async cancelBooking(bookingId: string, reason?: string): Promise<void> {
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        specialRequests: reason 
          ? prisma.booking.fields.specialRequests + `\nCancellation reason: ${reason}`
          : undefined,
      },
    });

    logger.info({ bookingId, reason }, 'Booking cancelled');
  }

  async modifyBooking(
    bookingId: string,
    updates: Partial<BookingRequest>
  ): Promise<void> {
    const updateData: any = {};

    if (updates.date) updateData.date = new Date(updates.date);
    if (updates.time) updateData.time = updates.time;
    if (updates.partySize) updateData.partySize = updates.partySize;
    if (updates.specialRequests) updateData.specialRequests = updates.specialRequests;

    await prisma.booking.update({
      where: { id: bookingId },
      data: updateData,
    });

    logger.info({ bookingId, updates }, 'Booking modified');
  }
}

// Utility functions for restaurant operations
export function formatBookingConfirmation(booking: BookingConfirmation): string {
  const dateStr = new Date(booking.date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return `Reservation confirmed for ${booking.partySize} guests on ${dateStr} at ${booking.time}. ` +
         `Confirmation code: ${booking.confirmationCode}. Name: ${booking.guestName}.`;
}

export function parseTimePreference(text: string): string | null {
  const patterns: Array<{ pattern: RegExp; transform: (match: RegExpMatchArray) => string }> = [
    {
      pattern: /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
      transform: (match) => {
        let hour = parseInt(match[1]);
        const min = match[2];
        const meridiem = match[3]?.toLowerCase();
        
        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:${min}`;
      },
    },
    {
      pattern: /(\d{1,2})\s*(am|pm)/i,
      transform: (match) => {
        let hour = parseInt(match[1]);
        const meridiem = match[2].toLowerCase();
        
        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;
        
        return `${hour.toString().padStart(2, '0')}:00`;
      },
    },
    {
      pattern: /lunch|noon|midday/i,
      transform: () => '12:00',
    },
    {
      pattern: /dinner|evening/i,
      transform: () => '19:00',
    },
    {
      pattern: /brunch/i,
      transform: () => '11:00',
    },
  ];

  for (const { pattern, transform } of patterns) {
    const match = text.match(pattern);
    if (match) {
      return transform(match);
    }
  }

  return null;
}

export function parseDatePreference(text: string): string | null {
  const today = new Date();
  
  if (/today|tonight/i.test(text)) {
    return today.toISOString().split('T')[0];
  }
  
  if (/tomorrow/i.test(text)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  const dayMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dayMatch) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(dayMatch[1].toLowerCase());
    const todayDay = today.getDay();
    
    let daysUntil = targetDay - todayDay;
    if (daysUntil <= 0) daysUntil += 7;
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate.toISOString().split('T')[0];
  }
  
  // Try MM/DD format
  const mdMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (mdMatch) {
    const month = parseInt(mdMatch[1]);
    const day = parseInt(mdMatch[2]);
    const year = today.getFullYear();
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  }
  
  return null;
}
