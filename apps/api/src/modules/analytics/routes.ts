import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@voicedesk/database';
import { UnauthorizedError } from '../../shared/errors.js';

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired token');
    }
  });

  // Dashboard overview
  fastify.get('/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { period = '7d' } = request.query as any;

    const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const [
      totalCalls,
      completedCalls,
      totalBookings,
      revenueData,
      avgSentiment,
    ] = await Promise.all([
      // Total calls in period
      prisma.call.count({
        where: { tenantId, createdAt: { gte: startDate } },
      }),

      // Completed calls
      prisma.call.count({
        where: { tenantId, status: 'COMPLETED', createdAt: { gte: startDate } },
      }),

      // Total bookings from calls
      prisma.booking.count({
        where: { tenantId, createdAt: { gte: startDate } },
      }),

      // Revenue attribution
      prisma.call.aggregate({
        where: { tenantId, createdAt: { gte: startDate } },
        _sum: { revenueImpact: true },
      }),

      // Average sentiment
      prisma.call.aggregate({
        where: { tenantId, sentiment: { not: null }, createdAt: { gte: startDate } },
        _avg: { sentiment: true },
      }),
    ]);

    // Calculate metrics
    const completionRate = totalCalls > 0 ? (completedCalls / totalCalls) * 100 : 0;
    const conversionRate = completedCalls > 0 ? (totalBookings / completedCalls) * 100 : 0;

    return {
      success: true,
      data: {
        period: { days: periodDays, startDate: startDate.toISOString() },
        calls: {
          total: totalCalls,
          completed: completedCalls,
          completionRate: Math.round(completionRate * 10) / 10,
        },
        bookings: {
          total: totalBookings,
          conversionRate: Math.round(conversionRate * 10) / 10,
        },
        revenue: {
          attributed: revenueData._sum.revenueImpact || 0,
        },
        satisfaction: {
          averageSentiment: avgSentiment._avg.sentiment 
            ? Math.round(avgSentiment._avg.sentiment * 100) / 100 
            : null,
        },
      },
    };
  });

  // Call volume by hour
  fastify.get('/calls/by-hour', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { date } = request.query as any;

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: { createdAt: true },
    });

    // Group by hour
    const hourlyData = Array(24).fill(0);
    calls.forEach(call => {
      const hour = new Date(call.createdAt).getHours();
      hourlyData[hour]++;
    });

    return {
      success: true,
      data: hourlyData.map((count, hour) => ({
        hour,
        label: `${hour.toString().padStart(2, '0')}:00`,
        count,
      })),
    };
  });

  // Outcome distribution
  fastify.get('/calls/outcomes', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { period = '7d' } = request.query as any;

    const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const outcomes = await prisma.call.groupBy({
      by: ['outcome'],
      where: {
        tenantId,
        createdAt: { gte: startDate },
        outcome: { not: null },
      },
      _count: true,
    });

    return {
      success: true,
      data: outcomes.map(o => ({
        outcome: o.outcome,
        count: o._count,
      })),
    };
  });

  // Top customers
  fastify.get('/customers/top', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { limit = '10' } = request.query as any;

    const customers = await prisma.customer.findMany({
      where: { tenantId },
      orderBy: { lifetimeValue: 'desc' },
      take: parseInt(limit),
      select: {
        id: true,
        name: true,
        phone: true,
        isVip: true,
        lifetimeValue: true,
        callCount: true,
        bookingCount: true,
      },
    });

    return {
      success: true,
      data: customers,
    };
  });

  // Intent distribution
  fastify.get('/calls/intents', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { period = '7d' } = request.query as any;

    const periodDays = period === '30d' ? 30 : period === '90d' ? 90 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate },
      },
      select: { intents: true },
    });

    const callsWithIntents = calls.filter(
      (c) => c.intents !== null && c.intents !== undefined
    );

    // Aggregate intents
    const intentCounts: Record<string, number> = {};
    callsWithIntents.forEach((call) => {
      const intents = call.intents as any[];
      if (Array.isArray(intents)) {
        intents.forEach((intent) => {
          const key = intent.intent || intent;
          intentCounts[key] = (intentCounts[key] || 0) + 1;
        });
      }
    });

    const sorted = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([intent, count]) => ({ intent, count }));

    return {
      success: true,
      data: sorted,
    };
  });

  // Daily trends
  fastify.get('/trends/daily', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;
    const { period = '30d' } = request.query as any;

    const periodDays = parseInt(period) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
        status: true,
        outcome: true,
        revenueImpact: true,
      },
    });

    const bookings = await prisma.booking.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate },
      },
      select: {
        createdAt: true,
        status: true,
      },
    });

    // Group by day
    const dailyData: Record<string, { calls: number; completed: number; bookings: number; revenue: number }> = {};

    calls.forEach(call => {
      const day = new Date(call.createdAt).toISOString().split('T')[0];
      if (!dailyData[day]) {
        dailyData[day] = { calls: 0, completed: 0, bookings: 0, revenue: 0 };
      }
      dailyData[day].calls++;
      if (call.status === 'COMPLETED') dailyData[day].completed++;
      if (call.revenueImpact) dailyData[day].revenue += Number(call.revenueImpact);
    });

    bookings.forEach(booking => {
      const day = new Date(booking.createdAt).toISOString().split('T')[0];
      if (!dailyData[day]) {
        dailyData[day] = { calls: 0, completed: 0, bookings: 0, revenue: 0 };
      }
      if (booking.status === 'confirmed') dailyData[day].bookings++;
    });

    // Convert to array sorted by date
    const sorted = Object.entries(dailyData)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({ date, ...data }));

    return {
      success: true,
      data: sorted,
    };
  });

  // A/B test results
  fastify.get('/ab-tests', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const tests = await prisma.aBTest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      data: tests.map(test => ({
        ...test,
        variantARate: test.variantACalls > 0 
          ? (test.variantASuccess / test.variantACalls) * 100 
          : 0,
        variantBRate: test.variantBCalls > 0 
          ? (test.variantBSuccess / test.variantBCalls) * 100 
          : 0,
      })),
    };
  });

  // Usage statistics
  fastify.get('/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = request.user as any;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        minutesUsed: true,
        minutesIncluded: true,
        plan: true,
      },
    });

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' });
    }

    const usagePercent = (tenant.minutesUsed / tenant.minutesIncluded) * 100;

    return {
      success: true,
      data: {
        plan: tenant.plan,
        minutesUsed: tenant.minutesUsed,
        minutesIncluded: tenant.minutesIncluded,
        minutesRemaining: Math.max(0, tenant.minutesIncluded - tenant.minutesUsed),
        usagePercent: Math.round(usagePercent * 10) / 10,
      },
    };
  });
}
