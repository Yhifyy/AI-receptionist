import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@voicedesk/database';
import * as crypto from 'crypto';
import { UnauthorizedError, ValidationError } from '../../shared/errors.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  tenantSubdomain: z.string().optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  businessName: z.string().min(2),
  industry: z.enum(['RESTAURANT', 'SALON', 'HOTEL', 'RETAIL']),
  subdomain: z.string().min(3).max(30).regex(/^[a-z0-9-]+$/),
});

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function registerAuthRoutes(fastify: FastifyInstance) {
  // Login
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);

    const user = await prisma.user.findFirst({
      where: {
        email: body.email,
        isActive: true,
      },
      include: {
        tenant: true,
      },
    });

    if (!user || user.passwordHash !== hashPassword(body.password)) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = fastify.jwt.sign({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          subdomain: user.tenant.subdomain,
          industry: user.tenant.industry,
          plan: user.tenant.plan,
        },
      },
    };
  });

  // Register new tenant
  fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(request.body);

    // Check if subdomain is taken
    const existingTenant = await prisma.tenant.findUnique({
      where: { subdomain: body.subdomain },
    });

    if (existingTenant) {
      throw new ValidationError('Subdomain is already taken');
    }

    // Check if email is taken
    const existingUser = await prisma.user.findFirst({
      where: { email: body.email },
    });

    if (existingUser) {
      throw new ValidationError('Email is already registered');
    }

    // Create tenant and user in transaction
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: body.businessName,
          industry: body.industry,
          subdomain: body.subdomain,
          config: getDefaultConfig(body.industry),
          operatingHours: getDefaultHours(),
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: body.email,
          passwordHash: hashPassword(body.password),
          name: body.name,
          role: 'OWNER',
        },
      });

      return { tenant, user };
    });

    const token = fastify.jwt.sign({
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      role: result.user.role,
    });

    reply.status(201);
    return {
      success: true,
      data: {
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
          subdomain: result.tenant.subdomain,
          industry: result.tenant.industry,
          plan: result.tenant.plan,
        },
      },
    };
  });

  // Get current user
  fastify.get('/me', {
    preHandler: [authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, tenantId } = request.user as any;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          subdomain: user.tenant.subdomain,
          industry: user.tenant.industry,
          plan: user.tenant.plan,
          config: user.tenant.config,
        },
      },
    };
  });

  // Refresh token
  fastify.post('/refresh', {
    preHandler: [authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, tenantId, email, role } = request.user as any;

    const token = fastify.jwt.sign({
      userId,
      tenantId,
      email,
      role,
    });

    return {
      success: true,
      data: { token },
    };
  });
}

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

function getDefaultConfig(industry: string): Record<string, any> {
  const configs: Record<string, any> = {
    RESTAURANT: {
      businessType: 'restaurant',
      seatingCapacity: 50,
      averageBookingDuration: 90,
      maxPartySize: 10,
      minAdvanceBooking: 0,
      maxAdvanceBooking: 30,
      autoConfirmBookings: true,
    },
    SALON: {
      businessType: 'salon',
      appointmentBuffer: 15,
      maxAdvanceBooking: 60,
    },
    HOTEL: {
      businessType: 'hotel',
      checkInTime: '15:00',
      checkOutTime: '11:00',
    },
    RETAIL: {
      businessType: 'retail',
      returnPolicyDays: 30,
    },
  };

  return configs[industry] || {};
}

function getDefaultHours(): Record<string, any> {
  return {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '10:00', close: '16:00' },
    sunday: null,
  };
}
