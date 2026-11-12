import type {
  DeleteCommand,
  DeleteCommandOutput,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  PutCommandOutput,
  QueryCommand,
  QueryCommandOutput,
  UpdateCommand,
  UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { expect, test } from 'bun:test';

import { DynamoDbAdapterImplementation } from '../src/features/dynamodb/adapters/DynamoDbAdapterImplementation.js';
import type { DynamoDbCommand, DynamoDbCommandTransport } from '../src/features/dynamodb/types.js';
import { createDynamoDbAdapter } from '../src/index.js';

class FailingTransport implements DynamoDbCommandTransport {
  public readonly commands: DynamoDbCommand[] = [];
  public send(command: GetCommand): Promise<GetCommandOutput>;
  public send(command: PutCommand): Promise<PutCommandOutput>;
  public send(command: UpdateCommand): Promise<UpdateCommandOutput>;
  public send(command: DeleteCommand): Promise<DeleteCommandOutput>;
  public send(command: QueryCommand): Promise<QueryCommandOutput>;
  public send(command: DynamoDbCommand): Promise<never> {
    this.commands.push(command);
    return Promise.reject(new Error('transport called'));
  }
}

test('rejects missing DynamoDB table mappings', () => {
  expect(() => createDynamoDbAdapter({ tables: {} })).toThrow('DynamoDB tables must not be empty.');
});

test('never falls back to Scan for an unconstrained generic query', async () => {
  const transport = new FailingTransport();
  const adapter = new DynamoDbAdapterImplementation(
    { people: { name: 'people-live', partitionKey: 'tenantId', sortKey: 'id' } },
    transport,
    false,
  );
  const result = await adapter.select({
    table: 'people',
    filters: [{ field: 'name', operator: 'eq', value: 'Ada' }],
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  expect(transport.commands).toEqual([]);
});

test('maps a bounded partition-key query to a DynamoDB Query command', async () => {
  const transport = new FailingTransport();
  const adapter = new DynamoDbAdapterImplementation(
    {
      people: {
        name: 'people-live',
        partitionKey: 'tenantId',
        sortKey: 'id',
        indexName: 'tenant-id',
      },
    },
    transport,
    false,
  );
  const result = await adapter.select({
    table: 'people',
    filters: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }],
    page: { limit: 25 },
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'DYNAMODB_ERROR' } });
  expect(transport.commands).toHaveLength(1);
  expect(transport.commands[0]?.input).toMatchObject({
    TableName: 'people-live',
    IndexName: 'tenant-id',
    KeyConditionExpression: '#pk = :pk',
    Limit: 25,
  });
});
