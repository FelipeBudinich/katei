import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeMongoClient,
  getMongoClient,
  getMongoDb,
  resetMongoClient
} from '../src/data/mongo_client.js';

const TEST_CONFIG = Object.freeze({
  mongoUri: 'mongodb://127.0.0.1:27017',
  mongoDbName: 'katei_test'
});

test('getMongoClient and getMongoDb cache the Mongo runtime handles for reuse', async () => {
  await resetMongoClient();

  let createClientCalls = 0;
  let dbCalls = 0;
  const client = {
    db(name) {
      dbCalls += 1;
      return { name, kind: 'db-handle' };
    },
    async close() {}
  };

  const createClient = (config) => {
    createClientCalls += 1;
    assert.equal(config.mongoUri, TEST_CONFIG.mongoUri);
    return client;
  };

  const firstClient = getMongoClient(TEST_CONFIG, { createClient });
  const secondClient = getMongoClient(TEST_CONFIG, { createClient });
  const firstDb = getMongoDb(TEST_CONFIG, { createClient });
  const secondDb = getMongoDb(TEST_CONFIG, { createClient });

  assert.equal(firstClient, client);
  assert.equal(secondClient, client);
  assert.deepEqual(firstDb, { name: TEST_CONFIG.mongoDbName, kind: 'db-handle' });
  assert.equal(secondDb, firstDb);
  assert.equal(createClientCalls, 1);
  assert.equal(dbCalls, 1);

  await resetMongoClient();
});

test('resetMongoClient closes the cached client and clears cached handles', async () => {
  await resetMongoClient();

  let createClientCalls = 0;
  let closeCalls = 0;

  const createClient = () => {
    const clientId = ++createClientCalls;

    return {
      db(name) {
        return { clientId, name };
      },
      async close() {
        closeCalls += 1;
      }
    };
  };

  const firstDb = getMongoDb(TEST_CONFIG, { createClient });

  assert.deepEqual(firstDb, { clientId: 1, name: TEST_CONFIG.mongoDbName });

  await resetMongoClient();

  const secondDb = getMongoDb(TEST_CONFIG, { createClient });

  assert.deepEqual(secondDb, { clientId: 2, name: TEST_CONFIG.mongoDbName });
  assert.equal(closeCalls, 1);

  await resetMongoClient();
});

test('closeMongoClient is safe when the runtime has not been initialized', async () => {
  await resetMongoClient();

  assert.equal(await closeMongoClient(), false);
});

test('Mongo runtime helpers fail clearly when MongoDB config is missing', async () => {
  await resetMongoClient();

  assert.throws(() => getMongoClient({ mongoDbName: TEST_CONFIG.mongoDbName }), {
    message: 'MONGODB_URI is required for server-owned workspace persistence.'
  });
  assert.throws(() => getMongoDb({ mongoUri: TEST_CONFIG.mongoUri }), {
    message: 'MONGODB_DB_NAME is required for server-owned workspace persistence.'
  });
});
