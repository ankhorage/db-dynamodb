import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoDbAdapterImplementation } from './adapters/DynamoDbAdapterImplementation.js';
import type { DynamoDbAdapter, DynamoDbAdapterConfig } from './types.js';

/*** Creates a DynamoDB adapter with either caller-owned or adapter-owned AWS client lifecycle. */
export const createDynamoDbAdapter = (config: DynamoDbAdapterConfig): DynamoDbAdapter => {
  validateConfig(config);
  if (config.client) return new DynamoDbAdapterImplementation(config.tables, config.client, false);
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config.clientConfig ?? {}));
  return new DynamoDbAdapterImplementation(config.tables, client, true);
};

/** Rejects ambiguous provider mapping before any AWS client work starts. */
const validateConfig = (config: DynamoDbAdapterConfig): void => {
  if (Object.keys(config.tables).length === 0)
    throw new Error('DynamoDB tables must not be empty.');
  for (const [table, mapping] of Object.entries(config.tables)) {
    if (!table.trim() || !mapping.name.trim() || !mapping.partitionKey.trim())
      throw new Error(
        'DynamoDB table mappings require logical name, table name, and partition key.',
      );
  }
};
