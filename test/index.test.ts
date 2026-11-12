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
import {
  DeleteCommand as Delete,
  GetCommand as Get,
  PutCommand as Put,
  QueryCommand as Query,
  UpdateCommand as Update,
} from '@aws-sdk/lib-dynamodb';
import { expect, test } from 'bun:test';

import { createDynamoDbAdapter, type DynamoDbCommandTransport } from '../src/index.js';

type DynamoDbCommand = GetCommand | PutCommand | UpdateCommand | DeleteCommand | QueryCommand;
type CommandResponse = unknown;

class RecordingTransport implements DynamoDbCommandTransport {
  public readonly commands: DynamoDbCommand[] = [];
  public destroyed = false;

  public constructor(private readonly responses: readonly CommandResponse[]) {}

  public send(command: GetCommand): Promise<GetCommandOutput>;
  public send(command: PutCommand): Promise<PutCommandOutput>;
  public send(command: UpdateCommand): Promise<UpdateCommandOutput>;
  public send(command: DeleteCommand): Promise<DeleteCommandOutput>;
  public send(command: QueryCommand): Promise<QueryCommandOutput>;
  public send(command: DynamoDbCommand): Promise<CommandResponse> {
    this.commands.push(command);
    const response = this.responses[this.commands.length - 1] ?? {};
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  }

  public destroy(): void {
    this.destroyed = true;
  }
}

/** Creates an adapter that records injected AWS commands without live provider calls. */
const createAdapter = (transport: RecordingTransport) =>
  createDynamoDbAdapter({
    tables: {
      people: { name: 'people-live', partitionKey: 'tenantId', sortKey: 'id' },
      accounts: { name: 'accounts-live', partitionKey: 'accountId' },
      searchablePeople: {
        name: 'people-live',
        partitionKey: 'tenantId',
        sortKey: 'id',
        index: { name: 'email-index', partitionKey: 'email', sortKey: 'createdAt' },
      },
    },
    client: transport,
  });

/** Creates a provider-shaped error whose unsafe message must never reach consumers. */
const awsError = (name: string): Error =>
  Object.assign(new Error('secret token and request metadata'), { name });

test('rejects invalid and ambiguous table mappings before creating an AWS client', () => {
  expect(() => createDynamoDbAdapter({ tables: {} })).toThrow('DynamoDB tables must not be empty.');
  expect(() =>
    createDynamoDbAdapter({
      tables: {
        people: {
          name: 'live',
          partitionKey: 'tenantId',
          index: { name: '', partitionKey: 'email' },
        },
      },
    }),
  ).toThrow('DynamoDB index mappings require name and partition key');
});

test('gets a simple physical key and rejects projections', async () => {
  const transport = new RecordingTransport([{ Item: { accountId: 'account-1', name: 'Ada' } }]);
  const adapter = createAdapter(transport);
  expect(await adapter.findById({ table: 'accounts', id: 'account-1' })).toEqual({
    ok: true,
    data: { accountId: 'account-1', name: 'Ada' },
  });
  expect(transport.commands[0]).toBeInstanceOf(Get);
  expect(transport.commands[0]?.input).toEqual({
    TableName: 'accounts-live',
    Key: { accountId: 'account-1' },
  });
  expect(
    await adapter.findById({ table: 'accounts', id: 'account-1', columns: ['name'] }),
  ).toMatchObject({
    ok: false,
    error: { code: 'DYNAMODB_UNSUPPORTED' },
  });
});

test('rejects findById for a composite physical key that the portable input cannot represent', async () => {
  const transport = new RecordingTransport([]);
  const result = await createAdapter(transport).findById({ table: 'people', id: 'person-1' });
  expect(result).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  expect(transport.commands).toEqual([]);
});

test('conditionally inserts complete physical keys and rejects duplicates safely', async () => {
  const transport = new RecordingTransport([{}, awsError('ConditionalCheckFailedException')]);
  const adapter = createAdapter(transport);
  expect(
    await adapter.insert({
      table: 'people',
      values: { tenantId: 'tenant-1', id: 'person-1', name: 'Ada' },
    }),
  ).toEqual({
    ok: true,
    data: [{ tenantId: 'tenant-1', id: 'person-1', name: 'Ada' }],
  });
  expect(
    await adapter.insert({ table: 'people', values: { tenantId: 'tenant-1', id: 'person-1' } }),
  ).toEqual({
    ok: false,
    error: {
      code: 'DYNAMODB_CONFLICT',
      message: 'The requested record state conflicts with persisted data.',
    },
  });
  expect(transport.commands[0]).toBeInstanceOf(Put);
  expect(transport.commands[0]?.input).toMatchObject({
    ConditionExpression: 'attribute_not_exists(#key0) AND attribute_not_exists(#key1)',
    ExpressionAttributeNames: { '#key0': 'tenantId', '#key1': 'id' },
  });
});

test('rejects inserts without every configured physical key before transport', async () => {
  const transport = new RecordingTransport([]);
  const result = await createAdapter(transport).insert({
    table: 'people',
    values: { tenantId: 'tenant-1' },
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  expect(transport.commands).toEqual([]);
});

test('updates an existing composite key and returns the persisted record', async () => {
  const transport = new RecordingTransport([
    { Attributes: { tenantId: 'tenant-1', id: 'person-1', name: 'Grace' } },
  ]);
  const result = await createAdapter(transport).update<Record<string, unknown>>({
    table: 'people',
    filters: [
      { field: 'tenantId', operator: 'eq', value: 'tenant-1' },
      { field: 'id', operator: 'eq', value: 'person-1' },
    ],
    values: { name: 'Grace' },
  });
  expect(result).toEqual({
    ok: true,
    data: [{ tenantId: 'tenant-1', id: 'person-1', name: 'Grace' }],
  });
  expect(transport.commands[0]).toBeInstanceOf(Update);
  expect(transport.commands[0]?.input).toMatchObject({
    Key: { tenantId: 'tenant-1', id: 'person-1' },
    ConditionExpression: 'attribute_exists(#key0) AND attribute_exists(#key1)',
    ReturnValues: 'ALL_NEW',
  });
});

test('rejects missing updates and physical key changes deterministically', async () => {
  const transport = new RecordingTransport([awsError('ConditionalCheckFailedException')]);
  const adapter = createAdapter(transport);
  const missing = await adapter.update({
    table: 'people',
    filters: [
      { field: 'tenantId', operator: 'eq', value: 'tenant-1' },
      { field: 'id', operator: 'eq', value: 'missing' },
    ],
    values: { name: 'Grace' },
  });
  expect(missing).toEqual({
    ok: false,
    error: { code: 'DYNAMODB_NOT_FOUND', message: 'The requested record does not exist.' },
  });
  const keyChange = await adapter.update({
    table: 'people',
    filters: [
      { field: 'tenantId', operator: 'eq', value: 'tenant-1' },
      { field: 'id', operator: 'eq', value: 'person-1' },
    ],
    values: { id: 'person-2' },
  });
  expect(keyChange).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  expect(transport.commands).toHaveLength(1);
});

test('deletes an existing composite key and maps a missing key to not found', async () => {
  const transport = new RecordingTransport([
    { Attributes: { tenantId: 'tenant-1', id: 'person-1' } },
    awsError('ConditionalCheckFailedException'),
  ]);
  const adapter = createAdapter(transport);
  const input = {
    table: 'people',
    filters: [
      { field: 'tenantId', operator: 'eq' as const, value: 'tenant-1' },
      { field: 'id', operator: 'eq' as const, value: 'person-1' },
    ],
  };
  expect(await adapter.delete(input)).toEqual({
    ok: true,
    data: [{ tenantId: 'tenant-1', id: 'person-1' }],
  });
  expect(await adapter.delete(input)).toEqual({
    ok: false,
    error: { code: 'DYNAMODB_NOT_FOUND', message: 'The requested record does not exist.' },
  });
  expect(transport.commands[0]).toBeInstanceOf(Delete);
  expect(transport.commands[0]?.input).toMatchObject({
    ConditionExpression: 'attribute_exists(#key0) AND attribute_exists(#key1)',
    ReturnValues: 'ALL_OLD',
  });
});

test('uses configured index keys only for bounded index queries', async () => {
  const transport = new RecordingTransport([
    { Items: [{ tenantId: 'tenant-1', id: 'person-1', email: 'ada@example.com' }] },
  ]);
  const result = await createAdapter(transport).select({
    table: 'searchablePeople',
    filters: [{ field: 'email', operator: 'eq', value: 'ada@example.com' }],
    page: { limit: 10 },
  });
  expect(result).toEqual({
    ok: true,
    data: [{ tenantId: 'tenant-1', id: 'person-1', email: 'ada@example.com' }],
  });
  expect(transport.commands[0]).toBeInstanceOf(Query);
  expect(transport.commands[0]?.input).toMatchObject({
    TableName: 'people-live',
    IndexName: 'email-index',
    KeyConditionExpression: '#partition = :partition',
    ExpressionAttributeNames: { '#partition': 'email' },
  });
});

test('rejects unbounded, partial, and scan-like query requests', async () => {
  const transport = new RecordingTransport([
    { Items: [{ id: 'person-1' }], LastEvaluatedKey: { tenantId: 'tenant-1', id: 'person-1' } },
  ]);
  const adapter = createAdapter(transport);
  const unbounded = await adapter.select({
    table: 'people',
    filters: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }],
  });
  expect(unbounded).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  const partial = await adapter.select({
    table: 'people',
    filters: [{ field: 'tenantId', operator: 'eq', value: 'tenant-1' }],
    page: { limit: 10 },
  });
  expect(partial).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  const scanLike = await adapter.select({
    table: 'people',
    filters: [{ field: 'name', operator: 'eq', value: 'Ada' }],
    page: { limit: 10 },
  });
  expect(scanLike).toMatchObject({ ok: false, error: { code: 'DYNAMODB_UNSUPPORTED' } });
  expect(transport.commands).toHaveLength(1);
});

test('normalizes validation, throttling, and transport errors without provider messages', async () => {
  const transport = new RecordingTransport([
    awsError('ValidationException'),
    awsError('ThrottlingException'),
    awsError('NetworkError'),
  ]);
  const adapter = createAdapter(transport);
  const input = { table: 'accounts', id: 'account-1' };
  expect(await adapter.findById(input)).toEqual({
    ok: false,
    error: { code: 'DYNAMODB_INVALID_REQUEST', message: 'DynamoDB rejected the request.' },
  });
  expect(await adapter.findById(input)).toEqual({
    ok: false,
    error: { code: 'DYNAMODB_UNAVAILABLE', message: 'DynamoDB is temporarily unavailable.' },
  });
  expect(await adapter.findById(input)).toEqual({
    ok: false,
    error: { code: 'DYNAMODB_ERROR', message: 'DynamoDB request failed.' },
  });
});

test('never destroys an injected client', async () => {
  const transport = new RecordingTransport([]);
  const adapter = createAdapter(transport);
  await adapter.close();
  expect(adapter.ownsClient).toBeFalse();
  expect(transport.destroyed).toBeFalse();
});
