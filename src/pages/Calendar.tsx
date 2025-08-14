import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, Globe, Filter, Search, Calendar as CalendarIcon, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { fetchEconomicEvents, fetchNews, EconomicEvent, NewsItem } from '../services/newsApi';
import LoadingSpinner from '../components/LoadingSpinner';

const Calendar: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EconomicEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterEvents();
  }, [events, impactFilter, currencyFilter, searchTerm]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      console.log('Loading real financial data...');
      const [eventsData, newsData] = await Promise.all([
        fetchEconomicEvents(),
        fetchNews()
      ]);
      console.log(`Loaded ${eventsData.length} events and ${newsData.length} news items`);
      setEvents(eventsData);
      setNews(newsData);
    } catch (error) {
      console.error('Failed to load calendar data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterEvents = () => {
    let filtered = events;

    if (impactFilter !== 'all') {
      filtered = filtered.filter(event => event.impact === impactFilter);
    }

    if (currencyFilter !== 'all') {
      filtered = filtered.filter(event => event.currency === currencyFilter);
    }

    if (searchTerm) {
      filtered = filtered.filter(event => 
        event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredEvents(filtered);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      setCurrentDate(subMonths(currentDate, 1));
    } else {
      setCurrentDate(addMonths(currentDate, 1));
    }
  };

  const getDaysInMonth = () => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return eachDayOfInterval({ start, end });
  };

  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter(event => isSameDay(event.date, date));
  };

  const getSelectedDateEvents = () => {
    return filteredEvents.filter(event => isSameDay(event.date, selectedDate));
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'medium':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800';
      case 'low':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300 border-gray-200 dark:border-gray-700';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300 border-gray-200 dark:border-gray-700';
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'negative':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const uniqueCurrencies = Array.from(new Set(events.map(event => event.currency)));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Economic Calendar</h1>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <LoadingSpinner size="lg" text="Loading economic events and market news..." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Economic Calendar</h1>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2 mr-4">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {isLoading ? 'Loading...' : 'Data loaded'}
            </span>
          </div>
          <Globe className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="text-sm text-gray-600 dark:text-gray-400">GMT +0</span>
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse ml-2"></div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {events.some(e => e.source !== 'Mock Data') ? 'Live Data' : 'Demo Data'}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 md:space-x-4">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search events..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>
            
            <select
              value={impactFilter}
              onChange={(e) => setImpactFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="all">All Impact</option>
              <option value="high">High Impact</option>
              <option value="medium">Medium Impact</option>
              <option value="low">Low Impact</option>
            </select>

            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            >
              <option value="all">All Currencies</option>
              {uniqueCurrencies.map(currency => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {filteredEvents.length} events
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Calendar */}
        <div className="xl:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {format(currentDate, 'MMMM yyyy')}
            </h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigateMonth('prev')}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
              >
                <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="px-3 py-1 text-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors duration-200"
              >
                Today
              </button>
              <button
                onClick={() => navigateMonth('next')}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
              >
                <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-4">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-2 text-center text-sm font-medium text-gray-600 dark:text-gray-400">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {getDaysInMonth().map(day => {
              const dayEvents = getEventsForDate(day);
              const isSelected = isSameDay(day, selectedDate);
              const isTodayDate = isToday(day);
              
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDate(day)}
                  className={`p-2 h-16 border rounded-lg text-left transition-colors duration-200 ${
                    isSelected
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700'
                      : isTodayDate
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                >
                  <div className={`text-sm font-medium ${
                    isSelected
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : isTodayDate
                      ? 'text-blue-700 dark:text-blue-300'
                      : 'text-gray-900 dark:text-white'
                  }`}>
                    {format(day, 'd')}
                  </div>
                  <div className="flex space-x-1 mt-1">
                    {dayEvents.slice(0, 3).map((event, index) => (
                      <div
                        key={index}
                        className={`w-2 h-2 rounded-full ${
                          event.impact === 'high'
                            ? 'bg-red-500'
                            : event.impact === 'medium'
                            ? 'bg-orange-500'
                            : 'bg-gray-400'
                        }`}
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-xs text-gray-500">+{dayEvents.length - 3}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Events for Selected Date */}
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                <CalendarIcon className="w-5 h-5 mr-2" />
                {format(selectedDate, 'EEEE, MMMM d')}
              </h3>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {getSelectedDateEvents().length} events
              </span>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {getSelectedDateEvents().length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No events scheduled for this date
                </div>
              ) : (
                getSelectedDateEvents().map((event) => (
                  <div key={event.id} className={`border-l-4 pl-4 py-3 rounded-r-lg ${getImpactColor(event.impact)}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium text-sm mb-1">
                          {event.title}
                        </h4>
                        <div className="flex items-center space-x-4 text-xs mb-2">
                          <div className="flex items-center space-x-1">
                            <Clock className="w-3 h-3" />
                            <span>{event.time} GMT</span>
                          </div>
                          <span className="font-medium">{event.currency}</span>
                          <span className="capitalize">{event.impact} Impact</span>
                        </div>
                        <p className="text-xs opacity-75 mb-2">
                          {event.description}
                        </p>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="opacity-75">Forecast:</span>
                            <div className="font-medium">{event.forecast}</div>
                          </div>
                          <div>
                            <span className="opacity-75">Previous:</span>
                            <div className="font-medium">{event.previous}</div>
                          </div>
                          {event.actual && (
                            <div>
                              <span className="opacity-75">Actual:</span>
                              <div className="font-medium">{event.actual}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Market News */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Market News
            </h3>
            
            <div className="space-y-4">
              {news.map((item) => (
                <div key={item.id} className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-b-0">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-sm text-gray-900 dark:text-white">
                      {item.title}
                    </h4>
                    <div className={`flex items-center space-x-1 ${getSentimentColor(item.sentiment)}`}>
                      {item.sentiment === 'positive' ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : item.sentiment === 'negative' ? (
                        <TrendingDown className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                    {item.summary}
                  </p>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-500 dark:text-gray-400">{item.source}</span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {format(item.publishedAt, 'HH:mm')}
                      </span>
                    </div>
                    <div className="flex space-x-1">
                      {item.relevantCurrencies.map(currency => (
                        <span key={currency} className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                          {currency}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Calendar;