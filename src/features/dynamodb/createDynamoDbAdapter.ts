import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoDbAdapterImplementation } from './adapters/DynamoDbAdapterImplementation.js';
import type { DynamoDbAdapter, DynamoDbAdapterConfig, DynamoDbIndex } from './types.js';

/*** Creates a DynamoDB adapter with either caller-owned or adapter-owned AWS client lifecycle. */
export const createDynamoDbAdapter = (config: DynamoDbAdapterConfig): DynamoDbAdapter => {
  validateConfig(config);
  if (config.client) return new DynamoDbAdapterImplementation(config.tables, config.client, false);
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config.clientConfig ?? {}));
  return new DynamoDbAdapterImplementation(config.tables, client, true);
};

/*** Validates configuration that must be unambiguous before any provider call. */
const validateConfig = (config: DynamoDbAdapterConfig): void => {
  if (Object.keys(config.tables).length === 0)
    throw new Error('DynamoDB tables must not be empty.');
  for (const [logicalName, table] of Object.entries(config.tables)) {
    if (!logicalName.trim() || !table.name.trim() || !table.partitionKey.trim())
      throw new Error(
        'DynamoDB table mappings require logical name, table name, and partition key.',
      );
    if (table.sortKey === '') throw new Error('DynamoDB sort keys must not be empty.');
    validateIndex(table.index);
  }
};

/*** Validates optional query-index mappings independently from physical table keys. */
const validateIndex = (index: DynamoDbIndex | undefined): void => {
  if (
    index !== undefined &&
    (!index.name.trim() || !index.partitionKey.trim() || index.sortKey === '')
  )
    throw new Error(
      'DynamoDB index mappings require name and partition key, with no empty sort key.',
    );
};
