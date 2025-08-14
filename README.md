# TradersLounge Modern Trading Dashboard

A comprehensive, production-ready trading dashboard built with React, TypeScript, and Tailwind CSS. Features real-time market data, broker integration, economic calendar, and professional trading tools.

## Features

### 📊 **Professional Dashboard**
- Real-time portfolio metrics and P&L tracking
- Interactive performance charts with live data
- Customizable quick actions and widgets
- Multi-broker account overview

### 📈 **Advanced Trading Tools**
- Professional TradingView-style charts
- Harmonic pattern recognition and analysis
- Real-time price feeds with technical indicators
- Multiple timeframes and chart types

### 🗓️ **Economic Calendar**
- Real economic events from major providers
- High/Medium/Low impact filtering
- Live news feed with sentiment analysis
- Multi-currency event tracking

### 🔗 **Broker Integration**
- Support for 10+ major brokers (MT4/5, OANDA, Interactive Brokers, etc.)
- Real-time account synchronization
- Automated trade import and tracking
- Secure API key management

### 🤖 **AI-Powered Features**
- Intelligent trading assistant
- Automated signal generation
- Pattern recognition algorithms
- Market sentiment analysis

### 📚 **Education & Community**
- Comprehensive trading courses
- Video tutorials and articles
- Real-time community chat
- Performance tracking and analytics

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Charts**: Recharts, Lightweight Charts
- **Icons**: Lucide React
- **Routing**: React Router DOM
- **Build Tool**: Vite
- **APIs**: Alpha Vantage, Finnhub, NewsAPI, Trading Economics
- **PWA**: Service Worker, Web App Manifest

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173) in your browser

## Test Login Credentials

The platform includes test accounts for different user types:

### Admin Dashboard Access
- **Email:** admin@traderslounge.com
- **Password:** admin123
- **Features:** Full admin dashboard with user management, revenue tracking, and platform analytics

### Demo Trader Account
- **Email:** demo@trader.com  
- **Password:** demo123
- **Plan:** Pro ($29/mo equivalent)
- **Features:** Full trading dashboard with all pro features

### Free User Account
- **Email:** test@test.com
- **Password:** test123  
- **Plan:** Free
- **Features:** Basic trading features and limited access

### Any Email/Password
- Use any email and password combination to create a new Pro user account
- All accounts are stored locally in browser storage

## API Configuration

To get real financial data, configure API keys from these providers:

1. **Alpha Vantage** (Free: 5 calls/min, 500/day)
   - Sign up: https://www.alphavantage.co/support/#api-key

2. **Finnhub** (Free: 60 calls/min)
   - Sign up: https://finnhub.io/register

3. **NewsAPI** (Free: 1000 requests/month)
   - Sign up: https://newsapi.org/register

4. **Trading Economics** (Free tier available)
   - Sign up: https://tradingeconomics.com/api

5. **Polygon.io** (Free: 5 calls/min)
   - Sign up: https://polygon.io/

Click the RSS icon in the header to configure your API keys.

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Production Deployment

### Netlify (Recommended)
```bash
npm run build
# Upload dist/ folder to Netlify
```

### Vercel
```bash
npm i -g vercel
vercel
```

### Docker
```bash
docker build -t traderslounge .
docker run -p 3000:3000 traderslounge
```

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   ├── MetricCard.tsx
│   ├── PerformanceChart.tsx
│   ├── QuickActions.tsx
│   ├── RecentTrades.tsx
│   ├── AIAssistant.tsx
│   ├── BrokerSetup.tsx
│   ├── ApiConfiguration.tsx
│   ├── ErrorBoundary.tsx
│   └── LoadingSpinner.tsx
├── contexts/           # React contexts
│   └── ThemeContext.tsx
│   └── BrokerContext.tsx
├── pages/              # Page components
│   ├── Dashboard.tsx
│   ├── TradingTable.tsx
│   ├── TradingView.tsx
│   ├── Calendar.tsx
│   ├── Signals.tsx
│   ├── Education.tsx
│   └── Community.tsx
├── services/           # API services
│   └── newsApi.ts
├── types/              # TypeScript types
│   └── broker.ts
├── config/             # Configuration files
│   └── brokers.ts
├── App.tsx             # Main app component
├── main.tsx           # App entry point
└── index.css          # Global styles
```

## Customization

### Themes
- Dark/Light mode toggle
- Customizable color schemes
- Professional trading aesthetics

### Broker Integration
- Add new brokers in `src/config/brokers.ts`
- Implement API connections in `src/contexts/BrokerContext.tsx`
- Support for REST APIs and WebSocket connections

### Charts & Analytics
- Customize chart types and indicators
- Add new technical analysis tools
- Implement custom trading strategies

## Security Features

- Local API key storage (never sent to servers)
- Encrypted broker credentials
- Error boundary protection
- Input validation and sanitization
- HTTPS-only in production

## Performance Optimizations

- Code splitting and lazy loading
- Optimized bundle sizes
- Service worker caching
- Efficient chart rendering
- Debounced API calls

## Deployment

Build the project for production:

```bash
npm run build
```

The `dist` folder will contain the production-ready files.

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details.