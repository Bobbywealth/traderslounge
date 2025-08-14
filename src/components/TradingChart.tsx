import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';

interface ChartData {
  time: string;
  price: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

interface TradingChartProps {
  symbol?: string;
  timeframe?: string;
  height?: number;
  showVolume?: boolean;
  chartType?: 'line' | 'area' | 'candlestick';
}

const TradingChart: React.FC<TradingChartProps> = ({ 
  symbol = 'EURUSD', 
  timeframe = '1H',
  height = 400,
  showVolume = true,
  chartType = 'area'
}) => {
  const [data, setData] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [priceChange, setPriceChange] = useState(0);

  // Generate realistic trading data
  const generateTradingData = (symbol: string, points: number = 100): ChartData[] => {
    const data: ChartData[] = [];
    const basePrice = getBasePrice(symbol);
    let currentPrice = basePrice;
    const now = new Date();
    
    for (let i = points; i >= 0; i--) {
      const time = new Date(now.getTime() - i * getTimeframeMs(timeframe));
      const volatility = basePrice * 0.001; // 0.1% volatility
      
      const change = (Math.random() - 0.5) * volatility * 2;
      const open = currentPrice;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * volatility;
      const low = Math.min(open, close) - Math.random() * volatility;
      const volume = Math.random() * 1000000 + 500000;
      
      data.push({
        time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        price: parseFloat(close.toFixed(5)),
        volume: Math.floor(volume),
        high: parseFloat(high.toFixed(5)),
        low: parseFloat(low.toFixed(5)),
        open: parseFloat(open.toFixed(5)),
        close: parseFloat(close.toFixed(5)),
      });
      
      currentPrice = close;
    }
    
    return data;
  };

  const getBasePrice = (symbol: string): number => {
    const prices: Record<string, number> = {
      'EURUSD': 1.0425,
      'GBPUSD': 1.2580,
      'USDJPY': 157.25,
      'XAUUSD': 2685.50,
      'BTCUSD': 119000.00,
      'ETHUSD': 3850.00,
      'SOLUSD': 245.00,
      'ADAUSD': 1.15,
    };
    return prices[symbol] || 1.0000;
  };

  const getTimeframeMs = (timeframe: string): number => {
    const timeframes: Record<string, number> = {
      '1M': 60 * 1000,
      '5M': 5 * 60 * 1000,
      '15M': 15 * 60 * 1000,
      '1H': 60 * 60 * 1000,
      '4H': 4 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
    };
    return timeframes[timeframe] || 60 * 60 * 1000;
  };

  useEffect(() => {
    setIsLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      const newData = generateTradingData(symbol);
      setData(newData);
      
      if (newData.length > 0) {
        const latest = newData[newData.length - 1];
        const previous = newData[newData.length - 2];
        setCurrentPrice(latest.price);
        setPriceChange(latest.price - previous.price);
      }
      
      setIsLoading(false);
    }, 1000);
  }, [symbol, timeframe]);

  // Real-time price updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (data.length > 0) {
        const lastPrice = data[data.length - 1].price;
        const volatility = getBasePrice(symbol) * 0.0005;
        const change = (Math.random() - 0.5) * volatility * 2;
        const newPrice = lastPrice + change;
        
        setCurrentPrice(newPrice);
        setPriceChange(change);
        
        // Update the last data point
        setData(prev => {
          const newData = [...prev];
          const now = new Date();
          newData[newData.length - 1] = {
            ...newData[newData.length - 1],
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            price: parseFloat(newPrice.toFixed(5)),
            close: parseFloat(newPrice.toFixed(5)),
          };
          return newData;
        });
      }
    }, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [data, symbol]);

  const formatTooltip = (value: any, name: string) => {
    if (name === 'price') {
      return [parseFloat(value).toFixed(5), 'Price'];
    }
    if (name === 'volume') {
      return [parseInt(value).toLocaleString(), 'Volume'];
    }
    return [value, name];
  };

  const renderChart = () => {
    if (chartType === 'line') {
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis 
            dataKey="time" 
            stroke="#9CA3AF"
            fontSize={12}
            interval="preserveStartEnd"
          />
          <YAxis 
            stroke="#9CA3AF"
            fontSize={12}
            domain={['dataMin - 0.001', 'dataMax + 0.001']}
            tickFormatter={(value) => parseFloat(value).toFixed(4)}
          />
          <Tooltip 
            formatter={formatTooltip}
            labelStyle={{ color: '#1F2937' }}
            contentStyle={{ 
              backgroundColor: '#1F2937', 
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#F9FAFB'
            }}
          />
          <Line 
            type="monotone" 
            dataKey="price" 
            stroke="#10B981" 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#10B981' }}
          />
        </LineChart>
      );
    }

    return (
      <AreaChart data={data}>
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis 
          dataKey="time" 
          stroke="#9CA3AF"
          fontSize={12}
          interval="preserveStartEnd"
        />
        <YAxis 
          stroke="#9CA3AF"
          fontSize={12}
          domain={['dataMin - 0.001', 'dataMax + 0.001']}
          tickFormatter={(value) => parseFloat(value).toFixed(4)}
        />
        <Tooltip 
          formatter={formatTooltip}
          labelStyle={{ color: '#1F2937' }}
          contentStyle={{ 
            backgroundColor: '#1F2937', 
            border: '1px solid #374151',
            borderRadius: '8px',
            color: '#F9FAFB'
          }}
        />
        <Area 
          type="monotone" 
          dataKey="price" 
          stroke="#10B981" 
          strokeWidth={2}
          fill="url(#priceGradient)"
        />
      </AreaChart>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <LoadingSpinner text={`Loading ${symbol} chart data...`} />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {symbol} - {timeframe}
          </h3>
          <div className="flex items-center space-x-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {currentPrice.toFixed(5)}
            </span>
            <div className={`flex items-center space-x-1 ${
              priceChange >= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {priceChange >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span className="text-sm font-medium">
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(5)}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">Live</span>
        </div>
      </div>

      <div style={{ height: height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>

      {showVolume && (
        <div className="mt-4 h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6B7280" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6B7280" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="time" hide />
              <YAxis hide />
              <Tooltip 
                formatter={formatTooltip}
                labelStyle={{ color: '#1F2937' }}
                contentStyle={{ 
                  backgroundColor: '#1F2937', 
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F9FAFB'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="volume" 
                stroke="#6B7280" 
                fill="url(#volumeGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default TradingChart;