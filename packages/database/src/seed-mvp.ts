/**
 * MVP Seed Script
 * Creates minimal data needed to test the restaurant booking flow
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

// Simple hash for MVP (use bcrypt in production)
function hashPassword(password: string): string {
  return createHash('sha256').update(password + 'voicedesk-salt').digest('hex');
}

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding MVP data...\n');

  // Create demo tenant (restaurant)
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'mvp-demo' },
    update: {
      twilioNumber: process.env.TWILIO_PHONE_NUMBER || undefined,
      voiceId: process.env.ELEVENLABS_VOICE_ID || undefined,
    },
    create: {
      name: 'Demo Italian Kitchen',
      industry: 'RESTAURANT',
      subdomain: 'mvp-demo',
      plan: 'PRO',
      timezone: 'America/New_York',
      twilioNumber: process.env.TWILIO_PHONE_NUMBER || '+15551234567',
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
      config: {
        cuisineType: 'Italian',
        maxPartySize: 10,
        reservationDuration: 90,
        operatingHours: {
          monday: { open: '11:00', close: '22:00' },
          tuesday: { open: '11:00', close: '22:00' },
          wednesday: { open: '11:00', close: '22:00' },
          thursday: { open: '11:00', close: '22:00' },
          friday: { open: '11:00', close: '23:00' },
          saturday: { open: '10:00', close: '23:00' },
          sunday: { open: '10:00', close: '21:00' },
        },
        address: '123 Main Street, New York, NY 10001',
        phone: process.env.TWILIO_PHONE_NUMBER || '+15551234567',
      },
      operatingHours: {
        monday: { open: '11:00', close: '22:00' },
        tuesday: { open: '11:00', close: '22:00' },
        wednesday: { open: '11:00', close: '22:00' },
        thursday: { open: '11:00', close: '22:00' },
        friday: { open: '11:00', close: '23:00' },
        saturday: { open: '10:00', close: '23:00' },
        sunday: { open: '10:00', close: '21:00' },
      },
    },
  });

  console.log(`✅ Created tenant: ${tenant.name} (${tenant.id})`);

  // Create admin user for the tenant
  const passwordHash = hashPassword('admin123');
  const user = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: 'admin@demo-restaurant.com',
      },
    },
    update: {},
    create: {
      email: 'admin@demo-restaurant.com',
      passwordHash,
      name: 'Demo Admin',
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });

  console.log(`✅ Created user: ${user.email}`);

  // Create some sample menu items (for menu inquiries)
  const existingItems = await prisma.menuItem.count({ where: { tenantId: tenant.id } });
  
  if (existingItems === 0) {
    const menuItems = [
      { name: 'Margherita Pizza', description: 'Fresh tomatoes, mozzarella, basil', price: 16.99, category: 'Pizza', isAvailable: true },
      { name: 'Spaghetti Carbonara', description: 'Egg, pecorino, guanciale', price: 18.99, category: 'Pasta', isAvailable: true },
      { name: 'Tiramisu', description: 'Coffee-soaked ladyfingers with mascarpone', price: 9.99, category: 'Dessert', isAvailable: true },
      { name: 'Bruschetta', description: 'Toasted bread with tomatoes and basil', price: 8.99, category: 'Appetizer', isAvailable: true },
      { name: 'Osso Buco', description: 'Braised veal shanks with gremolata', price: 32.99, category: 'Entree', isAvailable: true },
    ];

    await prisma.menuItem.createMany({
      data: menuItems.map(item => ({ ...item, tenantId: tenant.id })),
    });

    console.log(`✅ Created ${menuItems.length} menu items`);
  } else {
    console.log(`✅ Menu items already exist (${existingItems})`);
  }

  // Create a custom prompt for the restaurant
  const existingPrompt = await prisma.customPrompt.findFirst({
    where: { tenantId: tenant.id, name: 'greeting' }
  });
  
  if (!existingPrompt) {
    await prisma.customPrompt.create({
      data: {
        tenantId: tenant.id,
        name: 'greeting',
        type: 'greeting',
        content: "Thank you for calling Demo Italian Kitchen, New York's favorite Italian restaurant! How can I help you today?",
        isActive: true,
        version: 1,
      },
    });
    console.log(`✅ Created custom prompts`);
  } else {
    console.log(`✅ Custom prompts already exist`);
  }

  console.log('\n✨ MVP seed complete!\n');
  console.log('Test credentials:');
  console.log('  Email: admin@demo-restaurant.com');
  console.log('  Password: admin123');
  console.log(`  Tenant ID: ${tenant.id} (subdomain: ${tenant.subdomain})`);
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
