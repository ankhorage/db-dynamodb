import type {
  DbAdapterError,
  DbDeleteInput,
  DbFindByIdInput,
  DbInsertInput,
  DbResult,
  DbSelectInput,
  DbUpdateInput,
} from '@ankhorage/contracts/db';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { DynamoDbAdapter, DynamoDbCommandTransport, DynamoDbTable } from '../types.js';

/** Implements safely representable `@ankhorage/contracts/db` operations with DynamoDB commands. */
export class DynamoDbAdapterImplementation implements DynamoDbAdapter {
  public readonly capabilities = { transactions: false, returning: false, realtime: false };

  public constructor(
    private readonly tables: Readonly<Record<string, DynamoDbTable>>,
    private readonly client: DynamoDbCommandTransport & { readonly destroy?: () => void },
    public readonly ownsClient: boolean,
  ) {}

  /** Closes only the AWS client lifecycle this adapter created. */
  public close(): Promise<void> {
    if (this.ownsClient) this.client.destroy?.();
    return Promise.resolve();
  }

  /** Queries a configured DynamoDB key without falling back to Scan. */
  public async select<TRecord extends object>(input: DbSelectInput): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      const key = toQueryKey(input, table);
      const output = await this.client.send(
        new QueryCommand({
          TableName: table.name,
          IndexName: table.indexName,
          KeyConditionExpression: key.expression,
          ExpressionAttributeNames: key.names,
          ExpressionAttributeValues: key.values,
          ScanIndexForward: input.sort?.[0]?.direction !== 'desc',
          Limit: input.page?.limit,
        }),
      );
      return success((output.Items ?? []) as TRecord[]);
    } catch (cause) {
      return failure(cause);
    }
  }

  /** Retrieves a record by the configured table key. */
  public async findById<TRecord extends object>(
    input: DbFindByIdInput,
  ): Promise<DbResult<TRecord | null>> {
    try {
      const table = this.table(input.table, input.schema);
      if (input.idField !== undefined && input.idField !== table.partitionKey)
        throw unsupported('findById idField does not match the configured partition key');
      const output = await this.client.send(
        new GetCommand({ TableName: table.name, Key: { [table.partitionKey]: input.id } }),
      );
      return success((output.Item as TRecord | undefined) ?? null);
    } catch (cause) {
      return failure(cause);
    }
  }

  /** Inserts one complete DynamoDB item without inferring a schema. */
  public async insert<TRecord extends object>(
    input: DbInsertInput<TRecord>,
  ): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      if (input.values instanceof Array) throw unsupported('multi-item insert');
      await this.client.send(new PutCommand({ TableName: table.name, Item: input.values }));
      return success([input.values]);
    } catch (cause) {
      return failure(cause);
    }
  }

  /** Updates exactly one item selected by the configured primary key. */
  public async update<TRecord extends object>(
    input: DbUpdateInput<TRecord>,
  ): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      const key = toExactKey(input.filters, table, 'update');
      const values = Object.entries(input.values);
      if (values.length === 0) throw unsupported('empty update');
      const names = Object.fromEntries(values.map(([field], index) => [`#u${index}`, field]));
      const attributes = Object.fromEntries(
        values.map(([, value], index) => [`:u${index}`, value]),
      );
      const output = await this.client.send(
        new UpdateCommand({
          TableName: table.name,
          Key: key,
          UpdateExpression: `SET ${values.map((_, index) => `#u${index} = :u${index}`).join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: attributes,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return success(output.Attributes ? [output.Attributes as TRecord] : []);
    } catch (cause) {
      return failure(cause);
    }
  }

  /** Deletes exactly one item selected by the configured primary key. */
  public async delete<TRecord extends object>(input: DbDeleteInput): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      const key = toExactKey(input.filters, table, 'delete');
      const output = await this.client.send(
        new DeleteCommand({ TableName: table.name, Key: key, ReturnValues: 'ALL_OLD' }),
      );
      return success(output.Attributes ? [output.Attributes as TRecord] : []);
    } catch (cause) {
      return failure(cause);
    }
  }

  /** Resolves a portable table only through an explicit application mapping. */
  private table(name: string, schema: string | undefined): DynamoDbTable {
    if (schema !== undefined) throw unsupported('schema-qualified table');
    const table = Object.entries(this.tables).find(([candidate]) => candidate === name)?.[1];
    if (!table) throw unsupported(`unconfigured table ${name}`);
    return table;
  }
}

/** Builds a key condition that DynamoDB can execute as a bounded Query. */
const toQueryKey = (input: DbSelectInput, table: DynamoDbTable) => {
  validateQueryInput(input, table);
  const filters = input.filters ?? [];
  const partition = filters.find((filter) => filter.field === table.partitionKey);
  if (partition?.operator !== 'eq') throw unsupported('query without partition-key equality');
  return buildKeyCondition(
    partition.value,
    filters.filter((filter) => filter !== partition),
    table,
  );
};

/** Rejects generic query options whose DynamoDB meaning differs from the contract. */
const validateQueryInput = (input: DbSelectInput, table: DynamoDbTable): void => {
  if (input.page?.offset !== undefined) throw unsupported('offset pagination');
  if (input.columns !== undefined) throw unsupported('column projection');
  if (input.sort && (input.sort.length !== 1 || input.sort[0]?.field !== table.sortKey))
    throw unsupported('sort outside the configured sort key');
};

/** Builds DynamoDB expression attributes from an already validated key filter set. */
const buildKeyCondition = (
  partitionValue: unknown,
  rest: readonly { readonly field: string; readonly operator: string; readonly value: unknown }[],
  table: DynamoDbTable,
) => {
  const sort = rest.at(0);
  if (!hasValidSortFilter(rest, table))
    throw unsupported('query filters outside the configured key');
  if (!sort)
    return {
      expression: '#pk = :pk',
      names: { '#pk': table.partitionKey },
      values: { ':pk': partitionValue },
    };
  return {
    expression: `#pk = :pk AND #sk ${toDynamoOperator(sort.operator)} :sk`,
    names: { '#pk': table.partitionKey, '#sk': table.sortKey ?? '' },
    values: { ':pk': partitionValue, ':sk': sort.value },
  };
};

/** Ensures an optional sort-key filter remains a DynamoDB key condition. */
const hasValidSortFilter = (
  filters: readonly { readonly field: string; readonly operator: string }[],
  table: DynamoDbTable,
): boolean => {
  const sort = filters.at(0);
  return (
    filters.length < 2 &&
    (sort === undefined || (sort.field === table.sortKey && isRangeOperator(sort.operator)))
  );
};

/** Extracts a complete configured primary key from equality filters. */
const toExactKey = (
  filters: readonly {
    readonly field: string;
    readonly operator: string;
    readonly value: unknown;
  }[],
  table: DynamoDbTable,
  operation: string,
): Record<string, unknown> => {
  const fields = [table.partitionKey, ...(table.sortKey ? [table.sortKey] : [])];
  if (filters.length !== fields.length || filters.some((filter) => filter.operator !== 'eq'))
    throw unsupported(`${operation} without exact primary-key equality`);
  const key = Object.fromEntries(filters.map((filter) => [filter.field, filter.value]));
  if (
    Object.keys(key).some((field) => !fields.includes(field)) ||
    fields.some((field) => !(field in key))
  )
    throw unsupported(`${operation} without exact configured key`);
  return key;
};

/** Identifies DynamoDB key-condition operators representable by the portable contract. */
const isRangeOperator = (operator: string): boolean =>
  ['eq', 'gt', 'gte', 'lt', 'lte'].includes(operator);

/** Maps portable filter operators to DynamoDB key-condition syntax. */
const toDynamoOperator = (operator: string): string => {
  switch (operator) {
    case 'eq':
      return '=';
    case 'gt':
      return '>';
    case 'gte':
      return '>=';
    case 'lt':
      return '<';
    case 'lte':
      return '<=';
    default:
      throw unsupported('filter operator');
  }
};

/** Returns a successful portable database result. */
const success = <TData>(data: TData): { readonly ok: true; readonly data: TData } => ({
  ok: true,
  data,
});

/** Converts provider and validation failures into deterministic portable errors. */
const failure = (cause: unknown): { readonly ok: false; readonly error: DbAdapterError } => ({
  ok: false,
  error: toError(cause),
});

/** Normalizes DynamoDB errors without losing the original cause. */
const toError = (cause: unknown): DbAdapterError => ({
  code: cause instanceof DynamoDbUnsupportedError ? 'DYNAMODB_UNSUPPORTED' : 'DYNAMODB_ERROR',
  message: cause instanceof Error ? cause.message : 'Unknown DynamoDB error.',
  cause,
});

/** Represents a requested portable operation DynamoDB cannot preserve safely. */
class DynamoDbUnsupportedError extends Error {}

/** Creates an explicit unsupported-operation error. */
const unsupported = (operation: string): DynamoDbUnsupportedError =>
  new DynamoDbUnsupportedError(`DynamoDB does not safely support ${operation}.`);
