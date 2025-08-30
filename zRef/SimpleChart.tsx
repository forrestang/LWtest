import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createChart, ColorType, CandlestickSeries, LineSeries, BarSeries, createSeriesMarkers } from 'lightweight-charts'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import { applyDataTransformation, type PriceMode } from '../utils/dataTransform'
import { findClosestBarTimestamp, type Timeframe, snapToTimeframeInterval } from '../utils/timeframeUtils'
import { calculateStatisticalBands } from '../utils/statisticalBands'
import { type StatisticalBandConfig, type ChartTooltipConfig, type ProximityIndicatorConfig, type ProximityIndicatorPoint, type OHLCVData } from '../lib/types'

type ChartType = 'candlestick' | 'ohlc' | 'line'

interface SimpleChartProps {
  data: OHLCVData[]
  chartType?: ChartType
  visibleTokens?: Set<string>
  tokenColors?: Record<string, string>
  tokenColorsByCA?: Record<string, string>
  tokenLineStyles?: Record<string, 'solid' | 'dashed' | 'dotted'>
  tokenLineWeights?: Record<string, number>
  autoScaleTrigger?: number
  yAutoScaleTrigger?: number
  xAutoScaleTrigger?: number
  sliderPosition?: number
  priceMode?: PriceMode
  decimals?: number
  currentTimeframe?: Timeframe
  stableTimestampRange?: { minTimestamp: number; maxTimestamp: number } | null
  statisticalBandConfig?: StatisticalBandConfig
  chartTooltipConfig?: ChartTooltipConfig
  proximityIndicatorConfig?: ProximityIndicatorConfig
  proximityIndicatorData?: ProximityIndicatorPoint[]
}

const SimpleChart: React.FC<SimpleChartProps> = ({ 
  data, 
  chartType = 'line',
  visibleTokens = new Set(),
  tokenColors = {},
  tokenColorsByCA = {},
  tokenLineStyles = {},
  tokenLineWeights = {},
  autoScaleTrigger,
  yAutoScaleTrigger,
  xAutoScaleTrigger,
  sliderPosition = 0,
  priceMode = 'absolute',
  decimals = 2,
  currentTimeframe = 'M5',
  stableTimestampRange = null,
  statisticalBandConfig,
  chartTooltipConfig,
  proximityIndicatorConfig,
  proximityIndicatorData
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRefs = useRef<Map<string, ISeriesApi<any>>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const tokenIndicatorSeriesRefs = useRef<Map<string, ISeriesApi<any>>>(new Map())
  const tokenMarkersRefs = useRef<Map<string, any>>(new Map())
  
  
  // Tooltip positioning state for HTML overlay
  const [tooltipPosition, setTooltipPosition] = useState({ x: 30, y: 10 })
  const [tooltipDimensions, setTooltipDimensions] = useState({ width: 0, height: 0 })
  
  // Tooltip state with session persistence  
  const [showTooltip, setShowTooltip] = useState(false)

  // Load tooltip show state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('HL_chartTooltipShowState')
    if (saved) {
      setShowTooltip(JSON.parse(saved))
    }
  }, [])

  // Save tooltip show state to localStorage
  useEffect(() => {
    localStorage.setItem('HL_chartTooltipShowState', JSON.stringify(showTooltip))
  }, [showTooltip])

  // Memoize filtered data to avoid recalculation
  const filteredData = useMemo(() => {
    if (!data || data.length === 0 || visibleTokens.size === 0) return []
    
    // Get visible CAs directly from visibleTokens Set
    const visibleCAs = Array.from(visibleTokens)
    
    // Apply data transformation based on slider position and price mode
    const transformedData = applyDataTransformation({
      data,
      visibleCAs,
      sliderPosition,
      priceMode,
      stableTimestampRange
    })

    // Filter data by visible symbols
    return transformedData.filter(d => visibleTokens.has(d.CA))
  }, [data, visibleTokens, sliderPosition, priceMode, stableTimestampRange])

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    // Create chart with modern v5.0.8 options
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#ffffff',
      },
      grid: {
        vertLines: { color: '#363a45' },
        horzLines: { color: '#363a45' },
      },
      crosshair: {
        mode: 0, // Normal crosshair
        vertLine: {
          width: 1,
          color: '#ffffff',
          style: 2, // Dashed
        },
        horzLine: {
          width: 1,
          color: '#ffffff',
          style: 2, // Dashed
        },
      },
      rightPriceScale: {
        borderColor: '#363a45',
        scaleMargins: {
          top: 0.02,
          bottom: 0.02,
        },
        autoScale: false,  // Disable auto-scaling completely
      },
      timeScale: {
        borderColor: '#363a45',
        timeVisible: true,
        secondsVisible: false,
        // Removed restrictive options to allow normal user panning and zooming
        // while keeping auto-scaling disabled via rightPriceScale.autoScale: false
      },
    })

    chartRef.current = chart

    // IMMEDIATELY disable autoScale after chart creation
    chart.priceScale('right').applyOptions({ autoScale: false })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
          rightPriceScale: {
            borderColor: '#363a45',
            scaleMargins: {
              top: 0.02,
              bottom: 0.02,
            },
            autoScale: false, // CRITICAL: Preserve autoScale: false during resize
          },
        })
        // CRITICAL: Re-disable autoScale after resize as applyOptions might reset it
        chart.priceScale('right').applyOptions({ autoScale: false })
      }
    })
    
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      if (chart) {
        chart.remove()
      }
      chartRef.current = null
      seriesRefs.current.clear()
    }
  }, [])

  // Update chart data when filteredData or chartType changes
  useEffect(() => {
    if (!chartRef.current || !filteredData.length) {
      // Clear all series if no data
      seriesRefs.current.forEach(series => chartRef.current?.removeSeries(series))
      seriesRefs.current.clear()
      return
    }

    const chart = chartRef.current

    // Clear existing series
    seriesRefs.current.forEach(series => chart.removeSeries(series))
    seriesRefs.current.clear()

    if (chartType === 'line') {
      // Group data by CA+symbol combination for line charts
      const dataByToken = new Map<string, OHLCVData[]>()
      filteredData.forEach(d => {
        const tokenKey = `${d.CA}:${d.symbol}`
        if (!dataByToken.has(tokenKey)) {
          dataByToken.set(tokenKey, [])
        }
        dataByToken.get(tokenKey)!.push(d)
      })

      // Create line series for each token
      dataByToken.forEach((tokenData, tokenKey) => {
        const [ca, symbol] = tokenKey.split(':')
        const color = tokenColorsByCA[ca] || tokenColors[symbol] || '#2962ff'
        const lineWeight = tokenLineWeights[ca] || 2
        
        // Create line series using modern v5.0.8 API
        const lineSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: lineWeight,
          lastValueVisible: false,     // Hide last price marker
          priceLineVisible: false,     // Hide horizontal price line
        })

        // Convert data format for Lightweight Charts with deduplication
        const uniqueData = new Map<number, OHLCVData>()
        tokenData.forEach(d => {
          // Keep the last entry for each timestamp (most recent data)
          uniqueData.set(d.timestamp, d)
        })
        
        const chartData = Array.from(uniqueData.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(d => ({
            time: d.timestamp as any,
            value: d.close,
          }))

        lineSeries.setData(chartData)
        // IMMEDIATELY disable autoScale after setData() as it can trigger auto-scaling
        chart.priceScale('right').applyOptions({ autoScale: false })
        seriesRefs.current.set(tokenKey, lineSeries)
      })

    } else if (chartType === 'candlestick') {
      // Group data by CA+symbol combination for candlestick charts
      const dataByToken = new Map<string, OHLCVData[]>()
      filteredData.forEach(d => {
        const tokenKey = `${d.CA}:${d.symbol}`
        if (!dataByToken.has(tokenKey)) {
          dataByToken.set(tokenKey, [])
        }
        dataByToken.get(tokenKey)!.push(d)
      })

      // Create candlestick series for each token
      dataByToken.forEach((tokenData, tokenKey) => {
        const [ca, symbol] = tokenKey.split(':')
        const tokenColor = tokenColorsByCA[ca] || tokenColors[symbol] || '#2962ff'
        
        // Deduplicate data for this token
        const uniqueData = new Map<number, OHLCVData>()
        tokenData.forEach(d => {
          uniqueData.set(d.timestamp, d)
        })
        
        const chartData = Array.from(uniqueData.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(d => ({
            time: d.timestamp as any,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))

        if (chartData.length > 0) {
          // Create candlestick series using modern v5.0.8 API with token colors
          const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: tokenColor,
            downColor: tokenColor,
            borderVisible: false,
            wickUpColor: tokenColor,
            wickDownColor: tokenColor,
            lastValueVisible: false,     // Hide last price marker
            priceLineVisible: false,     // Hide horizontal price line
          })

          candlestickSeries.setData(chartData)
          // IMMEDIATELY disable autoScale after setData() as it can trigger auto-scaling
          chart.priceScale('right').applyOptions({ autoScale: false })
          seriesRefs.current.set(tokenKey, candlestickSeries)
        }
      })

    } else if (chartType === 'ohlc') {
      // Group data by CA+symbol combination for OHLC charts
      const dataByToken = new Map<string, OHLCVData[]>()
      filteredData.forEach(d => {
        const tokenKey = `${d.CA}:${d.symbol}`
        if (!dataByToken.has(tokenKey)) {
          dataByToken.set(tokenKey, [])
        }
        dataByToken.get(tokenKey)!.push(d)
      })

      // Create bar series for each token
      dataByToken.forEach((tokenData, tokenKey) => {
        const [ca, symbol] = tokenKey.split(':')
        const tokenColor = tokenColorsByCA[ca] || tokenColors[symbol] || '#2962ff'
        
        // Deduplicate data for this token
        const uniqueData = new Map<number, OHLCVData>()
        tokenData.forEach(d => {
          uniqueData.set(d.timestamp, d)
        })
        
        const chartData = Array.from(uniqueData.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(d => ({
            time: d.timestamp as any,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))

        if (chartData.length > 0) {
          // Create bar series using modern v5.0.8 API with token colors
          const barSeries = chart.addSeries(BarSeries, {
            upColor: tokenColor,
            downColor: tokenColor,
            lastValueVisible: false,     // Hide last price marker
            priceLineVisible: false,     // Hide horizontal price line
          })

          barSeries.setData(chartData)
          // IMMEDIATELY disable autoScale after setData() as it can trigger auto-scaling
          chart.priceScale('right').applyOptions({ autoScale: false })
          seriesRefs.current.set(tokenKey, barSeries)
        }
      })
    }

    // Auto-fit content initially - DISABLED to prevent auto-scaling
    // chart.timeScale().fitContent()

    // FORCE disable auto-scaling after all data updates
    // This ensures Y-axis doesn't auto-scale when setData() is called on series
    if (chart) {
      chart.priceScale('right').applyOptions({ autoScale: false })
    }

    // SIMPLE TEST BAND - Just try to get ONE line visible
    if (statisticalBandConfig?.enabled && filteredData.length) {
      const visibleCAs = Array.from(visibleTokens)
      
      // Calculate statistical bands
      const bandPoints = calculateStatisticalBands(
        filteredData,
        visibleCAs,
        statisticalBandConfig,
        sliderPosition,
        stableTimestampRange
      )
      
      if (bandPoints.length > 0) {
        // All 9 statistical bands using the exact working pattern
        const allBands = [
          { key: 'mean', dataKey: 'mean' as const, config: statisticalBandConfig.levels.mean },
          { key: 'band1_pos', dataKey: 'band1' as const, config: statisticalBandConfig.levels.band1 },
          { key: 'band2_pos', dataKey: 'band2' as const, config: statisticalBandConfig.levels.band2 },
          { key: 'band3_pos', dataKey: 'band3' as const, config: statisticalBandConfig.levels.band3 },
          { key: 'band4_pos', dataKey: 'band4' as const, config: statisticalBandConfig.levels.band4 },
          { key: 'band1_neg', dataKey: 'band1Neg' as const, config: statisticalBandConfig.levels.band1 },
          { key: 'band2_neg', dataKey: 'band2Neg' as const, config: statisticalBandConfig.levels.band2 },
          { key: 'band3_neg', dataKey: 'band3Neg' as const, config: statisticalBandConfig.levels.band3 },
          { key: 'band4_neg', dataKey: 'band4Neg' as const, config: statisticalBandConfig.levels.band4 }
        ]

        allBands.forEach(({ key, dataKey, config }) => {
          // Skip if band is disabled
          if (!config.enabled) return

          // Convert line style to LightWeight Charts format
          let lineStyle = 0 // Solid
          switch (config.lineStyle) {
            case 'dotted': lineStyle = 1; break
            case 'dashed': lineStyle = 2; break
            case 'longdash': lineStyle = 3; break
            case 'dashdot': lineStyle = 4; break
            default: lineStyle = 0
          }

          // Create band series using EXACT working pattern
          const bandSeries = chart.addSeries(LineSeries, {
            color: config.color,
            lineWidth: config.lineWeight,
            lineStyle: lineStyle,
            lastValueVisible: false,
            priceLineVisible: false,
          })

          // Format data exactly like working line series
          const chartData = bandPoints.map(point => ({
            time: point.timestamp as any, // Same format as working series
            value: point[dataKey]
          }))

          bandSeries.setData(chartData)
          
          // IMMEDIATELY disable autoScale after setData() like working series
          chart.priceScale('right').applyOptions({ autoScale: false })
          
          // Store reference
          seriesRefs.current.set(`band_${key}`, bandSeries)
        })
      }
    }

  }, [filteredData, chartType, tokenColors, tokenColorsByCA, tokenLineWeights, statisticalBandConfig, sliderPosition, stableTimestampRange, visibleTokens])

  // Clean up band series when bands are disabled
  useEffect(() => {
    if (!statisticalBandConfig?.enabled || !chartRef.current) {
      // Remove existing band series
      const existingBandSeries = Array.from(seriesRefs.current.entries())
        .filter(([key]) => key.startsWith('band_'))
      existingBandSeries.forEach(([key, series]) => {
        chartRef.current?.removeSeries(series)
        seriesRefs.current.delete(key)
      })
    }
  }, [statisticalBandConfig?.enabled])

  // Manage individual token indicator series lifecycle
  useEffect(() => {
    if (!chartRef.current) return

    const chart = chartRef.current
    const isEnabled = proximityIndicatorConfig?.proximityMode !== 'disabled'
    const visibleTokenCAs = Array.from(visibleTokens)

    if (isEnabled) {
      // Create/update token indicator series for each visible token
      visibleTokenCAs.forEach(tokenCA => {
        if (!tokenIndicatorSeriesRefs.current.has(tokenCA)) {
          // Create new indicator series for this token
          const tokenColor = tokenColors[tokenCA] || tokenColorsByCA?.[tokenCA] || '#333333'
          const indicatorSeries = chart.addSeries(LineSeries, {
            color: tokenColor, // Make series visible with token color for debugging
            lineWidth: 1,
            visible: true, // Make series visible
            lastValueVisible: false,
            priceLineVisible: false,
          }, 1) // Pane index 1 - indicator pane

          tokenIndicatorSeriesRefs.current.set(tokenCA, indicatorSeries)
          
          // Create markers instance for this token series
          const tokenMarkers = createSeriesMarkers(indicatorSeries, [])
          tokenMarkersRefs.current.set(tokenCA, tokenMarkers)

          console.log(`ProximityIndicator: Created series for token ${tokenCA}`)
        }
      })

      // Set indicator pane height (only needs to be done once)
      const indicatorPane = chart.panes()[1]
      if (indicatorPane) {
        indicatorPane.setHeight(40)
      }

      // Remove series for tokens that are no longer visible
      const currentTokenCAs = Array.from(tokenIndicatorSeriesRefs.current.keys())
      currentTokenCAs.forEach(tokenCA => {
        if (!visibleTokenCAs.includes(tokenCA)) {
          const series = tokenIndicatorSeriesRefs.current.get(tokenCA)
          const markers = tokenMarkersRefs.current.get(tokenCA)
          
          try {
            if (markers) {
              markers.setMarkers([])
            }
            if (series) {
              chart.removeSeries(series)
            }
            tokenIndicatorSeriesRefs.current.delete(tokenCA)
            tokenMarkersRefs.current.delete(tokenCA)
            console.log(`ProximityIndicator: Removed series for token ${tokenCA}`)
          } catch (error) {
            console.warn(`Error removing series for token ${tokenCA}:`, error)
          }
        }
      })

    } else {
      // Cleanup all token series when proximity mode is disabled
      const allTokenCAs = Array.from(tokenIndicatorSeriesRefs.current.keys())
      allTokenCAs.forEach(tokenCA => {
        const series = tokenIndicatorSeriesRefs.current.get(tokenCA)
        const markers = tokenMarkersRefs.current.get(tokenCA)
        
        try {
          if (markers) {
            markers.setMarkers([])
          }
          if (series) {
            // Check if series still exists in the chart before removing
            const chartSeries = chart.panes()
              .flatMap(pane => pane.getSeries())
              .find(s => s === series)
            
            if (chartSeries) {
              chart.removeSeries(series)
            }
          }
        } catch (error) {
          console.warn(`Error cleaning up series for token ${tokenCA}:`, error)
        }
      })
      
      tokenIndicatorSeriesRefs.current.clear()
      tokenMarkersRefs.current.clear()
      console.log('ProximityIndicator: Cleaned up all token series - proximity disabled')
    }
  }, [proximityIndicatorConfig?.proximityMode, visibleTokens, tokenColors, tokenColorsByCA])

  // Update token indicator series data with flat y=0 values
  useEffect(() => {
    if (proximityIndicatorConfig?.proximityMode !== 'disabled' && filteredData.length > 0) {
      // Group data by token CA
      const dataByToken = new Map<string, OHLCVData[]>()
      filteredData.forEach(d => {
        if (!dataByToken.has(d.CA)) {
          dataByToken.set(d.CA, [])
        }
        dataByToken.get(d.CA)!.push(d)
      })

      // Update each token's indicator series with flat data
      tokenIndicatorSeriesRefs.current.forEach((series, tokenCA) => {
        const tokenData = dataByToken.get(tokenCA)
        if (tokenData && tokenData.length > 0) {
          // Create flat data (y=0) for all timestamps for this token
          const flatData = tokenData
            .map(d => ({
              time: d.timestamp as any,
              value: 0
            }))
            .sort((a, b) => a.time - b.time)
          
          // Remove duplicate timestamps
          const uniqueData = flatData.filter((item, index, arr) => 
            index === 0 || arr[index - 1].time !== item.time
          )

          series.setData(uniqueData)
          console.log(`ProximityIndicator: Updated series data for ${tokenCA} with ${uniqueData.length} points`)
        }
      })
    }
  }, [filteredData, proximityIndicatorConfig?.proximityMode])

  // Update proximity indicator markers - USE INDIVIDUAL TOKEN SERIES
  useEffect(() => {
    if (proximityIndicatorConfig?.proximityMode !== 'disabled' && proximityIndicatorData && proximityIndicatorData.length > 0) {
      // Group proximity data by token CA
      const proximityByToken = new Map<string, Array<{time: any, triggeredLevels: string[]}>>()
      
      proximityIndicatorData.forEach(point => {
        Object.entries(point.tokenProximity).forEach(([tokenCA, proximity]) => {
          if (proximity.proximityValue === 1 && proximity.triggeredLevels.length > 0) {
            if (!proximityByToken.has(tokenCA)) {
              proximityByToken.set(tokenCA, [])
            }
            proximityByToken.get(tokenCA)!.push({
              time: point.timestamp as any,
              triggeredLevels: proximity.triggeredLevels
            })
          }
        })
      })

      // Update markers for each token on its individual series
      tokenMarkersRefs.current.forEach((tokenMarkers, tokenCA) => {
        const tokenProximityData = proximityByToken.get(tokenCA) || []
        const tokenColor = tokenColors[tokenCA] || tokenColorsByCA?.[tokenCA] || '#ffffff'
        
        // Create markers for this token - make them highly visible
        const markers = tokenProximityData.map(proximity => ({
          time: proximity.time,
          position: 'aboveBar' as const, // Try aboveBar for better visibility
          color: tokenColor,
          shape: 'circle' as const,
          size: 'large' as const, // Use large size
          text: 'P' // Add text to make them obvious
        }))

        // Set markers on this token's series
        tokenMarkers.setMarkers(markers)
        
        if (markers.length > 0) {
          console.log(`ProximityIndicator: Set ${markers.length} markers for token ${tokenCA}`)
          console.log(`ProximityIndicator: Marker times for ${tokenCA}:`, markers.map(m => new Date(m.time * 1000)))
        }
      })

      // Clear markers for tokens that don't have proximity data
      tokenMarkersRefs.current.forEach((tokenMarkers, tokenCA) => {
        if (!proximityByToken.has(tokenCA)) {
          tokenMarkers.setMarkers([])
        }
      })

    } else {
      // Clear all markers when no proximity data
      tokenMarkersRefs.current.forEach((tokenMarkers) => {
        tokenMarkers.setMarkers([])
      })
    }
  }, [proximityIndicatorData, tokenColors, tokenColorsByCA, proximityIndicatorConfig?.proximityMode])

  // AUTO-SCALING COMPLETELY DISABLED
  // All auto-scale triggers have been disabled to prevent unwanted chart scaling
  // The following effects are intentionally left empty:
  useEffect(() => { /* autoScaleTrigger disabled */ }, [autoScaleTrigger])
  useEffect(() => { /* yAutoScaleTrigger disabled */ }, [yAutoScaleTrigger])
  useEffect(() => { /* xAutoScaleTrigger disabled */ }, [xAutoScaleTrigger])

  // Handle empty data case
  if (!data || data.length === 0 || filteredData.length === 0) {
    const emptyMessage = visibleTokens.size === 0 
      ? 'No tokens in Chart List. Add tokens to see chart data.'
      : `No data available for ${currentTimeframe} timeframe`

    return (
      <div 
        ref={containerRef} 
        className="w-full h-full bg-chart-bg flex flex-col relative justify-center items-center"
        style={{ backgroundColor: '#000000' }}
        data-label="Simple Chart Container"
      >
        <div className="text-gray-400 text-center">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full bg-chart-bg flex flex-col relative"
      style={{ backgroundColor: '#000000' }}
      data-label="Simple Chart Container"
    >
      <div 
        ref={chartContainerRef}
        className="flex-1 w-full"
        data-label="Chart Area"
      />
      
      {/* HTML Tooltip Overlay */}
      {chartTooltipConfig?.enabled && showTooltip && chartTooltipConfig.message.trim() && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            width: `${tooltipDimensions.width}px`,
            height: `${tooltipDimensions.height}px`,
            backgroundColor: chartTooltipConfig.backgroundColor === 'transparent' ? 'rgba(0,0,0,0)' : chartTooltipConfig.backgroundColor,
            border: 'none',
            borderRadius: `${chartTooltipConfig.borderRadius}px`,
            opacity: chartTooltipConfig.opacity,
            padding: `${chartTooltipConfig.padding}px`,
            overflow: 'auto',
            fontSize: `${chartTooltipConfig.fontSize}px`,
            fontFamily: chartTooltipConfig.fontFamily,
            color: chartTooltipConfig.textColor
          }}
          data-label="Chart Tooltip HTML Overlay"
        >
          <div 
            className="prose prose-invert prose-sm max-w-none h-full overflow-auto"
            style={{
              fontSize: `${chartTooltipConfig.fontSize}px`,
              fontFamily: chartTooltipConfig.fontFamily,
              color: chartTooltipConfig.textColor
            }}
          >
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({node, ...props}) => <h1 className="text-lg font-bold mb-2 mt-0" {...props} />,
                h2: ({node, ...props}) => <h2 className="text-base font-semibold mb-1 mt-0" {...props} />,
                h3: ({node, ...props}) => <h3 className="text-sm font-medium mb-1 mt-0" {...props} />,
                p: ({node, ...props}) => <p className="mb-2 mt-0 leading-relaxed" {...props} />,
                ul: ({node, ...props}) => <ul className="list-disc list-inside mb-2 mt-0" {...props} />,
                ol: ({node, ...props}) => <ol className="list-decimal list-inside mb-2 mt-0" {...props} />,
                li: ({node, ...props}) => <li className="mb-1" {...props} />,
                code: ({node, ...props}) => {
                  const { inline } = props as any;
                  return inline ? 
                    <code className="bg-gray-700 px-1 rounded text-amber-400" {...props} /> :
                    <code className="block bg-gray-800 p-2 rounded mb-2 text-sm" {...props} />
                },
                pre: ({node, ...props}) => <pre className="bg-gray-800 p-2 rounded mb-2 overflow-x-auto text-sm" {...props} />,
                strong: ({node, ...props}) => <strong className="font-bold" {...props} />,
                em: ({node, ...props}) => <em className="italic" {...props} />,
                a: ({node, ...props}) => <a className="text-blue-400 hover:text-blue-300 underline" {...props} />
              }}
            >
              {chartTooltipConfig.message}
            </ReactMarkdown>
          </div>
        </div>
      )}
      
      {/* Tooltip Toggle Button */}
      {chartTooltipConfig?.enabled && (
        <div className="absolute top-2 left-2 z-20">
          <button
            onClick={() => setShowTooltip(!showTooltip)}
            className="w-4 h-4 border border-gray-400 bg-gray-800 text-white text-xs flex items-center justify-center hover:bg-gray-700 transition-colors"
            style={{ borderRadius: '2px' }}
          >
            {showTooltip ? '✓' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

export default SimpleChart