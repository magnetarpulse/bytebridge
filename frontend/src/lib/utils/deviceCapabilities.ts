/**
 * @file deviceCapabilities.ts
 * @description Device capability detection for adaptive performance tuning.
 * 
 * Dynamically detects hardware capabilities and calculates optimal processing
 * thresholds for file operations, worker management, and memory allocation.
 * Enables applications to scale from low-end mobile devices to high-performance
 * workstations without manual configuration.
 * 
 * Detection methods:
 * - CPU cores via navigator.hardwareConcurrency
 * - Available RAM via navigator.deviceMemory (Chromium only)
 * - Device form factor (mobile/tablet/desktop)
 * - Network connection via NetworkInformation API
 * 
 * Key Design Principles:
 * - Conservative defaults: Prefer stability over performance on unknown devices
 * - Fail-safe detection: Missing APIs fall back to safe assumptions
 * - Immutable results: All calculations are cached permanently
 * - Zero dependencies: Uses only standard Web APIs
 * 
 * @example
 * import { getDeviceCapabilities, getOptimalThresholds } from './deviceCapabilities';
 * 
 * const device = getDeviceCapabilities();
 * const thresholds = getOptimalThresholds();
 * 
 * if (totalSize > thresholds.multiWorkerThreshold) {
 *   enableParallelProcessing(thresholds.workerCount);
 * }
 */

/**
 * Default CPU cores when detection fails.
 * Conservative value ensures safe operation on older browsers.
 * 
 * @const {number}
 * @default 4
 */
const DEFAULT_CORE_COUNT = 4;

/**
 * Screen width threshold for mobile classification.
 * Aligns with standard CSS framework breakpoints.
 * 
 * @const {number}
 * @default 768
 */
const MOBILE_SCREEN_WIDTH_THRESHOLD = 768;

/**
 * Multi-worker activation threshold for LOW tier devices.
 * 
 * Files below this size are processed on the main thread. Above this size,
 * the system spawns workers for parallel processing. Low-end devices use
 * a conservative threshold to avoid excessive worker overhead.
 * 
 * Why 25MB:
 * - Worker spawn overhead (~50-100ms) becomes worthwhile
 * - Typical mobile browser memory constraints
 * - Prevents thrashing on resource-constrained devices
 * 
 * @const {number}
 * @default 26214400 (25 * 1024 * 1024 bytes)
 */
const LOW_TIER_MULTI_WORKER_THRESHOLD = 25 * 1024 * 1024; // 25MB

/**
 * Multi-worker activation threshold for MEDIUM tier devices.
 * 
 * @const {number}
 * @default 52428800 (50 * 1024 * 1024 bytes)
 */
const MEDIUM_TIER_MULTI_WORKER_THRESHOLD = 50 * 1024 * 1024; // 50MB

/**
 * Multi-worker activation threshold for HIGH tier devices.
 * 
 * @const {number}
 * @default 104857600 (100 * 1024 * 1024 bytes)
 */
const HIGH_TIER_MULTI_WORKER_THRESHOLD = 100 * 1024 * 1024; // 100MB

/**
 * Multi-worker activation threshold for ULTRA tier devices.
 * 
 * Workstation-class machines can handle large worker overhead efficiently.
 * 
 * @const {number}
 * @default 157286400 (150 * 1024 * 1024 bytes)
 */
const ULTRA_TIER_MULTI_WORKER_THRESHOLD = 150 * 1024 * 1024; // 150MB

/**
 * Large folder warning thresholds by tier.
 * Alerts users when folder size may impact performance.
 * 
 * @const {number}
 */
const LOW_TIER_LARGE_FOLDER_THRESHOLD = 500;
const MEDIUM_TIER_LARGE_FOLDER_THRESHOLD = 1000;
const HIGH_TIER_LARGE_FOLDER_THRESHOLD = 2500;
const ULTRA_TIER_LARGE_FOLDER_THRESHOLD = 5000;

/**
 * Maximum concurrent file processing by tier.
 * Prevents memory exhaustion from loading too many files simultaneously.
 * 
 * @const {number}
 */
const LOW_TIER_MAX_CONCURRENT_FILES = 50;
const MEDIUM_TIER_MAX_CONCURRENT_FILES = 100;
const HIGH_TIER_MAX_CONCURRENT_FILES = 250;
const ULTRA_TIER_MAX_CONCURRENT_FILES = 500;

/**
 * Streaming chunk sizes by tier.
 * Balance between memory usage and processing overhead.
 * 
 * @const {number}
 */
const LOW_TIER_CHUNK_SIZE = 1 * 1024 * 1024;    // 1MB
const MEDIUM_TIER_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
const HIGH_TIER_CHUNK_SIZE = 5 * 1024 * 1024;   // 5MB
const ULTRA_TIER_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Target memory limits by tier.
 * Soft limits for application memory management.
 * 
 * @const {number}
 */
const LOW_TIER_MEMORY_LIMIT = 100 * 1024 * 1024; // 100MB
const MEDIUM_TIER_MEMORY_LIMIT = 250 * 1024 * 1024; // 250MB
const HIGH_TIER_MEMORY_LIMIT = 500 * 1024 * 1024; // 500MB
const ULTRA_TIER_MEMORY_LIMIT = 1 * 1024 * 1024 * 1024; // 1GB

/**
 * Tier classification thresholds.
 * 
 * @const {number}
 */
const HIGH_TIER_MIN_MEMORY_GB = 8;
const ULTRA_TIER_MIN_MEMORY_GB = 16;
const HIGH_TIER_MIN_CORES = 4;
const ULTRA_TIER_MIN_CORES = 8;
const MEDIUM_TIER_MIN_CORES = 3;
const MEDIUM_TIER_MIN_MEMORY_GB = 4;
const LOW_TIER_THRESHOLD_CORES = 2;

/**
 * Worker count limits by tier and device type.
 * Mobile devices limited to preserve battery life.
 * 
 * @const {number}
 */
const MOBILE_MAX_WORKERS = 2;
const LOW_TIER_MAX_WORKERS = 2;
const MEDIUM_TIER_MAX_WORKERS = 3;
const HIGH_TIER_MAX_WORKERS = 4;

/** @const {number} @default 4 */
const MOBILE_MEDIUM_TIER_MIN_CORES = 4;

/** @const {number} @default 5 */
const CORES_ONLY_HIGH_TIER_THRESHOLD = 5;

/**
 * Device performance tier classification.
 * 
 * @enum {string}
 */
export enum DeviceTier {
  /** Low-end: 1-2 cores, <4GB RAM, mobile. Conservative resource usage. */
  LOW = 'LOW',
  /** Mid-range: 2-4 cores, 4-8GB RAM. Balanced performance. */
  MEDIUM = 'MEDIUM',
  /** High-end: 4-8 cores, 8-16GB RAM. Aggressive optimization. */
  HIGH = 'HIGH',
  /** Workstation: 8+ cores, 16GB+ RAM. Maximum performance. */
  ULTRA = 'ULTRA',
}

/**
 * Network connection type from NetworkInformation API.
 * 
 * @enum {string}
 */
export enum ConnectionType {
  SLOW_2G = 'slow-2g',
  TWO_G = '2g',
  THREE_G = '3g',
  FOUR_G = '4g',
  UNKNOWN = 'unknown',
}

/**
 * Detected device capabilities and characteristics.
 * 
 * @interface DeviceCapabilities
 * 
 * @property {number} cores - Logical CPU cores from navigator.hardwareConcurrency
 *   Range: 1-128+, Default: 4
 * 
 * @property {number | null} memoryGB - RAM in GB from navigator.deviceMemory
 *   Chromium only, rounded to power of 2. null in Firefox/Safari.
 * 
 * @property {DeviceTier} tier - Performance classification tier
 * 
 * @property {boolean} isMobile - Mobile/tablet device detected via UA + touch + screen size
 * 
 * @property {boolean} isLowEnd - Convenience flag for tier === LOW
 * 
 * @property {ConnectionType} connectionType - Effective connection type
 *   From navigator.connection (Chromium only)
 * 
 * @property {number} maxWorkers - Recommended worker count
 *   Always reserves 1 core for main thread
 */
export interface DeviceCapabilities {
  cores: number;
  memoryGB: number | null;
  tier: DeviceTier;
  isMobile: boolean;
  isLowEnd: boolean;
  connectionType: ConnectionType;
  maxWorkers: number;
}

/**
 * Adaptive thresholds based on device capabilities.
 * 
 * @interface AdaptiveThresholds
 * 
 * @property {number} multiWorkerThreshold - Size threshold for multi-worker processing (bytes)
 *   Range: 25MB-150MB by tier
 * 
 * @property {number} largeFolderThreshold - File count for folder warnings
 *   Range: 500-5000 by tier
 * 
 * @property {number} maxConcurrentFiles - Max simultaneous file operations
 *   Range: 50-500 by tier
 * 
 * @property {number} chunkSize - Streaming chunk size (bytes)
 *   Range: 1MB-10MB by tier
 * 
 * @property {number} memoryLimit - Target memory ceiling (bytes)
 *   Range: 100MB-1GB by tier
 * 
 * @property {number} workerCount - Recommended worker count
 */
export interface AdaptiveThresholds {
  multiWorkerThreshold: number;
  largeFolderThreshold: number;
  maxConcurrentFiles: number;
  chunkSize: number;
  memoryLimit: number;
  workerCount: number;
}

/**
 * Partial overrides for custom threshold configuration.
 * 
 * @interface ThresholdOverrides
 */
export interface ThresholdOverrides {
  multiWorkerThreshold?: number;
  largeFolderThreshold?: number;
  maxConcurrentFiles?: number;
  chunkSize?: number;
  memoryLimit?: number;
  workerCount?: number;
}

/**
 * Detects device hardware capabilities and characteristics.
 * 
 * Uses multiple detection methods with conservative fallbacks:
 * - CPU: navigator.hardwareConcurrency (default: 4)
 * - RAM: navigator.deviceMemory (default: null)
 * - Mobile: UA + touch + screen size
 * - Connection: navigator.connection (default: unknown)
 * 
 * Results are cached for page lifetime. Safe to call multiple times.
 * 
 * @returns {DeviceCapabilities} Device characteristics
 * 
 * @example
 * const device = getDeviceCapabilities();
 * console.log(`${device.tier} tier, ${device.cores} cores, ${device.memoryGB}GB RAM`);
 * 
 * if (device.isLowEnd) {
 *   disableAdvancedFeatures();
 * }
 * 
 * @performance O(1) with caching
 * @sideeffects None after first call (reads navigator properties once)
 */
export const getDeviceCapabilities = (() => {
  let cached: DeviceCapabilities | null = null;

  return (): DeviceCapabilities => {
    if (cached) {
      return cached;
    }

    const cores = navigator.hardwareConcurrency || DEFAULT_CORE_COUNT;
    const memoryGB = (navigator as any).deviceMemory || null;
    const isMobile = detectMobileDevice();
    const connectionType = detectConnectionType();
    const tier = calculateDeviceTier(cores, memoryGB, isMobile);
    const isLowEnd = tier === DeviceTier.LOW;
    const maxWorkers = calculateMaxWorkers(cores, tier, isMobile);

    cached = {
      cores,
      memoryGB,
      tier,
      isMobile,
      isLowEnd,
      connectionType,
      maxWorkers,
    };

    return cached;
  };
})();

/**
 * Calculates optimal processing thresholds based on device tier.
 * 
 * Returns device-optimized values for:
 * - Multi-worker activation thresholds
 * - Large folder warnings
 * - Concurrent file limits
 * - Chunk sizes
 * - Memory limits
 * - Worker counts
 * 
 * Results are cached. Safe to call multiple times.
 * 
 * @returns {AdaptiveThresholds} Device-optimized thresholds
 * 
 * @example
 * const thresholds = getOptimalThresholds();
 * 
 * if (fileSize > thresholds.multiWorkerThreshold) {
 *   processInWorkers(file, thresholds.workerCount);
 * }
 * 
 * const batches = chunk(files, thresholds.maxConcurrentFiles);
 * 
 * @performance O(1) with caching
 * @sideeffects None after first call
 */
export const getOptimalThresholds = (() => {
  let cached: AdaptiveThresholds | null = null;

  return (): AdaptiveThresholds => {
    if (cached) {
      return cached;
    }

    const device = getDeviceCapabilities();

    let multiWorkerThreshold: number;
    let largeFolderThreshold: number;
    let maxConcurrentFiles: number;
    let chunkSize: number;
    let memoryLimit: number;

    switch (device.tier) {
      case DeviceTier.LOW:
        multiWorkerThreshold = LOW_TIER_MULTI_WORKER_THRESHOLD;
        largeFolderThreshold = LOW_TIER_LARGE_FOLDER_THRESHOLD;
        maxConcurrentFiles = LOW_TIER_MAX_CONCURRENT_FILES;
        chunkSize = LOW_TIER_CHUNK_SIZE;
        memoryLimit = LOW_TIER_MEMORY_LIMIT;
        break;

      case DeviceTier.MEDIUM:
        multiWorkerThreshold = MEDIUM_TIER_MULTI_WORKER_THRESHOLD;
        largeFolderThreshold = MEDIUM_TIER_LARGE_FOLDER_THRESHOLD;
        maxConcurrentFiles = MEDIUM_TIER_MAX_CONCURRENT_FILES;
        chunkSize = MEDIUM_TIER_CHUNK_SIZE;
        memoryLimit = MEDIUM_TIER_MEMORY_LIMIT;
        break;

      case DeviceTier.HIGH:
        multiWorkerThreshold = HIGH_TIER_MULTI_WORKER_THRESHOLD;
        largeFolderThreshold = HIGH_TIER_LARGE_FOLDER_THRESHOLD;
        maxConcurrentFiles = HIGH_TIER_MAX_CONCURRENT_FILES;
        chunkSize = HIGH_TIER_CHUNK_SIZE;
        memoryLimit = HIGH_TIER_MEMORY_LIMIT;
        break;

      case DeviceTier.ULTRA:
        multiWorkerThreshold = ULTRA_TIER_MULTI_WORKER_THRESHOLD;
        largeFolderThreshold = ULTRA_TIER_LARGE_FOLDER_THRESHOLD;
        maxConcurrentFiles = ULTRA_TIER_MAX_CONCURRENT_FILES;
        chunkSize = ULTRA_TIER_CHUNK_SIZE;
        memoryLimit = ULTRA_TIER_MEMORY_LIMIT;
        break;
    }

    cached = {
      multiWorkerThreshold,
      largeFolderThreshold,
      maxConcurrentFiles,
      chunkSize,
      memoryLimit,
      workerCount: device.maxWorkers,
    };

    return cached;
  };
})();

/**
 * Creates custom thresholds by overriding device-optimized defaults.
 * 
 * Allows specialized use cases to adjust thresholds while keeping
 * device-appropriate defaults for non-overridden values.
 * 
 * @param {ThresholdOverrides} overrides - Partial threshold overrides
 * @returns {AdaptiveThresholds} Merged thresholds
 * 
 * @example
 * // Override for low-latency scenario
 * const thresholds = createCustomThresholds({
 *   chunkSize: 512 * 1024, // 512KB for faster progress updates
 *   maxConcurrentFiles: 10  // Limit concurrency for real-time processing
 * });
 * 
 * @performance O(1)
 * @sideeffects None, it is a pure function
 */
export function createCustomThresholds(
  overrides: ThresholdOverrides
): AdaptiveThresholds {
  const defaults = getOptimalThresholds();
  return { ...defaults, ...overrides };
}

/**
 * Gets human-readable description of device capabilities.
 * 
 * @returns {string} Device description for logging/debugging
 * 
 * @example
 * console.log(getDeviceDescription());
 * // "HIGH-tier desktop with 8 cores, 16GB RAM, 4g connection"
 * 
 * @performance O(1)
 * @sideeffects None
 */
export function getDeviceDescription(): string {
  const device = getDeviceCapabilities();
  const thresholds = getOptimalThresholds();

  const deviceType = device.isMobile ? 'mobile' : 'desktop';
  const memory = device.memoryGB ? `${device.memoryGB}GB RAM` : 'unknown RAM';
  const connection = device.connectionType !== ConnectionType.UNKNOWN 
    ? device.connectionType 
    : 'unknown connection';

  return (
    `${device.tier}-tier ${deviceType} with ${device.cores} cores, ${memory}, ${connection}. ` +
    `Max ${device.maxWorkers} workers. ` +
    `Thresholds: ${(thresholds.multiWorkerThreshold / 1024 / 1024).toFixed(0)}MB multi-worker, ` +
    `${thresholds.largeFolderThreshold} files large-folder.`
  );
}

/**
 * Detects mobile/tablet devices using multiple heuristics.
 * 
 * Detection methods:
 * 1. User agent keyword matching
 * 2. Touch capability detection
 * 3. Screen size heuristics (<768px)
 * 
 * @returns {boolean} True if mobile/tablet
 * 
 * @internal
 * @performance O(1)
 * @sideeffects None, it is a pure function
 */
function detectMobileDevice(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
  const hasMobileUA = mobileKeywords.some(keyword => ua.includes(keyword));
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < MOBILE_SCREEN_WIDTH_THRESHOLD;

  return hasMobileUA || (hasTouch && isSmallScreen);
}

/**
 * Detects network connection type via NetworkInformation API.
 * 
 * @returns {ConnectionType} Connection type or UNKNOWN
 * 
 * @internal
 * @performance O(1)
 * @sideeffects None, it is a pure function
 */
function detectConnectionType(): ConnectionType {
  const nav = navigator as any;
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  const effectiveType = connection?.effectiveType;

  switch (effectiveType) {
    case 'slow-2g':
      return ConnectionType.SLOW_2G;
    case '2g':
      return ConnectionType.TWO_G;
    case '3g':
      return ConnectionType.THREE_G;
    case '4g':
      return ConnectionType.FOUR_G;
    default:
      return ConnectionType.UNKNOWN;
  }
}

/**
 * Calculates device performance tier from hardware specs.
 * 
 * Tier logic:
 * - Mobile: Always LOW or MEDIUM (never HIGH/ULTRA)
 * - Desktop: Based on RAM (primary) and cores (secondary)
 * 
 * @param {number} cores - CPU core count
 * @param {number | null} memoryGB - RAM in GB
 * @param {boolean} isMobile - Mobile device flag
 * @returns {DeviceTier} Performance tier
 * 
 * @internal
 * @performance O(1)
 * @sideeffects None, it is a pure function
 */
function calculateDeviceTier(
  cores: number,
  memoryGB: number | null,
  isMobile: boolean
): DeviceTier {
  // Mobile devices capped at MEDIUM tier
  if (isMobile) {
    return cores >= MOBILE_MEDIUM_TIER_MIN_CORES && 
           (memoryGB === null || memoryGB >= MEDIUM_TIER_MIN_MEMORY_GB)
      ? DeviceTier.MEDIUM
      : DeviceTier.LOW;
  }

  // Desktop tier calculation
  if (memoryGB !== null) {
    // Use memory as primary indicator when available
    if (memoryGB >= ULTRA_TIER_MIN_MEMORY_GB && cores >= ULTRA_TIER_MIN_CORES) {
      return DeviceTier.ULTRA;
    }
    if (memoryGB >= HIGH_TIER_MIN_MEMORY_GB && cores >= HIGH_TIER_MIN_CORES) {
      return DeviceTier.HIGH;
    }
    if (memoryGB >= MEDIUM_TIER_MIN_MEMORY_GB && cores >= LOW_TIER_THRESHOLD_CORES) {
      return DeviceTier.MEDIUM;
    }
    return DeviceTier.LOW;
  }

  // Fallback to cores-only classification
  if (cores >= ULTRA_TIER_MIN_CORES) return DeviceTier.ULTRA;
  if (cores >= CORES_ONLY_HIGH_TIER_THRESHOLD) return DeviceTier.HIGH;
  if (cores >= MEDIUM_TIER_MIN_CORES) return DeviceTier.MEDIUM;
  return DeviceTier.LOW;
}

/**
 * Calculates recommended maximum worker count.
 * 
 * Strategy:
 * - Always reserve 1 core for main thread
 * - Apply tier-specific caps
 * - Mobile limited to 2 workers for battery life
 * 
 * @param {number} cores - CPU core count
 * @param {DeviceTier} tier - Device tier
 * @param {boolean} isMobile - Mobile device flag
 * @returns {number} Recommended worker count
 * 
 * @internal
 * @performance O(1)
 * @sideeffects None, it is a pure function
 */
function calculateMaxWorkers(
  cores: number,
  tier: DeviceTier,
  isMobile: boolean
): number {
  if (isMobile) {
    return Math.min(MOBILE_MAX_WORKERS, Math.max(1, cores - 1));
  }

  switch (tier) {
    case DeviceTier.LOW:
      return Math.min(LOW_TIER_MAX_WORKERS, Math.max(1, cores - 1));
    case DeviceTier.MEDIUM:
      return Math.min(MEDIUM_TIER_MAX_WORKERS, Math.max(1, cores - 1));
    case DeviceTier.HIGH:
      return Math.min(HIGH_TIER_MAX_WORKERS, Math.max(1, cores - 1));
    case DeviceTier.ULTRA:
      return Math.max(HIGH_TIER_MAX_WORKERS, cores - 1);
    default:
      return Math.max(1, Math.min(HIGH_TIER_MAX_WORKERS, cores - 1));
  }
}