import { PrismaClient, Industry, Plan, UserRole } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'demo-restaurant' },
    update: {},
    create: {
      name: "Mario's Italian Kitchen",
      industry: Industry.RESTAURANT,
      subdomain: 'demo-restaurant',
      plan: Plan.GROWTH,
      timezone: 'America/New_York',
      config: {
        businessType: 'restaurant',
        cuisineType: 'Italian',
        seatingCapacity: 80,
        averageBookingDuration: 90,
        maxPartySize: 12,
        minAdvanceBooking: 1,
        maxAdvanceBooking: 30,
        autoConfirmBookings: true,
      },
      operatingHours: {
        monday: { open: '11:00', close: '22:00' },
        tuesday: { open: '11:00', close: '22:00' },
        wednesday: { open: '11:00', close: '22:00' },
        thursday: { open: '11:00', close: '23:00' },
        friday: { open: '11:00', close: '23:30' },
        saturday: { open: '10:00', close: '23:30' },
        sunday: { open: '10:00', close: '21:00' },
      },
      minutesIncluded: 2000,
    },
  });

  console.log(`✅ Created tenant: ${tenant.name}`);

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.com',
      passwordHash: await hashPassword('demo123'),
      name: 'Demo Admin',
      role: UserRole.OWNER,
    },
  });

  console.log(`✅ Created admin user: ${adminUser.email}`);

  // Create sample menu items
  const menuItems = [
    {
      name: 'Bruschetta Classica',
      description: 'Toasted bread topped with fresh tomatoes, garlic, basil, and olive oil',
      category: 'appetizer',
      price: 12.99,
      isVegetarian: true,
      isPopular: true,
    },
    {
      name: 'Calamari Fritti',
      description: 'Crispy fried calamari served with marinara sauce and lemon',
      category: 'appetizer',
      price: 16.99,
      isPopular: true,
    },
    {
      name: 'Spaghetti Carbonara',
      description: 'Classic Roman pasta with pancetta, egg, pecorino, and black pepper',
      category: 'main',
      price: 24.99,
      isChefSpecial: true,
    },
    {
      name: 'Risotto ai Funghi',
      description: 'Creamy Arborio rice with wild mushrooms and truffle oil',
      category: 'main',
      price: 26.99,
      isVegetarian: true,
    },
    {
      name: 'Ossobuco alla Milanese',
      description: 'Braised veal shanks with gremolata, served with saffron risotto',
      category: 'main',
      price: 38.99,
      isChefSpecial: true,
    },
    {
      name: 'Margherita Pizza',
      description: 'San Marzano tomatoes, fresh mozzarella, basil, extra virgin olive oil',
      category: 'main',
      price: 18.99,
      isVegetarian: true,
      isPopular: true,
    },
    {
      name: 'Grilled Salmon',
      description: 'Atlantic salmon with lemon herb butter, seasonal vegetables',
      category: 'main',
      price: 32.99,
      isGlutenFree: true,
    },
    {
      name: 'Tiramisu',
      description: 'Classic Italian dessert with espresso-soaked ladyfingers and mascarpone',
      category: 'dessert',
      price: 10.99,
      isPopular: true,
    },
    {
      name: 'Panna Cotta',
      description: 'Vanilla bean cream with berry compote',
      category: 'dessert',
      price: 9.99,
      isGlutenFree: true,
    },
    {
      name: 'House Red Wine',
      description: 'Chianti Classico, Tuscany - by the glass',
      category: 'drink',
      price: 12.99,
    },
    {
      name: 'House White Wine',
      description: 'Pinot Grigio, Veneto - by the glass',
      category: 'drink',
      price: 11.99,
    },
    {
      name: 'Espresso',
      description: 'Double shot of Italian espresso',
      category: 'drink',
      price: 4.99,
    },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { 
        id: `${tenant.id}-${item.name.toLowerCase().replace(/\s+/g, '-')}` 
      },
      update: item,
      create: {
        id: `${tenant.id}-${item.name.toLowerCase().replace(/\s+/g, '-')}`,
        tenantId: tenant.id,
        ...item,
        allergens: [],
      },
    });
  }

  console.log(`✅ Created ${menuItems.length} menu items`);

  // Create sample customers
  const customers = [
    {
      phone: '+15551234567',
      name: 'Sarah Johnson',
      email: 'sarah@example.com',
      isVip: true,
      preferences: {
        favoriteTable: 'window',
        dietaryRestrictions: ['vegetarian'],
        preferredTime: '19:00',
        favoriteDishes: ['Risotto ai Funghi', 'Tiramisu'],
      },
      callCount: 12,
      bookingCount: 8,
    },
    {
      phone: '+15559876543',
      name: 'Michael Chen',
      email: 'mchen@example.com',
      isVip: false,
      preferences: {
        preferredTime: '20:00',
        specialOccasions: ['anniversary in March'],
      },
      callCount: 5,
      bookingCount: 3,
    },
    {
      phone: '+15555555555',
      name: 'Emily Davis',
      email: 'emily.d@example.com',
      isVip: true,
      preferences: {
        allergies: ['shellfish'],
        preferredTime: '18:30',
        notes: 'Prefers quiet corner tables',
      },
      callCount: 20,
      bookingCount: 15,
    },
  ];

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone: customer.phone } },
      update: customer,
      create: {
        tenantId: tenant.id,
        ...customer,
        lifetimeValue: customer.bookingCount * 75,
      },
    });
  }

  console.log(`✅ Created ${customers.length} sample customers`);

  // Create default prompts
  const prompts = [
    {
      name: 'greeting',
      type: 'greeting',
      content: `Thank you for calling {business_name}! This is our AI assistant. How can I help you today?`,
    },
    {
      name: 'returning_customer_greeting',
      type: 'greeting',
      content: `Welcome back, {customer_name}! Great to hear from you again. How can I help you today?`,
    },
    {
      name: 'booking_confirmation',
      type: 'booking',
      content: `Perfect! I've booked a table for {party_size} on {date} at {time}. You'll receive a confirmation text shortly. Is there anything else I can help with?`,
    },
    {
      name: 'upsell_special_occasion',
      type: 'upsell',
      content: `That sounds like a special occasion! Would you like me to arrange a complimentary dessert or perhaps reserve our private dining area for an additional $50?`,
    },
    {
      name: 'closing',
      type: 'closing',
      content: `Thank you for calling {business_name}. We look forward to seeing you! Have a wonderful day.`,
    },
  ];

  for (const prompt of prompts) {
    await prisma.customPrompt.upsert({
      where: { 
        tenantId_name_version: { 
          tenantId: tenant.id, 
          name: prompt.name,
          version: 1
        } 
      },
      update: prompt,
      create: {
        tenantId: tenant.id,
        ...prompt,
      },
    });
  }

  console.log(`✅ Created ${prompts.length} default prompts`);

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
