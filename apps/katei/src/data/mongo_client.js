import { MongoClient } from 'mongodb';

let cachedClient = null;
let cachedDb = null;

export function getMongoClient(config, { createClient = createDefaultMongoClient } = {}) {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient({
    ...config,
    mongoUri: getRequiredMongoUri(config)
  });

  return cachedClient;
}

export function getMongoDb(config, { createClient = createDefaultMongoClient } = {}) {
  if (cachedDb) {
    return cachedDb;
  }

  const mongoDbName = getRequiredMongoDbName(config);
  const client = getMongoClient(config, { createClient });

  cachedDb = client.db(mongoDbName);
  return cachedDb;
}

export async function closeMongoClient() {
  if (!cachedClient) {
    return false;
  }

  const client = cachedClient;
  cachedClient = null;
  cachedDb = null;

  if (typeof client.close === 'function') {
    await client.close();
  }

  return true;
}

export async function resetMongoClient() {
  await closeMongoClient();
}

function createDefaultMongoClient(config) {
  return new MongoClient(config.mongoUri);
}

function getRequiredMongoUri(config) {
  const mongoUri = normalizeOptionalString(config?.mongoUri);

  if (!mongoUri) {
    throw new Error('MONGODB_URI is required for server-owned workspace persistence.');
  }

  return mongoUri;
}

function getRequiredMongoDbName(config) {
  const mongoDbName = normalizeOptionalString(config?.mongoDbName);

  if (!mongoDbName) {
    throw new Error('MONGODB_DB_NAME is required for server-owned workspace persistence.');
  }

  return mongoDbName;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
