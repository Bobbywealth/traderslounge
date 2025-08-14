import React, { useState } from 'react';
import { MessageSquare, X, Send, Bot } from 'lucide-react';

const AIAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'ai' as const,
      content: 'Hello! I\'m your AI trading assistant. I can help you with market analysis, trade ideas, and platform navigation. How can I assist you today?',
      timestamp: new Date(),
    },
  ]);

  const handleSendMessage = () => {
    if (!message.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user' as const,
      content: message,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setMessage('');

    // Simulate AI response
    setTimeout(() => {
      const aiResponse = {
        id: Date.now() + 1,
        type: 'ai' as const,
        content: getAIResponse(message),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiResponse]);
    }, 1000);
  };

  const getAIResponse = (userMessage: string): string => {
    const lowercaseMessage = userMessage.toLowerCase();
    
    if (lowercaseMessage.includes('eurusd') || lowercaseMessage.includes('eur/usd')) {
      return 'EURUSD is currently showing bullish momentum above the 1.0850 support level. Key resistance at 1.0950. Consider waiting for a breakout with volume confirmation before entering long positions.';
    }
    
    if (lowercaseMessage.includes('risk') || lowercaseMessage.includes('management')) {
      return 'Risk management is crucial for long-term success. I recommend:\n\n• Never risk more than 2% of your account per trade\n• Use stop losses on every position\n• Maintain a risk-reward ratio of at least 1:2\n• Diversify across different currency pairs';
    }
    
    if (lowercaseMessage.includes('signals') || lowercaseMessage.includes('trade ideas')) {
      return 'Based on current market conditions, I see potential opportunities in:\n\n• GBPJPY - Bullish breakout pattern\n• XAUUSD - Testing key support levels\n• USDJPY - Ranging between major levels\n\nWould you like detailed analysis on any of these pairs?';
    }
    
    return 'I understand you\'re asking about trading. I can help with market analysis, risk management, trade planning, and platform navigation. Could you be more specific about what you\'d like assistance with?';
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-emerald-500 text-white rounded-full shadow-lg hover:bg-emerald-600 transition-colors duration-200 flex items-center justify-center z-50"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-white">AI Assistant</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                msg.type === 'user'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              <span className={`text-xs mt-1 block ${
                msg.type === 'user' ? 'text-emerald-100' : 'text-gray-500 dark:text-gray-400'
              }`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Ask about trading, analysis, or get help..."
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
          <button
            onClick={handleSendMessage}
            className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors duration-200"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;