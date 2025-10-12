/**
 * Structured logging system for Web Workers
 * 
 * Provides high-performance, configurable logging with pluggable outputs and formatters.
 * Designed for production environments requiring structured logs, lazy evaluation,
 * and runtime configuration changes without worker restarts.
 * 
 * Key Features:
 *   - Lazy evaluation of expensive metadata (avoids computation unless logged)
 *   - Pluggable output handlers (console, JSON, remote services)
 *   - Multiple formatters (text, JSON, custom)
 *   - Runtime reconfiguration (level, enabled, output, formatter)
 *   - Child logger creation for hierarchical contexts
 *   - Near zero overhead with early exit optimization
 * 
 * Use Cases:
 *   - Worker-based operations requiring structured logging
 *   - Production debugging with log level adjustment at runtime
 *   - Shipping logs to external services (DataDog, CloudWatch, etc.)
 *   - Performance-sensitive code requiring lazy evaluation
 * 
 * Example Usage:
 *   const logger = Loggers.console('UploadSession', LogLevel.INFO);
 *   logger.info('Session started', { uploadId: '123' });
 *   logger.debug('Performance data', () => expensiveCalculation()); // Lazy
 * 
 * Architecture:
 *   - LogLevel: Enum for filtering (DEBUG < INFO < WARN < ERROR < NONE)
 *   - Logger: Main facade with level-specific methods
 *   - LogOutput: Port interface for output destinations
 *   - LogFormatter: Port interface for formatting strategies
 *   - ConsoleOutput/JsonOutput: Adapter implementations
 *   - TextFormatter/JsonFormatter: Formatting implementations
 * 
 * Performance Characteristics:
 *   - Early exit: O(1) check before any processing
 *   - Lazy eval: Metadata functions only called if logged
 *   - Zero allocation: When disabled or below level
 * 
 * @see MetricsCollector for complementary observability system
 */

/**
 * Log level enumeration for filtering messages by severity.
 * 
 * Levels are ordered by severity: DEBUG < INFO < WARN < ERROR < NONE.
 * Set logger.level = LogLevel.WARN to only see WARN and ERROR messages.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

/**
 * Configuration options for Logger construction.
 * 
 * Allows customization of log level, output destination, formatting,
 * and runtime enable/disable without recreating logger instances.
 */
export interface LoggerOptions {
  /** Minimum log level to output (default: INFO) */
  level?: LogLevel;
  /** Custom log output handler (default: ConsoleOutput) */
  output?: LogOutput;
  /** Enable/disable logging entirely (default: true) */
  enabled?: boolean;
  /** Custom formatter for log messages (default: TextFormatter) */
  formatter?: LogFormatter;
}

/**
 * Structured log entry passed to output handlers.
 * 
 * Contains all context needed for formatting and routing logs
 * to external systems (CloudWatch, DataDog, etc.).
 */
export interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  meta?: unknown;
  timestamp: Date;
}

/**
 * Port interface for log output destinations.
 * 
 * Implement this to send logs to custom backends:
 *   - Remote logging services (Logtail, Papertrail)
 *   - Message queues (RabbitMQ, Kafka)
 *   - Parent window via postMessage
 *   - IndexedDB for offline storage
 */
export interface LogOutput {
  write(entry: LogEntry): void;
}

/**
 * Port interface for log message formatting.
 * 
 * Implement this to customize log output format:
 *   - JSON for machine parsing
 *   - Plain text for human readability
 *   - GELF for Graylog
 *   - Logfmt for key-value parsing
 */
export interface LogFormatter {
  format(entry: LogEntry): string;
}

/**
 * Lazy evaluation type for expensive metadata.
 * 
 * Pass a function instead of a value to defer computation:
 *   logger.debug('Metrics', () => calculateExpensiveStats());
 * 
 * The function only executes if log level permits output,
 * avoiding wasted CPU cycles for filtered-out logs.
 */
export type LogMeta = unknown | (() => unknown);

/**
 * Console output adapter for browser/worker environments.
 * 
 * Routes log entries to appropriate console methods (debug, info, warn, error)
 * with formatted messages and structured metadata.
 */
class ConsoleOutput implements LogOutput {
  constructor(private formatter: LogFormatter = new TextFormatter()) {}
  
  write(entry: LogEntry): void {
    const formattedMessage = this.formatter.format(entry);
    const { level, meta } = entry;
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage, meta ?? '');
        break;
      case LogLevel.INFO:
        console.info(formattedMessage, meta ?? '');
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, meta ?? '');
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage, meta ?? '');
        break;
    }
  }
}

/**
 * JSON output adapter for structured logging to external systems.
 * 
 * Formats log entries as JSON strings suitable for:
 *   - Log aggregation services (ELK, Splunk)
 *   - Message queues for async processing
 *   - Parent window communication via postMessage
 */
class JsonOutput implements LogOutput {
  constructor(private formatter: LogFormatter = new JsonFormatter()) {}
  
  write(entry: LogEntry): void {
    const jsonString = this.formatter.format(entry);
    // In workers, send JSON to parent or logging service via fetch/postMessage
    console.log(jsonString);
  }
}

/**
 * JSON formatter for machine-readable structured logs.
 * 
 * Produces JSON objects with ISO timestamps and enum-named levels,
 * suitable for parsing by log analysis tools.
 */
class JsonFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const seen = new WeakSet();
    
    const replacer = (key: string, value: any): any => {
      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    };
    
    return JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: LogLevel[entry.level],
      context: entry.context,
      message: entry.message,
      meta: entry.meta
    }, replacer);
  }
}

/**
 * Text formatter for human-readable console output.
 * 
 * Produces formatted strings with ISO timestamps and 
 * contextual information for debugging.
 */
class TextFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const levelName = LogLevel[entry.level];
    return `[${entry.timestamp.toISOString()}] [${levelName}] [${entry.context}] ${entry.message}`;
  }
}

/**
 * High-performance logger with configurable levels, outputs, and formatting.
 * 
 * The Logger class provides the main logging interface with:
 *   - Level-specific methods (debug, info, warn, error)
 *   - Lazy evaluation support for expensive metadata
 *   - Runtime reconfiguration of level, enabled, output, formatter
 *   - Child logger creation for hierarchical contexts
 *   - Near zero overhead with early exit optimization
 * 
 * Performance Optimizations:
 *   - Early exit check (if !enabled || level < _level) before any work
 *   - Lazy metadata evaluation (functions only called if logged)
 *   - No string concatenation unless message will be output
 * 
 * Example:
 *   const logger = new Logger('UploadSession:abc123', LogLevel.DEBUG);
 *   logger.info('Chunk uploaded', { chunkIndex: 42, size: 1024 });
 *   logger.debug('Expensive stats', () => calculateStats()); // Lazy
 *   logger.level = LogLevel.ERROR; // Runtime reconfiguration
 */
export class Logger {
  private _level: LogLevel;
  private _enabled: boolean;
  private _output: LogOutput;
  private _formatter: LogFormatter;

  constructor(
    private readonly context: string,
    options: LoggerOptions | LogLevel = LogLevel.INFO
  ) {
    // Handle both simple LogLevel and full options
    if (typeof options === 'number') {
      this._level = options;
      this._enabled = true;
      this._formatter = new TextFormatter();
      this._output = new ConsoleOutput(this._formatter);
    } else {
      this._level = options.level ?? LogLevel.INFO;
      this._enabled = options.enabled ?? true;
      this._formatter = options.formatter ?? new TextFormatter();
      this._output = options.output ?? new ConsoleOutput(this._formatter);
    }
  }

  /** Current log level */
  get level(): LogLevel {
    return this._level;
  }

  /** Set log level at runtime */
  set level(level: LogLevel) {
    this._level = level;
  }

  /** Enable/disable logging */
  set enabled(enabled: boolean) {
    this._enabled = enabled;
  }

  /** Update output handler */
  set output(output: LogOutput) {
    this._output = output;
  }

  /** Update formatter */
  set formatter(formatter: LogFormatter) {
    this._formatter = formatter;
  }

  /**
   * Core logging method with performance optimizations.
   * 
   * Implements early exit for disabled/filtered logs and lazy evaluation
   * of metadata to avoid wasted computation. All public methods delegate
   * to this implementation.
   * 
   * @param level The severity level of this log entry
   * @param message The log message (string interpolation should happen before calling)
   * @param meta Optional metadata (value or lazy function returning value)
   */
  private log(level: LogLevel, message: string, meta?: LogMeta): void {
    if (!this._enabled || level < this._level) {
      return;
    }

    // Lazy evaluation of meta data
    const evaluatedMeta = typeof meta === 'function' ? meta() : meta;

    const entry: LogEntry = {
      level,
      context: this.context,
      message,
      meta: evaluatedMeta,
      timestamp: new Date()
    };

    this._output.write(entry);
  }

  /**
   * Log debug-level messages (detailed diagnostic information)
   */
  debug(message: string, meta?: LogMeta): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * Log info-level messages (general informational messages)
   */
  info(message: string, meta?: LogMeta): void {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * Log warning-level messages (potentially harmful situations)
   */
  warn(message: string, meta?: LogMeta): void {
    this.log(LogLevel.WARN, message, meta);
  }

  /**
   * Log error-level messages (error events)
   */
  error(message: string, meta?: LogMeta): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * Create a child logger with hierarchical context.
   * 
   * Child loggers inherit parent configuration (level, output, formatter)
   * but have their own context prepended with parent context.
   * 
   * Useful for:
   *   - Per-session loggers within a worker
   *   - Per-component loggers within a session
   *   - Hierarchical context tracking
   * 
   * Example:
   *   const parent = new Logger('Worker', LogLevel.INFO);
   *   const child = parent.createChild('Session:123'); // Context: "Worker:Session:123"
   * 
   * @param context Child context name (prepended to parent context)
   * @returns New Logger instance with parent:child context
   */
  createChild(context: string): Logger {
    return new Logger(`${this.context}:${context}`, {
      level: this._level,
      enabled: this._enabled,
      output: this._output,
      formatter: this._formatter
    });
  }
}

/**
 * Pre-configured logger factory functions for common use cases.
 * 
 * Provides convenient shortcuts for creating loggers without
 * manual configuration of outputs and formatters.
 */
export const Loggers = {
  /**
   * Create a console logger with human-readable text formatting.
   * 
   * Use for: Development, debugging, browser console output
   * 
   * @param context Logger context (e.g., 'UploadSession', 'Worker')
   * @param level Minimum log level (default: INFO)
   */
  console: (context: string, level: LogLevel = LogLevel.INFO) => 
    new Logger(context, { level, output: new ConsoleOutput(new TextFormatter()) }),
  
  /**
   * Create a JSON logger for structured logging to external systems.
   * 
   * Use for: Production logging, log aggregation, machine parsing
   * 
   * @param context Logger context
   * @param level Minimum log level (default: INFO)
   */
  json: (context: string, level: LogLevel = LogLevel.INFO) => 
    new Logger(context, { level, output: new JsonOutput(new JsonFormatter()) }),
  
  /**
   * Create a logger with fully custom configuration.
   * 
   * Use for: Custom output handlers, formatters, or complex setups
   * 
   * @param context Logger context
   * @param options Full LoggerOptions configuration
   */
  custom: (context: string, options: LoggerOptions) => 
    new Logger(context, options)
};

/**
 * Default application-wide logger instance.
 * 
 * Convenience export for quick logging without creating instances.
 * Consider creating context-specific loggers for better traceability.
 */
export const defaultLogger = Loggers.console('App');

/**
 * Utility function for quick logger creation.
 * 
 * Convenience wrapper around Logger constructor for simple use cases.
 * 
 * @param context Logger context
 * @param level Optional log level (default: INFO)
 */
export const createLogger = (context: string, level?: LogLevel) => 
  new Logger(context, level);

export { JsonFormatter, TextFormatter, ConsoleOutput, JsonOutput };