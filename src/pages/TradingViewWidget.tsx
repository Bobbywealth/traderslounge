// Lightweight wrapper that re-exports the TradingView chart page for the
// `/tradingview-widget` route. The route was introduced as part of the PWA
// conversion (commit 79a85f5) but the corresponding component file was
// never added, which made `npm run build` fail with
// `Could not resolve "./pages/TradingViewWidget" from "src/App.tsx"`.
//
// The widget variant shares the same full TradingView workspace today; if a
// trimmed widget view is needed later, swap this wrapper for a dedicated
// implementation without changing App.tsx.
import TradingView from './TradingView';

const TradingViewWidget: React.FC = () => <TradingView />;

export default TradingViewWidget;