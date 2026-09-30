/* Minimal timestamped logger (swap for pino/winston if needed). */
const ts = () => new Date().toISOString();

const logger = {
  info: (...args) => console.log(ts(), 'INFO ', ...args),
  warn: (...args) => console.warn(ts(), 'WARN ', ...args),
  error: (...args) => console.error(ts(), 'ERROR', ...args),
  debug: (...args) => {
    if (typeof process !== 'undefined' && process.env?.DEBUG) console.log(ts(), 'DEBUG', ...args);
  },
};

export default logger;
