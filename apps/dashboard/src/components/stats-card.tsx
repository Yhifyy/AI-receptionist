import { ComponentType } from 'react';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/solid';
import clsx from 'clsx';

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: ComponentType<{ className?: string }>;
}

export function StatsCard({ title, value, change, trend, icon: Icon }: StatsCardProps) {
  return (
    <div className="card p-6">
      <div className="flex items-center">
        <div className="flex-shrink-0">
          <div className="p-3 bg-primary-100 rounded-lg">
            <Icon className="h-6 w-6 text-primary-600" />
          </div>
        </div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
            <dd className="flex items-baseline">
              <div className="text-2xl font-semibold text-gray-900">{value}</div>
              {change && (
                <div className={clsx(
                  'ml-2 flex items-baseline text-sm font-medium',
                  trend === 'up' && 'text-green-600',
                  trend === 'down' && 'text-red-600',
                  trend === 'neutral' && 'text-gray-500'
                )}>
                  {trend === 'up' && <ArrowUpIcon className="h-4 w-4 flex-shrink-0 self-center" />}
                  {trend === 'down' && <ArrowDownIcon className="h-4 w-4 flex-shrink-0 self-center" />}
                  <span className="ml-1">{change}</span>
                </div>
              )}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
