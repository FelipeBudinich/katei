import { createServer } from 'node:http';
import { createApp } from './app.js';
import { APP_TITLE } from '../public/js/domain/workspace_read_model.js';

const DEFAULT_PORT = 3000;
const SERVER_KEEP_ALIVE_TIMEOUT_MS = 95_000;
const SERVER_HEADERS_TIMEOUT_MS = 100_000;
const SHUTDOWN_GRACE_PERIOD_MS = 25_000;

function resolvePort(rawPort) {
  const requireExplicitPort =
    process.env.NODE_ENV === 'production' || process.env.DYNO != null;

  if (rawPort == null || rawPort === '') {
    if (requireExplicitPort) {
      throw new Error('PORT must be set');
    }

    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  const port = Number(rawPort);

  if (port < 1 || port > 65_535) {
    throw new Error(`PORT out of range: ${rawPort}`);
  }

  return port;
}

function installShutdownHandlers(server) {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.info(`${signal} received, shutting down HTTP server`);

    server.close((error) => {
      if (error) {
        console.error('HTTP server shutdown failed', error);
        process.exitCode = 1;
        return;
      }

      console.info('HTTP server closed');
    });

    server.closeIdleConnections?.();

    setTimeout(() => {
      console.error('Forced shutdown after grace period');
      process.exit(1);
    }, SHUTDOWN_GRACE_PERIOD_MS).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

const port = resolvePort(process.env.PORT);
const app = createApp();

const server = createServer(
  {
    // Keep dyno-side connection timers above Heroku's router idle timeout.
    keepAliveTimeout: SERVER_KEEP_ALIVE_TIMEOUT_MS,
    headersTimeout: SERVER_HEADERS_TIMEOUT_MS,
  },
  app,
);

server.on('error', (error) => {
  console.error('HTTP server failed to start', error);
  process.exit(1);
});

installShutdownHandlers(server);

server.listen(port, () => {
  console.info(`${APP_TITLE} listening on port ${port}`);
});