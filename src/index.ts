/** Public DynamoDB adapter API for `@ankhorage/contracts/db`. */
export { createDynamoDbAdapter } from './features/dynamodb/createDynamoDbAdapter.js';
export type {
  DynamoDbAdapter,
  DynamoDbAdapterConfig,
  DynamoDbAdapterLifecycle,
  DynamoDbCommandTransport,
  DynamoDbIndex,
  DynamoDbTable,
} from './features/dynamodb/types.js';
