import { type StatisticalBandPoint, type StatisticalBandConfig, type OHLCVData } from '../lib/types'
import { getJsonItem, setJsonItem } from './localStorage'

export const defaultStatisticalBandConfig: StatisticalBandConfig = {
  enabled: false,
  useVwapStyle: false,
  levels: {
    mean: { enabled: true, sigmaValue: 0, color: '#ffffff', opacity: 0.6, lineWeight: 1, lineStyle: 'dotted' },
    band1: { enabled: true, sigmaValue: 1.0, color: '#4169e1', opacity: 0.3, lineWeight: 1, lineStyle: 'solid' },
    band2: { enabled: true, sigmaValue: 2.0, color: '#ff6b35', opacity: 0.3, lineWeight: 1, lineStyle: 'solid' },
    band3: { enabled: true, sigmaValue: 2.5, color: '#ffd23f', opacity: 0.3, lineWeight: 1, lineStyle: 'solid' },
    band4: { enabled: true, sigmaValue: 3.0, color: '#ee4266', opacity: 0.3, lineWeight: 1, lineStyle: 'solid' }
  },
  showFilledAreas: true
}

export function calculateStatisticalBands(
  data: OHLCVData[],
  visibleSymbols: string[],
  config: StatisticalBandConfig,
  sliderPosition?: number,
  stableTimestampRange?: { minTimestamp: number; maxTimestamp: number } | null
): StatisticalBandPoint[] {
  if (!data || data.length === 0 || visibleSymbols.length === 0) {
    return []
  }

  // Filter data to only include visible tokens (match by CA, not symbol)
  const filteredData = data.filter(d => visibleSymbols.includes(d.CA))
  
  if (filteredData.length === 0) {
    return []
  }

  // Choose calculation method based on config
  if (config.useVwapStyle) {
    return calculateVwapStyleBands(filteredData, config, sliderPosition, stableTimestampRange)
  } else {
    return calculateStandardBands(filteredData, config)
  }
}

function calculateStandardBands(filteredData: OHLCVData[], config: StatisticalBandConfig): StatisticalBandPoint[] {
  // Group data by timestamp
  const dataByTimestamp = new Map<number, OHLCVData[]>()
  
  filteredData.forEach(dataPoint => {
    if (!dataByTimestamp.has(dataPoint.timestamp)) {
      dataByTimestamp.set(dataPoint.timestamp, [])
    }
    dataByTimestamp.get(dataPoint.timestamp)!.push(dataPoint)
  })

  const bandPoints: StatisticalBandPoint[] = []

  // Calculate statistics for each timestamp
  dataByTimestamp.forEach((timestampData, timestamp) => {
    // Use close prices for statistical calculations
    const closePrices = timestampData.map(d => d.close)
    
    if (closePrices.length === 0) {
      return
    }

    // Calculate mean
    const mean = closePrices.reduce((sum, price) => sum + price, 0) / closePrices.length

    // Calculate standard deviation
    let standardDeviation = 0
    if (closePrices.length > 1) {
      const variance = closePrices.reduce((sum, price) => {
        const diff = price - mean
        return sum + (diff * diff)
      }, 0) / closePrices.length
      
      standardDeviation = Math.sqrt(variance)
    }

    // Create band point with mean + custom σ levels (with error handling)
    const getSigmaValue = (bandKey: keyof StatisticalBandConfig['levels'], fallback: number) => {
      try {
        return config.levels[bandKey]?.sigmaValue ?? fallback
      } catch {
        return fallback
      }
    }

    bandPoints.push({
      timestamp,
      mean,
      band1: mean + (standardDeviation * getSigmaValue('band1', 1.0)),
      band2: mean + (standardDeviation * getSigmaValue('band2', 2.0)),
      band3: mean + (standardDeviation * getSigmaValue('band3', 2.5)),
      band4: mean + (standardDeviation * getSigmaValue('band4', 3.0)),
      band1Neg: mean - (standardDeviation * getSigmaValue('band1', 1.0)),
      band2Neg: mean - (standardDeviation * getSigmaValue('band2', 2.0)),
      band3Neg: mean - (standardDeviation * getSigmaValue('band3', 2.5)),
      band4Neg: mean - (standardDeviation * getSigmaValue('band4', 3.0))
    })
  })

  // Sort by timestamp for consistent rendering
  return bandPoints.sort((a, b) => a.timestamp - b.timestamp)
}

function calculateVwapStyleBands(
  filteredData: OHLCVData[], 
  config: StatisticalBandConfig,
  sliderPosition?: number,
  stableTimestampRange?: { minTimestamp: number; maxTimestamp: number } | null
): StatisticalBandPoint[] {
  // Calculate rebase timestamp
  let rebaseTimestamp: number | null = null
  
  if (sliderPosition && sliderPosition > 0 && stableTimestampRange) {
    // Use stable timestamp range for consistency
    const { minTimestamp, maxTimestamp } = stableTimestampRange
    rebaseTimestamp = minTimestamp + (maxTimestamp - minTimestamp) * (sliderPosition / 100)
  }
  
  // Group data by timestamp
  const dataByTimestamp = new Map<number, OHLCVData[]>()
  
  filteredData.forEach(dataPoint => {
    if (!dataByTimestamp.has(dataPoint.timestamp)) {
      dataByTimestamp.set(dataPoint.timestamp, [])
    }
    dataByTimestamp.get(dataPoint.timestamp)!.push(dataPoint)
  })

  // Get sorted timestamps
  const sortedTimestamps = Array.from(dataByTimestamp.keys()).sort((a, b) => a - b)
  
  // Filter timestamps to only include those at or after rebase point
  const filteredTimestamps = rebaseTimestamp 
    ? sortedTimestamps.filter(timestamp => timestamp >= rebaseTimestamp!)
    : sortedTimestamps

  if (filteredTimestamps.length === 0) {
    return []
  }

  const bandPoints: StatisticalBandPoint[] = []
  const cumulativeGroupTPs: number[] = []

  // Calculate VWAP-style bands
  filteredTimestamps.forEach((timestamp) => {
    const timestampData = dataByTimestamp.get(timestamp)!
    
    // Step 1: Calculate Group Typical Price at this timestamp
    const tokenTPs = timestampData.map(d => (d.high + d.low + d.close) / 3)
    const groupTP = tokenTPs.reduce((sum, tp) => sum + tp, 0) / tokenTPs.length
    
    // Step 2: Add to cumulative array and calculate Group_MVWAP
    cumulativeGroupTPs.push(groupTP)
    const groupMVWAP = cumulativeGroupTPs.reduce((sum, tp) => sum + tp, 0) / cumulativeGroupTPs.length
    
    // Step 3: Calculate standard deviation from Group_MVWAP
    let standardDeviation = 0
    if (cumulativeGroupTPs.length > 1) {
      const variance = cumulativeGroupTPs.reduce((sum, tp) => {
        const diff = tp - groupMVWAP
        return sum + (diff * diff)
      }, 0) / cumulativeGroupTPs.length
      
      standardDeviation = Math.sqrt(variance)
    }

    // Create band point with Group_MVWAP + custom σ levels
    const getSigmaValue = (bandKey: keyof StatisticalBandConfig['levels'], fallback: number) => {
      try {
        return config.levels[bandKey]?.sigmaValue ?? fallback
      } catch {
        return fallback
      }
    }

    bandPoints.push({
      timestamp,
      mean: groupMVWAP,
      band1: groupMVWAP + (standardDeviation * getSigmaValue('band1', 1.0)),
      band2: groupMVWAP + (standardDeviation * getSigmaValue('band2', 2.0)),
      band3: groupMVWAP + (standardDeviation * getSigmaValue('band3', 2.5)),
      band4: groupMVWAP + (standardDeviation * getSigmaValue('band4', 3.0)),
      band1Neg: groupMVWAP - (standardDeviation * getSigmaValue('band1', 1.0)),
      band2Neg: groupMVWAP - (standardDeviation * getSigmaValue('band2', 2.0)),
      band3Neg: groupMVWAP - (standardDeviation * getSigmaValue('band3', 2.5)),
      band4Neg: groupMVWAP - (standardDeviation * getSigmaValue('band4', 3.0))
    })
  })

  return bandPoints
}

export function getStatisticalBandConfig(): StatisticalBandConfig {
  const parsedConfig = getJsonItem<StatisticalBandConfig>('statisticalBandConfig', null)
  if (parsedConfig) {
    try {
      
      // Handle migration from old format (sigma1, sigma2, etc.) to new format (band1, band2, etc.)
      if (parsedConfig.levels) {
        const levels = parsedConfig.levels
        
        // Check if using old format
        if ('sigma1' in levels || 'sigma2' in levels || 'sigma2_5' in levels || 'sigma3' in levels) {
          // Migrate old format to new format
          const migratedConfig: StatisticalBandConfig = {
            enabled: parsedConfig.enabled || false,
            useVwapStyle: false,
            showFilledAreas: parsedConfig.showFilledAreas || true,
            levels: {
              mean: {
                enabled: true,
                sigmaValue: 0,
                color: '#ffffff',
                opacity: 0.6,
                lineWeight: 1,
                lineStyle: 'dotted'
              },
              band1: {
                enabled: levels.sigma1?.enabled || true,
                sigmaValue: 1.0,
                color: levels.sigma1?.color || '#4169e1',
                opacity: levels.sigma1?.opacity || 0.3,
                lineWeight: 1,
                lineStyle: 'solid'
              },
              band2: {
                enabled: levels.sigma2?.enabled || true,
                sigmaValue: 2.0,
                color: levels.sigma2?.color || '#ff6b35',
                opacity: levels.sigma2?.opacity || 0.3,
                lineWeight: 1,
                lineStyle: 'solid'
              },
              band3: {
                enabled: levels.sigma2_5?.enabled || true,
                sigmaValue: 2.5,
                color: levels.sigma2_5?.color || '#ffd23f',
                opacity: levels.sigma2_5?.opacity || 0.3,
                lineWeight: 1,
                lineStyle: 'solid'
              },
              band4: {
                enabled: levels.sigma3?.enabled || true,
                sigmaValue: 3.0,
                color: levels.sigma3?.color || '#ee4266',
                opacity: levels.sigma3?.opacity || 0.3,
                lineWeight: 1,
                lineStyle: 'solid'
              }
            }
          }
          
          // Save migrated config
          saveStatisticalBandConfig(migratedConfig)
          return migratedConfig
        }
        
        // Check if new format but missing required properties (including mean and useVwapStyle)
        const bandKeys = ['mean', 'band1', 'band2', 'band3', 'band4'] as const
        let needsMigration = false
        
        // Check if useVwapStyle is missing
        if (typeof parsedConfig.useVwapStyle === 'undefined') {
          needsMigration = true
        }
        
        // Check if mean is missing or if any band is missing sigmaValue
        if (!levels.mean || typeof levels.mean.sigmaValue === 'undefined') {
          needsMigration = true
        }
        
        bandKeys.forEach(key => {
          if (levels[key] && typeof levels[key].sigmaValue === 'undefined') {
            needsMigration = true
          }
        })
        
        if (needsMigration) {
          // Add missing properties to existing bands
          const migratedLevels = { ...levels }
          bandKeys.forEach(key => {
            if (migratedLevels[key]) {
              migratedLevels[key] = {
                ...defaultStatisticalBandConfig.levels[key],
                ...migratedLevels[key]
              }
            } else {
              migratedLevels[key] = defaultStatisticalBandConfig.levels[key]
            }
          })
          
          const migratedConfig = {
            ...defaultStatisticalBandConfig,
            ...parsedConfig,
            levels: migratedLevels
          }
          
          saveStatisticalBandConfig(migratedConfig)
          return migratedConfig
        }
      }
      
      // Merge with defaults to ensure all properties exist
      return { 
        ...defaultStatisticalBandConfig, 
        ...parsedConfig,
        levels: {
          ...defaultStatisticalBandConfig.levels,
          ...parsedConfig.levels
        }
      }
    } catch (error) {
      return defaultStatisticalBandConfig
    }
  }
  return defaultStatisticalBandConfig
}

export function saveStatisticalBandConfig(config: StatisticalBandConfig): void {
  setJsonItem('statisticalBandConfig', config)
}