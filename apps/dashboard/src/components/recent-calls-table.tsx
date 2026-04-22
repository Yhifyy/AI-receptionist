import Link from 'next/link';
import { format } from 'date-fns';
import { PhoneArrowDownLeftIcon, PhoneArrowUpRightIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

export interface Call {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  fromNumber: string;
  duration: number | null;
  outcome: string | null;
  createdAt: string;
  customer?: {
    name: string | null;
    isVip: boolean;
  };
}

interface RecentCallsTableProps {
  calls: Call[];
}

export function RecentCallsTable({ calls }: RecentCallsTableProps) {
  if (calls.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No recent calls
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {calls.map((call) => (
          <li key={call.id}>
            <Link
              href={`/dashboard/calls/${call.id}`}
              className="block hover:bg-gray-50 px-2 py-3 rounded-lg transition-colors"
            >
              <div className="flex items-center space-x-4">
                <div className={clsx(
                  'flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center',
                  call.direction === 'INBOUND' ? 'bg-green-100' : 'bg-blue-100'
                )}>
                  {call.direction === 'INBOUND' ? (
                    <PhoneArrowDownLeftIcon className="h-5 w-5 text-green-600" />
                  ) : (
                    <PhoneArrowUpRightIcon className="h-5 w-5 text-blue-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {call.customer?.name || call.fromNumber}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    {call.outcome?.replace(/_/g, ' ').toLowerCase() || 'In progress'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">
                    {format(new Date(call.createdAt), 'h:mm a')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : '-'}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      
      <div className="mt-4 text-center">
        <Link
          href="/dashboard/calls"
          className="text-sm text-primary-600 hover:text-primary-500"
        >
          View all calls
        </Link>
      </div>
    </div>
  );
}
