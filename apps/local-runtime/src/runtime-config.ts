export type RuntimeMode = 'development' | 'test' | 'production';
export type PublisherDriver = 'fake' | 'youtube';

export interface RuntimeConfig {
  mode: RuntimeMode;
  web: {
    host: string;
    port: number;
  };
  productBff: {
    host: string;
    port: number;
  };
  publisher: {
    driver: PublisherDriver;
  };
}

export interface RuntimeConfigEnv {
  NODE_ENV?: string;
  VIDEOOS_WEB_HOST?: string;
  VIDEOOS_WEB_PORT?: string;
  VIDEOOS_PRODUCT_BFF_HOST?: string;
  VIDEOOS_PRODUCT_BFF_PORT?: string;
  VIDEOOS_PUBLISHER_DRIVER?: string;
}

export function loadRuntimeConfig(env: RuntimeConfigEnv = process.env): RuntimeConfig {
  const mode = parseMode(env.NODE_ENV);
  return Object.freeze({
    mode,
    web: Object.freeze({
      host: boundedHost(env.VIDEOOS_WEB_HOST ?? '127.0.0.1'),
      port: boundedPort(env.VIDEOOS_WEB_PORT, 3000),
    }),
    productBff: Object.freeze({
      host: boundedHost(env.VIDEOOS_PRODUCT_BFF_HOST ?? '127.0.0.1'),
      port: boundedPort(env.VIDEOOS_PRODUCT_BFF_PORT, 3001),
    }),
    publisher: Object.freeze({
      driver: parsePublisherDriver(env.VIDEOOS_PUBLISHER_DRIVER ?? defaultPublisherDriver(mode)),
    }),
  });
}

function parseMode(value: string | undefined): RuntimeMode {
  if (!value || value === 'development') return 'development';
  if (value === 'test' || value === 'production') return value;
  throw new Error(`invalid NODE_ENV: ${value}`);
}

function defaultPublisherDriver(mode: RuntimeMode): PublisherDriver {
  return mode === 'production' ? 'youtube' : 'fake';
}

function parsePublisherDriver(value: string): PublisherDriver {
  if (value === 'fake' || value === 'youtube') return value;
  throw new Error(`invalid VIDEOOS_PUBLISHER_DRIVER: ${value}`);
}

function boundedPort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`invalid port: ${value}`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${value}`);
  return port;
}

function boundedHost(value: string): string {
  const host = value.trim();
  if (!host || host.length > 253 || /[\s/\\]/.test(host)) throw new Error(`invalid host: ${value}`);
  return host;
}
