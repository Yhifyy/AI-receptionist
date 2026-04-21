import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@voicedesk/database';
import { NotFoundError, ForbiddenError, UnauthorizedError } from '../../shared/errors.js';

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  timezone: z.string().optional(),
  config: z.record(z.any()).optional(),
  operatingHours: z.record(z.any()).optional(),
  voiceId: z.string().optional(),
  voiceName: z.string().optional(),
});

export async function registerTenantRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired token');
    }
  });

  // Get current tenant
  fastify.get('/current', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: {
          select: {
            users: true,
            calls: true,
            customers: true,
            bookings: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    return {
      success: true,
      data: {
        id: tenant.id,
        name: tenant.name,
        industry: tenant.industry,
        subdomain: tenant.subdomain,
        plan: tenant.plan,
        timezone: tenant.timezone,
        config: tenant.config,
        operatingHours: tenant.operatingHours,
        voiceId: tenant.voiceId,
        voiceName: tenant.voiceName,
        twilioNumber: tenant.twilioNumber,
        minutesUsed: tenant.minutesUsed,
        minutesIncluded: tenant.minutesIncluded,
        stats: tenant._count,
        createdAt: tenant.createdAt,
      },
    };
  });

  // Update tenant
  fastify.patch('/current', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenError('Only owners and admins can update tenant settings');
    }

    const body = updateTenantSchema.parse(request.body);

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: body,
    });

    return {
      success: true,
      data: tenant,
    };
  });

  // Get tenant users
  fastify.get('/current/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const users = await prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: users,
    };
  });

  // Get tenant customers
  fastify.get('/current/customers', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { page = '1', limit = '20', search, vipOnly } = request.query as any;

    const where: any = { tenantId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (vipOnly === 'true') {
      where.isVip = true;
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { lastCallAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      success: true,
      data: customers,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  });

  // Get single customer
  fastify.get('/current/customers/:customerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { customerId } = request.params as any;

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      include: {
        calls: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            duration: true,
            outcome: true,
            summary: true,
            sentiment: true,
          },
        },
        bookings: {
          take: 10,
          orderBy: { date: 'desc' },
          select: {
            id: true,
            date: true,
            time: true,
            partySize: true,
            status: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundError('Customer', customerId);
    }

    return {
      success: true,
      data: customer,
    };
  });

  // Update customer
  fastify.patch('/current/customers/:customerId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { customerId } = request.params as any;
    const body = request.body as any;

    const customer = await prisma.customer.updateMany({
      where: { id: customerId, tenantId },
      data: {
        name: body.name,
        email: body.email,
        isVip: body.isVip,
        preferences: body.preferences,
        notes: body.notes,
        tags: body.tags,
      },
    });

    if (customer.count === 0) {
      throw new NotFoundError('Customer', customerId);
    }

    return {
      success: true,
      data: { updated: true },
    };
  });

  // Get menu items (restaurant)
  fastify.get('/current/menu', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { category, available } = request.query as any;

    const where: any = { tenantId };

    if (category) {
      where.category = category;
    }

    if (available === 'true') {
      where.isAvailable = true;
    }

    const menuItems = await prisma.menuItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return {
      success: true,
      data: menuItems,
    };
  });

  // Create/update menu item
  fastify.post('/current/menu', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'MANAGER') {
      throw new ForbiddenError('Insufficient permissions');
    }

    const body = request.body as any;

    const menuItem = await prisma.menuItem.create({
      data: {
        tenantId,
        name: body.name,
        description: body.description,
        category: body.category,
        price: body.price,
        allergens: body.allergens || [],
        isVegetarian: body.isVegetarian || false,
        isVegan: body.isVegan || false,
        isGlutenFree: body.isGlutenFree || false,
        isAvailable: body.isAvailable ?? true,
        isPopular: body.isPopular || false,
        isChefSpecial: body.isChefSpecial || false,
      },
    });

    reply.status(201);
    return {
      success: true,
      data: menuItem,
    };
  });

  // Get bookings
  fastify.get('/current/bookings', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { page = '1', limit = '20', date, status } = request.query as any;

    const where: any = { tenantId };

    if (date) {
      where.date = new Date(date);
    }

    if (status) {
      where.status = status;
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
        include: {
          customer: {
            select: { id: true, name: true, phone: true, isVip: true },
          },
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      success: true,
      data: bookings,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  });

  // Get custom prompts
  fastify.get('/current/prompts', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const prompts = await prisma.customPrompt.findMany({
      where: { tenantId },
      orderBy: { type: 'asc' },
    });

    return {
      success: true,
      data: prompts,
    };
  });

  // Create/update prompt
  fastify.post('/current/prompts', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw new ForbiddenError('Only owners and admins can manage prompts');
    }

    const body = request.body as any;

    // Get latest version for this prompt name
    const existing = await prisma.customPrompt.findFirst({
      where: { tenantId, name: body.name },
      orderBy: { version: 'desc' },
    });

    const newVersion = existing ? existing.version + 1 : 1;

    const prompt = await prisma.customPrompt.create({
      data: {
        tenantId,
        name: body.name,
        type: body.type,
        content: body.content,
        version: newVersion,
        isActive: true,
      },
    });

    // Deactivate old versions
    if (existing) {
      await prisma.customPrompt.updateMany({
        where: { tenantId, name: body.name, version: { lt: newVersion } },
        data: { isActive: false },
      });
    }

    reply.status(201);
    return {
      success: true,
      data: prompt,
    };
  });
}
