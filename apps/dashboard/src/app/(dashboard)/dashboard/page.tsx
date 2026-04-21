'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatsCard } from '@/components/stats-card';
import { RecentCallsTable } from '@/components/recent-calls-table';
import { CallVolumeChart } from '@/components/call-volume-chart';
import {
  PhoneIcon,
  CalendarIcon,
  CurrencyDollarIcon,
  FaceSmileIcon,
} from '@heroicons/react/24/outline';

export default function DashboardPage() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => api.get('/analytics/overview?period=7d'),
  });

  const { data: recentCalls } = useQuery({
    queryKey: ['calls', 'recent'],
    queryFn: () => api.get('/calls?limit=5'),
  });

  const { data: usage } = useQuery({
    queryKey: ['analytics', 'usage'],
    queryFn: () => api.get('/analytics/usage'),
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const stats = overview?.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Overview of your AI receptionist performance
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Calls"
          value={stats?.calls?.total || 0}
          change={`${stats?.calls?.completionRate || 0}% completion`}
          icon={PhoneIcon}
          trend="up"
        />
        <StatsCard
          title="Bookings Made"
          value={stats?.bookings?.total || 0}
          change={`${stats?.bookings?.conversionRate || 0}% conversion`}
          icon={CalendarIcon}
          trend="up"
        />
        <StatsCard
          title="Revenue Impact"
          value={`$${stats?.revenue?.attributed || 0}`}
          change="From AI calls"
          icon={CurrencyDollarIcon}
          trend="up"
        />
        <StatsCard
          title="Avg. Sentiment"
          value={stats?.satisfaction?.averageSentiment?.toFixed(2) || 'N/A'}
          change="Customer satisfaction"
          icon={FaceSmileIcon}
          trend={stats?.satisfaction?.averageSentiment > 0 ? 'up' : 'down'}
        />
      </div>

      {/* Usage Bar */}
      {usage?.data && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Monthly Usage
            </span>
            <span className="text-sm text-gray-500">
              {usage.data.minutesUsed} / {usage.data.minutesIncluded} minutes
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-primary-600 h-2.5 rounded-full transition-all"
              style={{ width: `${Math.min(usage.data.usagePercent, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {usage.data.minutesRemaining} minutes remaining on {usage.data.plan} plan
          </p>
        </div>
      )}

      {/* Charts and Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Call Volume (Last 7 Days)
          </h3>
          <CallVolumeChart />
        </div>

        <div className="card p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Recent Calls
          </h3>
          <RecentCallsTable calls={recentCalls?.data || []} />
        </div>
      </div>
    </div>
  );
}
