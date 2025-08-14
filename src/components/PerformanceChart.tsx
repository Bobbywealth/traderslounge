import React from 'react';
import TradingChart from './TradingChart';

const PerformanceChart: React.FC = () => {
  return (
    <TradingChart 
      symbol="EURUSD" 
      timeframe="1H" 
      height={300}
      showVolume={true}
      chartType="area"
    />
  );
};

export default PerformanceChart;