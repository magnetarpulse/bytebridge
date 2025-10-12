/**
 * @file features.ts
 * @description Feature flag configuration for the application.
 * Provides centralized control over feature availability across the application.
 * Features can be toggled without code changes to routes or components.
 */

/**
 * Available feature flags in the application.
 * Each property represents a feature that can be enabled or disabled.
 */
export interface Features {
  /** Admin panel and functionality */
  admin: boolean;
  /** File upload functionality */
  upload: boolean;
  /** Team management features */
  teams: boolean;
  /** Analytics and reporting features */
  analytics: boolean;
  /** Notification system */
  notifications: boolean;
}

/**
 * Current feature flag configuration.
 * Set to `true` to enable a feature, `false` to disable it.
 * These values control route visibility and UI component rendering.
 */
export const features: Features = {
  admin: true,
  upload: true,
  teams: true,
  analytics: false,
  notifications: true,
};

/**
 * Checks if a specific feature is enabled.
 * Returns false for undefined features to fail safely.
 * 
 * @param feature - The feature key to check
 * @returns True if the feature is enabled, false otherwise
 * 
 * @example
 * ```tsx
 * if (isFeatureEnabled('admin')) {
 *   // Show admin route
 * }
 * ```
 */
export const isFeatureEnabled = (feature: keyof Features): boolean => {
  return features[feature] ?? false;
};