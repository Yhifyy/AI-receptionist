'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  PhoneIcon,
  PhoneArrowDownLeftIcon,
  PhoneArrowUpRightIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

export default function CallsPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['calls', page, statusFilter],
    queryFn: () => api.get(`/calls?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}`),
  });

  const calls = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calls</h1>
          <p className="text-sm text-gray-500">
            View and manage all incoming and outgoing calls
          </p>
        </div>
        
        <button
          onClick={() => refetch()}
          className="btn btn-secondary px-4 py-2"
        >
          <ArrowPathIcon className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex gap-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input w-48"
          >
            <option value="">All Status</option>
            <option value="COMPLETED">Completed</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="FAILED">Failed</option>
            <option value="NO_ANSWER">No Answer</option>
          </select>
        </div>
      </div>

      {/* Calls Table */}
      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Call
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Duration
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Outcome
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Sentiment
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Date
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  Loading calls...
                </td>
              </tr>
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No calls found
                </td>
              </tr>
            ) : (
              calls.map((call: any) => (
                <tr key={call.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Link
                      href={`/dashboard/calls/${call.id}`}
                      className="flex items-center"
                    >
                      <div className={clsx(
                        'flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center',
                        call.direction === 'INBOUND' ? 'bg-green-100' : 'bg-blue-100'
                      )}>
                        {call.direction === 'INBOUND' ? (
                          <PhoneArrowDownLeftIcon className="h-4 w-4 text-green-600" />
                        ) : (
                          <PhoneArrowUpRightIcon className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">
                          {call.fromNumber}
                        </p>
                        <p className="text-xs text-gray-500">
                          {call.direction.toLowerCase()}
                        </p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {call.customer ? (
                      <div>
                        <p className="text-sm text-gray-900">
                          {call.customer.name || 'Unknown'}
                        </p>
                        {call.customer.isVip && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                            VIP
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500">New caller</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {call.duration ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={clsx(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      call.outcome === 'BOOKING_MADE' && 'bg-green-100 text-green-800',
                      call.outcome === 'INQUIRY_RESOLVED' && 'bg-blue-100 text-blue-800',
                      call.outcome === 'TRANSFERRED_TO_HUMAN' && 'bg-yellow-100 text-yellow-800',
                      call.outcome === 'ABANDONED' && 'bg-red-100 text-red-800',
                      !call.outcome && 'bg-gray-100 text-gray-800'
                    )}>
                      {call.outcome?.replace(/_/g, ' ').toLowerCase() || 'pending'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {call.sentiment !== null ? (
                      <div className="flex items-center">
                        <div className={clsx(
                          'h-2 w-2 rounded-full mr-2',
                          call.sentiment > 0.3 && 'bg-green-500',
                          call.sentiment <= 0.3 && call.sentiment >= -0.3 && 'bg-yellow-500',
                          call.sentiment < -0.3 && 'bg-red-500'
                        )} />
                        <span className="text-sm text-gray-500">
                          {call.sentiment.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {format(new Date(call.createdAt), 'MMM d, h:mm a')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t">
            <div className="text-sm text-gray-500">
              Showing {(page - 1) * meta.limit + 1} to {Math.min(page * meta.limit, meta.total)} of {meta.total} calls
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary px-3 py-1 text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                disabled={page === meta.totalPages}
                className="btn btn-secondary px-3 py-1 text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
