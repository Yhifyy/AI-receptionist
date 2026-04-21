import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { billingService, PLANS } from './service.js';
import { UnauthorizedError, ForbiddenError } from '../../shared/errors.js';

const createSubscriptionSchema = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'PRO']),
  paymentMethodId: z.string().optional(),
});

const changePlanSchema = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'PRO']),
});

export async function registerBillingRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired token');
    }
  });

  // Get available plans
  fastify.get('/plans', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      success: true,
      data: Object.entries(PLANS).map(([key, plan]) => ({
        id: key,
        ...plan,
      })),
    };
  });

  // Get current subscription
  fastify.get('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        plan: true,
        minutesUsed: true,
        minutesIncluded: true,
        stripeCustomerId: true,
      },
    });

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    const planConfig = PLANS[tenant.plan as keyof typeof PLANS];

    return {
      success: true,
      data: {
        plan: tenant.plan,
        planDetails: planConfig,
        usage: {
          minutesUsed: tenant.minutesUsed,
          minutesIncluded: tenant.minutesIncluded,
          percentUsed: Math.round((tenant.minutesUsed / tenant.minutesIncluded) * 100),
        },
        hasBillingAccount: !!tenant.stripeCustomerId,
      },
    };
  });

  // Create subscription
  fastify.post('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER') {
      throw new ForbiddenError('Only owners can manage billing');
    }

    const body = createSubscriptionSchema.parse(request.body);

    const result = await billingService.createSubscription(
      tenantId,
      body.plan,
      body.paymentMethodId
    );

    return {
      success: true,
      data: result,
    };
  });

  // Change plan
  fastify.patch('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER') {
      throw new ForbiddenError('Only owners can manage billing');
    }

    const body = changePlanSchema.parse(request.body);

    await billingService.changePlan(tenantId, body.plan);

    return {
      success: true,
      data: { message: 'Plan updated successfully' },
    };
  });

  // Cancel subscription
  fastify.delete('/subscription', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER') {
      throw new ForbiddenError('Only owners can manage billing');
    }

    await billingService.cancelSubscription(tenantId);

    return {
      success: true,
      data: { message: 'Subscription cancelled' },
    };
  });

  // Get invoices
  fastify.get('/invoices', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const invoices = await billingService.getInvoices(tenantId);

    return {
      success: true,
      data: invoices,
    };
  });

  // Get payment methods
  fastify.get('/payment-methods', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const methods = await billingService.getPaymentMethods(tenantId);

    return {
      success: true,
      data: methods,
    };
  });

  // Create billing portal session
  fastify.post('/portal', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId, role } = request.user as any;

    if (role !== 'OWNER') {
      throw new ForbiddenError('Only owners can access billing portal');
    }

    const url = await billingService.createPortalSession(tenantId);

    return {
      success: true,
      data: { url },
    };
  });
}
