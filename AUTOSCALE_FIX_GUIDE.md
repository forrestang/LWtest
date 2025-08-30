# LightweightCharts AutoScale Prevention Guide

## The Problem: Why AutoScale Can't Be Disabled

LightweightCharts has persistent autoscaling issues that cannot be solved with traditional methods like `autoScale: false`. Here's why:

### Root Cause
When you recreate series (remove and add new ones), LightweightCharts **internally triggers autoscaling** regardless of your `autoScale: false` settings. This happens during:
- Symbol/token visibility toggling
- Chart type switching  
- Data updates that recreate series
- WebSocket reconnections that refetch data

### Why Traditional Solutions Fail
```javascript
// ❌ These approaches DON'T work reliably:
rightPriceScale: { autoScale: false }
chart.priceScale('right').applyOptions({ autoScale: false })
chart.timeScale().fitContent() // Avoiding this call
```

**Problem**: Series recreation bypasses these settings and triggers internal scaling.

## The Solution: Transparency Method

Instead of removing/recreating series for visibility control, use **transparent colors** to hide series while keeping them active.

### Core Concept
1. **Create ALL series upfront** (visible and invisible tokens)
2. **Use transparent colors** (`rgba(0,0,0,0)`) for "hidden" series
3. **Toggle visibility** by switching between normal and transparent colors
4. **Never remove series** - they stay active but invisible

### Benefits
- ✅ **No series recreation** = No internal autoscaling triggers
- ✅ **Preserves zoom/pan state** during visibility changes
- ✅ **Faster performance** - no data reprocessing
- ✅ **Maintains data flow** - all series continue receiving updates

## Implementation: Working Example (index.html)

### 1. Series Creation with Transparency
```javascript
function createChartSeries() {
    if (!charts.main) return;
    
    // Clear existing series
    chartSeries.forEach((series) => {
        try {
            if (series && charts.main) {
                charts.main.removeSeries(series);
            }
        } catch (error) {
            console.error('Error removing series:', error);
        }
    });
    chartSeries.clear();
    
    // Create series for ALL symbols (BTC and ETH) with transparent colors for inactive ones
    const allSymbols = ['BTC', 'ETH'];
    
    for (const symbol of allSymbols) {
        let series;
        const isActive = activeSymbols.has(symbol);
        const transparentColor = 'rgba(0,0,0,0)';
        
        if (currentChart === 'candlestick') {
            series = charts.main.addSeries(CandlestickSeries, {
                upColor: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                downColor: isActive ? (symbol === 'BTC' ? '#c0392b' : '#0097a7') : transparentColor,
                borderVisible: false,
                wickUpColor: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                wickDownColor: isActive ? (symbol === 'BTC' ? '#c0392b' : '#0097a7') : transparentColor,
            });
        } else if (currentChart === 'line') {
            series = charts.main.addSeries(LineSeries, {
                color: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                lineWidth: 2,
            });
        } else if (currentChart === 'bar') {
            series = charts.main.addSeries(BarSeries, {
                upColor: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                downColor: isActive ? (symbol === 'BTC' ? '#c0392b' : '#0097a7') : transparentColor,
            });
        }
        
        if (series) {
            chartSeries.set(symbol, series);
            console.log(`Created ${currentChart} series for ${symbol} (active: ${isActive})`);
        }
    }
    
    // Update with existing data
    updateChartData();
}
```

### 2. Visibility Toggling via Color Changes
```javascript
function toggleSymbol(symbol) {
    const checkbox = document.getElementById(`${symbol.toLowerCase()}-checkbox`);
    
    if (checkbox.checked) {
        activeSymbols.add(symbol);
        console.log(`${symbol} enabled`);
    } else {
        activeSymbols.delete(symbol);
        console.log(`${symbol} disabled`);
    }
    
    // Update series colors instead of recreating
    if (chartSeries.has(symbol)) {
        const series = chartSeries.get(symbol);
        const isActive = activeSymbols.has(symbol);
        const transparentColor = 'rgba(0,0,0,0)';
        
        if (currentChart === 'candlestick') {
            series.applyOptions({
                upColor: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                downColor: isActive ? (symbol === 'BTC' ? '#c0392b' : '#0097a7') : transparentColor,
                wickUpColor: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                wickDownColor: isActive ? (symbol === 'BTC' ? '#c0392b' : '#0097a7') : transparentColor,
            });
        } else if (currentChart === 'line') {
            series.applyOptions({
                color: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
            });
        } else if (currentChart === 'bar') {
            series.applyOptions({
                upColor: isActive ? (symbol === 'BTC' ? '#e74c3c' : '#00bcd4') : transparentColor,
                downColor: isActive ? (symbol === 'BTC' ? '#c0392b' : '#0097a7') : transparentColor,
            });
        }
        
        console.log(`${symbol} series colors updated (active: ${isActive})`);
    } else {
        // If series doesn't exist yet, recreate all series
        console.log(`${symbol} series not found, recreating all series`);
        createChartSeries();
    }
    
    // NOTE: Removed WebSocket reconnection to prevent series recreation
    // No more: disconnectWebSocket(); setTimeout(() => connectWebSocket(), 1000);
}
```

### 3. Data Loading for All Symbols
```javascript
async function fetchHistoricalData() {
    const promises = [];
    
    // Fetch data for ALL symbols (both BTC and ETH) so they can be toggled
    const allSymbols = ['BTC', 'ETH'];
    for (const symbol of allSymbols) {
        promises.push(fetchHistoricalDataForSymbol(symbol));
    }
    
    const results = await Promise.all(promises);
    const allLoaded = results.every(result => result === true);
    
    // Force series recreation after initial data load to ensure proper display
    if (allLoaded) {
        console.log('All historical data loaded, recreating series to ensure proper display');
        createChartSeries();
    }
    
    return allLoaded;
}
```

## Analysis: SimpleChart.tsx Issues

### Current Problems (Lines 190-202, 425)
```typescript
// ❌ PROBLEM: Complete series recreation on every change
useEffect(() => {
    if (!chartRef.current || !filteredData.length) {
        // Clear all series if no data
        seriesRefs.current.forEach(series => chartRef.current?.removeSeries(series))
        seriesRefs.current.clear()
        return
    }

    const chart = chartRef.current

    // Clear existing series - THIS CAUSES AUTOSCALING
    seriesRefs.current.forEach(series => chart.removeSeries(series))
    seriesRefs.current.clear()
    
    // Recreate all series - THIS TRIGGERS INTERNAL AUTOSCALING
    // ... series creation code
}, [filteredData, chartType, tokenColors, tokenColorsByCA, tokenLineWeights, 
   statisticalBandConfig, sliderPosition, stableTimestampRange, visibleTokens])
```

### Required Changes for SimpleChart.tsx

#### 1. Replace Series Recreation with Transparency
```typescript
// ✅ SOLUTION: Create all series with transparency control
useEffect(() => {
    if (!chartRef.current || !data.length) return;

    const chart = chartRef.current;
    
    // Only clear and recreate if chart type changes, not for visibility
    if (/* chartType changed */) {
        seriesRefs.current.forEach(series => chart.removeSeries(series));
        seriesRefs.current.clear();
    }

    // Group all available data by token (not just visible ones)
    const allTokenData = new Map<string, OHLCVData[]>();
    data.forEach(d => {
        const tokenKey = `${d.CA}:${d.symbol}`;
        if (!allTokenData.has(tokenKey)) {
            allTokenData.set(tokenKey, []);
        }
        allTokenData.get(tokenKey)!.push(d);
    });

    // Create series for ALL tokens with transparency for invisible ones
    allTokenData.forEach((tokenData, tokenKey) => {
        const [ca, symbol] = tokenKey.split(':');
        const isVisible = visibleTokens.has(ca);
        const transparentColor = 'rgba(0,0,0,0)';
        const normalColor = tokenColorsByCA[ca] || tokenColors[symbol] || '#2962ff';
        
        if (!seriesRefs.current.has(tokenKey)) {
            let series;
            
            if (chartType === 'line') {
                series = chart.addSeries(LineSeries, {
                    color: isVisible ? normalColor : transparentColor,
                    lineWidth: isVisible ? (tokenLineWeights[ca] || 2) : 0,
                    lastValueVisible: false,
                    priceLineVisible: false,
                });
            } else if (chartType === 'candlestick') {
                series = chart.addSeries(CandlestickSeries, {
                    upColor: isVisible ? normalColor : transparentColor,
                    downColor: isVisible ? normalColor : transparentColor,
                    borderVisible: false,
                    wickUpColor: isVisible ? normalColor : transparentColor,
                    wickDownColor: isVisible ? normalColor : transparentColor,
                    lastValueVisible: false,
                    priceLineVisible: false,
                });
            }
            
            if (series) {
                seriesRefs.current.set(tokenKey, series);
                
                // Set data for the series
                const chartData = tokenData
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .map(d => chartType === 'line' 
                        ? { time: d.timestamp as any, value: d.close }
                        : { time: d.timestamp as any, open: d.open, high: d.high, low: d.low, close: d.close }
                    );
                
                series.setData(chartData);
            }
        }
    });
    
}, [data, chartType, /* remove visibleTokens from dependencies */]);
```

#### 2. Separate Visibility Control Effect
```typescript
// ✅ SOLUTION: Handle visibility changes separately via color updates
useEffect(() => {
    if (!chartRef.current) return;
    
    // Update existing series visibility via color changes
    seriesRefs.current.forEach((series, tokenKey) => {
        const [ca, symbol] = tokenKey.split(':');
        const isVisible = visibleTokens.has(ca);
        const transparentColor = 'rgba(0,0,0,0)';
        const normalColor = tokenColorsByCA[ca] || tokenColors[symbol] || '#2962ff';
        
        if (chartType === 'line') {
            series.applyOptions({
                color: isVisible ? normalColor : transparentColor,
                lineWidth: isVisible ? (tokenLineWeights[ca] || 2) : 0,
            });
        } else if (chartType === 'candlestick') {
            series.applyOptions({
                upColor: isVisible ? normalColor : transparentColor,
                downColor: isVisible ? normalColor : transparentColor,
                wickUpColor: isVisible ? normalColor : transparentColor,
                wickDownColor: isVisible ? normalColor : transparentColor,
            });
        }
    });
    
}, [visibleTokens, tokenColors, tokenColorsByCA, tokenLineWeights, chartType]);
```

#### 3. Remove AutoScale Prevention Attempts
```typescript
// ❌ Remove these - they don't work with series recreation:
// Lines 244-245, 294-295, 342-343, 354-356, 416-417
// chart.priceScale('right').applyOptions({ autoScale: false })

// ✅ Keep only the basic config:
rightPriceScale: {
    borderColor: '#363a45',
    autoScale: false,  // This is fine for basic prevention
},
```

## Key Principles

### Do This ✅
1. **Create all series upfront** - even for invisible tokens
2. **Use transparency** (`rgba(0,0,0,0)`) instead of removing series
3. **Load data for all symbols** - not just visible ones
4. **Toggle colors only** - via `series.applyOptions()`
5. **Avoid series recreation** except for chart type changes
6. **Remove WebSocket reconnections** that cause data refetching

### Don't Do This ❌
1. **Don't remove series** for visibility control
2. **Don't recreate series** on visibility changes
3. **Don't use `visible: false`** - use transparent colors instead
4. **Don't add visibility dependencies** to data update effects
5. **Don't repeatedly call** `chart.priceScale('right').applyOptions({ autoScale: false })`
6. **Don't call `fitContent()`** after data updates

## Testing the Solution

### Verify AutoScale is Prevented:
1. Load chart with data
2. Zoom into specific area
3. Toggle symbol/token visibility
4. Verify chart stays zoomed in same position
5. Let new data arrive via WebSocket
6. Verify zoom position is preserved

### Expected Behavior:
- **Symbol toggle**: Instant show/hide via transparency
- **Zoom preservation**: Position maintained during all operations  
- **Performance**: No lag from series recreation
- **Data continuity**: All symbols receive live updates

## Common Pitfalls

1. **Chart Type Changes**: You still need series recreation when switching between candlestick/line/bar
2. **Color Updates**: Must update ALL color properties (up/down/wick colors for candlesticks)  
3. **Data Dependencies**: Don't include `visibleTokens` in data update effect dependencies
4. **WebSocket Handling**: Avoid reconnection patterns that refetch and recreate series
5. **Line Width**: Set `lineWidth: 0` for transparent line series to fully hide them

## Implementation Checklist

- [ ] Create all series with transparency for invisible ones
- [ ] Use `series.applyOptions()` for visibility toggling  
- [ ] Remove series recreation from visibility changes
- [ ] Load data for all symbols upfront
- [ ] Separate visibility effects from data effects
- [ ] Remove WebSocket reconnection patterns
- [ ] Test zoom preservation during symbol toggles
- [ ] Verify performance improvements

This approach completely eliminates autoscaling while maintaining full functionality and improving performance.