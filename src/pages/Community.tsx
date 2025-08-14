import React, { useState } from 'react';
import { Send, Paperclip, Smile, Hash, Users, Pin } from 'lucide-react';

const Community: React.FC = () => {
  const [message, setMessage] = useState('');
  const [activeChannel, setActiveChannel] = useState('general');

  const channels = [
    { id: 'general', name: 'general', members: 1234 },
    { id: 'signals', name: 'signals', members: 856 },
    { id: 'analysis', name: 'market-analysis', members: 642 },
    { id: 'crypto', name: 'crypto-talk', members: 423 },
    { id: 'help', name: 'help-support', members: 312 },
  ];

  const messages = [
    {
      id: 1,
      user: 'TradingPro_Alex',
      avatar: 'AP',
      message: 'EURUSD showing strong bullish momentum. Anyone else seeing this breakout?',
      timestamp: '2:34 PM',
      reactions: { '👍': 5, '🔥': 2 },
      isPinned: true,
    },
    {
      id: 2,
      user: 'MarketWatcher',
      avatar: 'MW',
      message: 'Great call on GBPJPY yesterday! Caught that 200 pip move 🚀',
      timestamp: '2:31 PM',
      reactions: { '💰': 8, '👏': 3 },
    },
    {
      id: 3,
      user: 'CryptoKing22',
      avatar: 'CK',
      message: 'BTC looking ready for another leg up. Target 48k',
      timestamp: '2:28 PM',
      reactions: { '📈': 4 },
      replies: 2,
    },
    {
      id: 4,
      user: 'RiskManager_Sam',
      avatar: 'RS',
      message: 'Remember folks, risk management is key! Never risk more than 2% per trade',
      timestamp: '2:25 PM',
      reactions: { '✅': 12, '💯': 6 },
    },
  ];

  const handleSendMessage = () => {
    if (message.trim()) {
      // Handle sending message
      setMessage('');
    }
  };

  return (
    <div className="flex h-[calc(100vh-120px)]">
      {/* Channels Sidebar */}
      <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
            <Users className="w-5 h-5 mr-2" />
            TradersLounge
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            3,467 members online
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Channels
            </h3>
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => setActiveChannel(channel.id)}
                className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-colors duration-200 ${
                  activeChannel === channel.id
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <div className="flex items-center">
                  <Hash className="w-4 h-4 mr-2" />
                  <span className="text-sm">{channel.name}</span>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {channel.members}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
        {/* Chat Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="flex items-center space-x-3">
            <Hash className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {channels.find(c => c.id === activeChannel)?.name}
            </h3>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {channels.find(c => c.id === activeChannel)?.members} members
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className="flex space-x-3">
              <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white font-medium text-sm">
                {msg.avatar}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {msg.user}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {msg.timestamp}
                  </span>
                  {msg.isPinned && (
                    <Pin className="w-4 h-4 text-yellow-500" />
                  )}
                </div>
                <p className="text-gray-700 dark:text-gray-300 mb-2">
                  {msg.message}
                </p>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    {Object.entries(msg.reactions || {}).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        className="flex items-center space-x-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200"
                      >
                        <span>{emoji}</span>
                        <span>{count}</span>
                      </button>
                    ))}
                  </div>
                  {msg.replies && (
                    <button className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline">
                      {msg.replies} replies
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input */}
        <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center space-x-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={`Message #${channels.find(c => c.id === activeChannel)?.name}`}
                className="w-full px-4 py-3 pr-24 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                <button className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200">
                  <Paperclip className="w-4 h-4" />
                </button>
                <button className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200">
                  <Smile className="w-4 h-4" />
                </button>
              </div>
            </div>
            <button
              onClick={handleSendMessage}
              className="p-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors duration-200"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Community;