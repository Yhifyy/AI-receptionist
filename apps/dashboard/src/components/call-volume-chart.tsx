'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { api } from '@/lib/api';
import { format, subDays } from 'date-fns';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export function CallVolumeChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'trends'],
    queryFn: () => api.get('/analytics/trends/daily?period=7'),
  });

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const trends = data?.data || [];
  
  // Fill in missing days
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    return format(date, 'yyyy-MM-dd');
  });

  const chartData = {
    labels: last7Days.map(d => format(new Date(d), 'EEE')),
    datasets: [
      {
        label: 'Calls',
        data: last7Days.map(date => {
          const dayData = trends.find((t: any) => t.date === date);
          return dayData?.calls || 0;
        }),
        backgroundColor: 'rgba(14, 165, 233, 0.8)',
        borderRadius: 4,
      },
      {
        label: 'Bookings',
        data: last7Days.map(date => {
          const dayData = trends.find((t: any) => t.date === date);
          return dayData?.bookings || 0;
        }),
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
        },
      },
    },
  };

  return (
    <div className="h-64">
      <Bar data={chartData} options={options} />
    </div>
  );
}
