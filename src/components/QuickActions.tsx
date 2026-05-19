import React from 'react';
import { Plus, Import, BarChart3, Download, Settings, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const QuickActions: React.FC = () => {
  const navigate = useNavigate();

  const handleAction = (actionName: string) => {
    switch (actionName) {
      case 'New Trade':
        navigate('/tradingview');
        break;
      case 'Import Data':
        alert('Import Data feature - Coming soon!');
        break;
      case 'Analytics':
        navigate('/admin');
        break;
      case 'Export Report':
        alert('Export Report feature - Coming soon!');
        break;
      case 'Settings':
        navigate('/admin');
        break;
      case 'Risk Check':
        alert('Risk Check feature - Coming soon!');
        break;
      default:
        break;
    }
  };

  const actions = [
    { name: 'New Trade', icon: Plus, color: 'emerald' },
    { name: 'Import Data', icon: Import, color: 'blue' },
    { name: 'Analytics', icon: BarChart3, color: 'purple' },
    { name: 'Export Report', icon: Download, color: 'orange' },
    { name: 'Settings', icon: Settings, color: 'gray' },
    { name: 'Risk Check', icon: AlertTriangle, color: 'red' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
        Quick Actions
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action, index) => {
          const Icon = action.icon;
          const colorClasses = {
            emerald: 'bg-emerald-500 hover:bg-emerald-600',
            blue: 'bg-blue-500 hover:bg-blue-600',
            purple: 'bg-purple-500 hover:bg-purple-600',
            orange: 'bg-orange-500 hover:bg-orange-600',
            gray: 'bg-gray-500 hover:bg-gray-600',
            red: 'bg-red-500 hover:bg-red-600',
          };

          return (
            <button
              key={index}
              onClick={() => handleAction(action.name)}
              className={`p-4 rounded-lg text-white text-sm font-medium transition-colors duration-200 ${
                colorClasses[action.color as keyof typeof colorClasses]
              }`}
            >
              <Icon className="w-5 h-5 mx-auto mb-2" />
              {action.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default QuickActions;