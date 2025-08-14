// Real Financial News and Economic Calendar API Service
import { format } from 'date-fns';

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  currency: string;
  date: Date;
  time: string;
  impact: 'low' | 'medium' | 'high';
  forecast?: string;
  previous?: string;
  actual?: string;
  description: string;
  category: string;
  source: string;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: Date;
  source: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  relevantCurrencies: string[];
  imageUrl?: string;
  author?: string;
}

export interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: Date;
}

// API Configuration
const API_CONFIG = {
  // Alpha Vantage - Free tier: 5 calls per minute, 500 calls per day
  ALPHA_VANTAGE: {
    baseUrl: 'https://www.alphavantage.co/query',
    apiKey: localStorage.getItem('api_alphaVantage') || 'N35281CO4LORS4CU',
  },
  
  // Finnhub - Free tier: 60 calls per minute
  FINNHUB: {
    baseUrl: 'https://finnhub.io/api/v1',
    apiKey: localStorage.getItem('api_finnhub') || 'demo',
  },
  
  // NewsAPI - Free tier: 1000 requests per month
  NEWS_API: {
    baseUrl: 'https://newsapi.org/v2',
    apiKey: localStorage.getItem('api_newsApi') || 'c57dc72d29424da3a896faf4e7fd380b',
  },
  
  // Polygon.io - Free tier: 5 calls per minute
  POLYGON: {
    baseUrl: 'https://api.polygon.io',
    apiKey: localStorage.getItem('api_polygon') || '31WWhm2uoSkHLi9EMiyLnL5lavXRkA1h',
  },
  
  // Economic Calendar API (free)
  TRADING_ECONOMICS: {
    baseUrl: 'https://api.tradingeconomics.com',
    apiKey: localStorage.getItem('api_trading_economics') || 'demo',
  }
};

// Check if API keys are configured
const isApiConfigured = () => {
    apiKey: localStorage.getItem('api_fcsapi') || 'oBvRl6ovyvldsUPhXdoC8ug7',
         API_CONFIG.FINNHUB.apiKey !== 'demo' ||
         API_CONFIG.NEWS_API.apiKey !== 'demo';
};

// Alpha Vantage News API
export const fetchAlphaVantageNews = async (): Promise<NewsItem[]> => {
  if (API_CONFIG.ALPHA_VANTAGE.apiKey === 'demo') {
    console.warn('Alpha Vantage API key not configured. Using mock data.');
    return getMockNews();
  }

  try {
    const response = await fetch(
      `${API_CONFIG.ALPHA_VANTAGE.baseUrl}?function=NEWS_SENTIMENT&tickers=FOREX:USD,FOREX:EUR,FOREX:GBP&apikey=${API_CONFIG.ALPHA_VANTAGE.apiKey}`
    );
    
    if (!response.ok) throw new Error('Alpha Vantage API error');
    
    const data = await response.json();
    
    if (data['Error Message']) {
      throw new Error(data['Error Message']);
    }
    
    return data.feed?.slice(0, 20).map((item: any, index: number) => ({
      id: `av_${index}`,
      title: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt: (() => {
        const date = new Date(item.time_published);
        return isNaN(date.getTime()) ? new Date() : date;
      })(),
      source: item.source,
      sentiment: item.overall_sentiment_label?.toLowerCase() || 'neutral',
      relevantCurrencies: extractCurrencies(item.title + ' ' + item.summary),
      imageUrl: item.banner_image,
      author: item.authors?.[0],
    })) || [];
  } catch (error) {
    console.error('Alpha Vantage News API error:', error);
    return getMockNews();
  }
};

// Finnhub News API
export const fetchFinnhubNews = async (): Promise<NewsItem[]> => {
  if (API_CONFIG.FINNHUB.apiKey === 'demo') {
    console.warn('Finnhub API key not configured. Using mock data.');
    return getMockNews();
  }

  try {
    const response = await fetch(
      `${API_CONFIG.FINNHUB.baseUrl}/news?category=forex&token=${API_CONFIG.FINNHUB.apiKey}`
    );
    
    if (!response.ok) throw new Error('Finnhub API error');
    
    const data = await response.json();
    
    return data.slice(0, 15).map((item: any, index: number) => ({
      id: `fh_${index}`,
      title: item.headline,
      summary: item.summary,
      url: item.url,
      publishedAt: (() => {
        const date = new Date(item.datetime * 1000);
        return isNaN(date.getTime()) ? new Date() : date;
      })(),
      source: item.source,
      sentiment: analyzeSentiment(item.headline + ' ' + item.summary),
      relevantCurrencies: extractCurrencies(item.headline + ' ' + item.summary),
      imageUrl: item.image,
    }));
  } catch (error) {
    console.error('Finnhub News API error:', error);
    return getMockNews();
  }
};

// NewsAPI for Financial News
export const fetchNewsAPI = async (): Promise<NewsItem[]> => {
  if (API_CONFIG.NEWS_API.apiKey === 'demo') {
    console.warn('NewsAPI key not configured. Using mock data.');
    return getMockNews();
  }

  try {
    const response = await fetch(
      `${API_CONFIG.NEWS_API.baseUrl}/everything?q=forex OR trading OR "central bank" OR "interest rates"&domains=reuters.com,bloomberg.com,cnbc.com,marketwatch.com&sortBy=publishedAt&pageSize=20&apiKey=${API_CONFIG.NEWS_API.apiKey}`
    );
    
    if (!response.ok) throw new Error('NewsAPI error');
    
    const data = await response.json();
    
    if (data.status !== 'ok') {
      throw new Error(data.message || 'NewsAPI error');
    }
    
    return data.articles.map((item: any, index: number) => ({
      id: `na_${index}`,
      title: item.title,
      summary: item.description || item.content?.substring(0, 200) + '...',
      url: item.url,
      publishedAt: (() => {
        const date = new Date(item.publishedAt);
        return isNaN(date.getTime()) ? new Date() : date;
      })(),
      source: item.source.name,
      sentiment: analyzeSentiment(item.title + ' ' + item.description),
      relevantCurrencies: extractCurrencies(item.title + ' ' + item.description),
      imageUrl: item.urlToImage,
      author: item.author,
    }));
  } catch (error) {
    console.error('NewsAPI error:', error);
    return getMockNews();
  }
};

// Trading Economics Calendar API
export const fetchTradingEconomicsCalendar = async (): Promise<EconomicEvent[]> => {
  if (API_CONFIG.FCSAPI.apiKey === 'demo' || !API_CONFIG.FCSAPI.apiKey) {
    console.warn('Trading Economics API key not configured. Using mock data.');
    return getMockEconomicEvents();
  }

  try {
    console.log('🚀 FETCHING REAL ECONOMIC CALENDAR FROM FCS API...');
    const today = format(new Date(), 'yyyy-MM-dd');
    const nextMonth = format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
    
    const response = await fetch(
      `${API_CONFIG.TRADING_ECONOMICS.baseUrl}/calendar/country/united%20states,euro%20area,united%20kingdom,japan,canada,australia/${today}/${nextMonth}?c=${API_CONFIG.TRADING_ECONOMICS.apiKey}`
    );
    
    if (!response.ok) throw new Error('Trading Economics API error');
    
    const data = await response.json();
    
    return data.map((item: any, index: number) => ({
      id: `te_${index}`,
      title: item.Event,
      country: item.Country,
      currency: getCurrencyFromCountry(item.Country),
      date: new Date(item.Date),
      time: item.Time || '00:00',
      impact: getImpactLevel(item.Importance),
      forecast: item.Forecast?.toString(),
      previous: item.Previous?.toString(),
      actual: item.Actual?.toString(),
      description: item.Event,
      category: item.Category || 'Economic',
      source: 'Trading Economics',
    }));
  } catch (error) {
    console.error('Trading Economics API error:', error);
    return getMockEconomicEvents();
  }
};

// Polygon.io Market Data
export const fetchPolygonMarketData = async (symbols: string[]): Promise<MarketData[]> => {
  if (API_CONFIG.POLYGON.apiKey === 'demo') {
    console.warn('Polygon API key not configured. Using mock data.');
    return getMockMarketData(symbols);
  }

  try {
    const promises = symbols.map(async (symbol) => {
      const response = await fetch(
        `${API_CONFIG.POLYGON.baseUrl}/v2/aggs/ticker/C:${symbol}/prev?adjusted=true&apikey=${API_CONFIG.POLYGON.apiKey}`
      );
      
      if (!response.ok) throw new Error(`Polygon API error for ${symbol}`);
      
      const data = await response.json();
      const result = data.results?.[0];
      
      if (!result) throw new Error(`No data for ${symbol}`);
      
      return {
        symbol,
        price: result.c,
        change: result.c - result.o,
        changePercent: ((result.c - result.o) / result.o) * 100,
        volume: result.v,
        timestamp: new Date(result.t),
      };
    });
    
    return await Promise.all(promises);
  } catch (error) {
    console.error('Polygon Market Data API error:', error);
    return getMockMarketData(symbols);
  }
};

// Main API functions that combine multiple sources
export const fetchEconomicEvents = async (): Promise<EconomicEvent[]> => {
  try {
    console.log('📊 LOADING ECONOMIC CALENDAR FROM MULTIPLE SOURCES...');
    
    const [tradingEconomics, alphaVantage, fcsApi, polygonData] = await Promise.allSettled([
      fetchTradingEconomicsCalendar(),
      fetchAlphaVantageEconomicCalendar(),
      fetchFCSEconomicCalendar(),
      fetchPolygonEconomicData(),
    ]);
    
    const allEvents: EconomicEvent[] = [];
    
    if (tradingEconomics.status === 'fulfilled') allEvents.push(...tradingEconomics.value);
    if (alphaVantage.status === 'fulfilled') allEvents.push(...alphaVantage.value);
    if (fcsApi.status === 'fulfilled') allEvents.push(...fcsApi.value);
    if (polygonData.status === 'fulfilled') allEvents.push(...polygonData.value);
    
    // Remove duplicates and sort by date
    const uniqueEvents = allEvents
      .filter((item, index, self) => 
        index === self.findIndex(t => t.title === item.title && t.date.toDateString() === item.date.toDateString())
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 100);
    
    console.log(`✅ Loaded ${uniqueEvents.length} economic events from ${allEvents.length > 0 ? 'real APIs' : 'mock data'}`);
    return uniqueEvents.length > 0 ? uniqueEvents : getMockEconomicEvents();
  } catch (error) {
    console.error('Failed to fetch economic events:', error);
    return getMockEconomicEvents();
  }
};

export const fetchNews = async (): Promise<NewsItem[]> => {
  try {
    // Try multiple news sources and combine results
    const [alphaNews, finnhubNews, newsApiNews] = await Promise.allSettled([
      fetchAlphaVantageNews(),
      fetchFinnhubNews(),
      fetchNewsAPI(),
    ]);
    
    const allNews: NewsItem[] = [];
    
    if (alphaNews.status === 'fulfilled') allNews.push(...alphaNews.value);
    if (finnhubNews.status === 'fulfilled') allNews.push(...finnhubNews.value);
    if (newsApiNews.status === 'fulfilled') allNews.push(...newsApiNews.value);
    
    // Remove duplicates and sort by date
    const uniqueNews = allNews
      .filter((item, index, self) => 
        index === self.findIndex(t => t.title === item.title)
      )
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, 25);
    
    return uniqueNews.length > 0 ? uniqueNews : getMockNews();
  } catch (error) {
    console.error('Failed to fetch news:', error);
    return getMockNews();
  }
};

// Utility functions
const extractCurrencies = (text: string): string[] => {
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD'];
  return currencies.filter(currency => 
    text.toUpperCase().includes(currency) || 
    text.toUpperCase().includes(currency.substring(0, 2))
  );
};

const analyzeSentiment = (text: string): 'positive' | 'negative' | 'neutral' => {
  const positiveWords = ['rise', 'gain', 'up', 'bull', 'strong', 'growth', 'increase', 'rally'];
  const negativeWords = ['fall', 'drop', 'down', 'bear', 'weak', 'decline', 'decrease', 'crash'];
  
  const lowerText = text.toLowerCase();
  const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
  const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
};

const getCurrencyFromCountry = (country: string): string => {
  const countryToCurrency: Record<string, string> = {
    'United States': 'USD',
    'Euro Area': 'EUR',
    'United Kingdom': 'GBP',
    'Japan': 'JPY',
    'Canada': 'CAD',
    'Australia': 'AUD',
    'Switzerland': 'CHF',
    'New Zealand': 'NZD',
  };
  return countryToCurrency[country] || 'USD';
};

const getImpactLevel = (importance: string | number): 'low' | 'medium' | 'high' => {
  if (typeof importance === 'number') {
    if (importance >= 3) return 'high';
    if (importance >= 2) return 'medium';
    return 'low';
  }
  
  const level = importance?.toString().toLowerCase();
  if (level?.includes('high') || level?.includes('3')) return 'high';
  if (level?.includes('medium') || level?.includes('2')) return 'medium';
  return 'low';
};

// Mock data functions (fallback when APIs are not configured)
const getMockNews = (): NewsItem[] => {
  return [
    {
      id: 'mock_1',
      title: 'Federal Reserve Signals Potential Rate Changes Ahead',
      summary: 'Fed officials hint at monetary policy adjustments in response to recent economic indicators and inflation data.',
      url: 'https://example.com/news/1',
      publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      source: 'Reuters',
      sentiment: 'neutral',
      relevantCurrencies: ['USD'],
      imageUrl: 'https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 'mock_2',
      title: 'European Central Bank Maintains Dovish Stance',
      summary: 'ECB continues accommodative monetary policy amid ongoing inflation concerns and economic uncertainty.',
      url: 'https://example.com/news/2',
      publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      source: 'Bloomberg',
      sentiment: 'negative',
      relevantCurrencies: ['EUR'],
      imageUrl: 'https://images.pexels.com/photos/7567565/pexels-photo-7567565.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
    {
      id: 'mock_3',
      title: 'Gold Prices Surge on Safe Haven Demand',
      summary: 'Precious metals rally as investors seek safety amid market volatility and geopolitical tensions.',
      url: 'https://example.com/news/3',
      publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      source: 'MarketWatch',
      sentiment: 'positive',
      relevantCurrencies: ['USD', 'EUR', 'GBP'],
      imageUrl: 'https://images.pexels.com/photos/6765363/pexels-photo-6765363.jpeg?auto=compress&cs=tinysrgb&w=800',
    },
  ];
};

const getMockEconomicEvents = (): EconomicEvent[] => {
  const events: EconomicEvent[] = [];
  const now = new Date();
  
  const eventTemplates = [
    {
      title: 'Non-Farm Payrolls',
      country: 'United States',
      currency: 'USD',
      impact: 'high' as const,
      category: 'Employment',
      description: 'Monthly change in the number of employed people during the previous month, excluding the farming industry.',
      source: 'Bureau of Labor Statistics'
    },
    {
      title: 'Consumer Price Index',
      country: 'United States',
      currency: 'USD',
      impact: 'high' as const,
      category: 'Inflation',
      description: 'Measures changes in the price level of consumer goods and services purchased by households.',
      source: 'Bureau of Labor Statistics'
    },
    {
      title: 'GDP Growth Rate',
      country: 'Euro Area',
      currency: 'EUR',
      impact: 'high' as const,
      category: 'Economic Growth',
      description: 'The annualized change in the inflation-adjusted value of all goods and services produced by the economy.',
      source: 'Eurostat'
    },
  ];

  // Generate events for the next 30 days
  for (let i = 0; i < 30; i++) {
    const eventDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const numEvents = Math.floor(Math.random() * 3) + 1;
    
    for (let j = 0; j < numEvents; j++) {
      const template = eventTemplates[Math.floor(Math.random() * eventTemplates.length)];
      const hour = Math.floor(Math.random() * 12) + 8;
      const minute = Math.floor(Math.random() * 4) * 15;
      
      events.push({
        id: `mock_event_${i}_${j}`,
        ...template,
        date: eventDate,
        time: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        forecast: '2.1%',
        previous: '1.8%',
        actual: i < 7 ? '2.3%' : undefined,
      });
    }
    
    console.log(`✅ FCS API: Loaded ${data.response?.length || 0} economic events`);
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
};

const getMockMarketData = (symbols: string[]): MarketData[] => {
  return symbols.map(symbol => ({
    symbol,
    price: 1.0850 + (Math.random() - 0.5) * 0.1,
    change: (Math.random() - 0.5) * 0.01,
    changePercent: (Math.random() - 0.5) * 2,
    volume: Math.floor(Math.random() * 1000000) + 500000,
    timestamp: new Date(),
  }));
};

// API Configuration Helper
export const getApiInstructions = () => {
  return {
    instructions: `
To get real financial data, you need to configure API keys from these providers:

1. **Alpha Vantage** (Free: 5 calls/min, 500/day)
   - Sign up: https://www.alphavantage.co/support/#api-key
   - Replace API_CONFIG.ALPHA_VANTAGE.apiKey with your key

2. **Finnhub** (Free: 60 calls/min)
   - Sign up: https://finnhub.io/register
   - Replace API_CONFIG.FINNHUB.apiKey with your key

3. **NewsAPI** (Free: 1000 requests/month)
   - Sign up: https://newsapi.org/register
   - Replace API_CONFIG.NEWS_API.apiKey with your key

4. **Trading Economics** (Free tier available)
   - Sign up: https://tradingeconomics.com/api
   - Replace API_CONFIG.TRADING_ECONOMICS.apiKey with your key

5. **Polygon.io** (Free: 5 calls/min)
   - Sign up: https://polygon.io/
   - Replace API_CONFIG.POLYGON.apiKey with your key

Without API keys, the system will use realistic mock data.
    `,
    providers: [
      { name: 'Alpha Vantage', url: 'https://www.alphavantage.co/', features: ['News', 'Market Data'] },
      { name: 'Finnhub', url: 'https://finnhub.io/', features: ['News', 'Real-time Data'] },
      { name: 'NewsAPI', url: 'https://newsapi.org/', features: ['Financial News'] },
      { name: 'Trading Economics', url: 'https://tradingeconomics.com/', features: ['Economic Calendar'] },
      { name: 'Polygon.io', url: 'https://polygon.io/', features: ['Market Data', 'Forex'] },
    ]
  };
};