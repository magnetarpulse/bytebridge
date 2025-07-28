/**
 * @file Contains shared TypeScript types used across different modules of the application.
 */

/**
 * Defines the specific, valid compression levels for the `fflate` library.
 * This type is used by the UI slider in the React component and by the
 * processing worker to ensure end-to-end type safety.
 */
export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;