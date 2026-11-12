import type {
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
import {
  createDynamoDbKeyCondition,
  toExactDynamoDbKey,
  validateDynamoDbItemKey,
} from '../utils/dynamoDbKeys.js';
import { failure, provider, success, unsupported } from '../utils/dynamoDbResult.js';
import { toDynamoDbQuery } from '../utils/toDynamoDbQuery.js';

/*** Implements the portable database contract at the DynamoDB provider boundary. */
export class DynamoDbAdapterImplementation implements DynamoDbAdapter {
  public readonly capabilities = { transactions: false, returning: true, realtime: false };

  public constructor(
    private readonly tables: Readonly<Record<string, DynamoDbTable>>,
    private readonly client: DynamoDbCommandTransport,
    public readonly ownsClient: boolean,
  ) {}

  /*** Closes only an AWS client that this adapter created. */
  public close(): Promise<void> {
    if (this.ownsClient) this.client.destroy?.();
    return Promise.resolve();
  }

  /*** Queries one bounded physical table key or explicitly configured secondary-index key. */
  public async select<TRecord extends object>(input: DbSelectInput): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      const output = await this.client.send(
        new QueryCommand({
          TableName: table.name,
          ...toDynamoDbQuery(input, table),
          Limit: input.page?.limit,
          ScanIndexForward: input.sort?.[0]?.direction !== 'desc',
        }),
      );
      if (output.LastEvaluatedKey !== undefined)
        throw unsupported('a query result that requires a continuation cursor');
      return success((output.Items ?? []) as TRecord[]);
    } catch (cause) {
      return failure(cause);
    }
  }

  /*** Retrieves one record only when the portable identifier fully represents the physical key. */
  public async findById<TRecord extends object>(
    input: DbFindByIdInput,
  ): Promise<DbResult<TRecord | null>> {
    try {
      const table = this.table(input.table, input.schema);
      if (input.columns !== undefined) throw unsupported('column projection');
      if (table.sortKey !== undefined) throw unsupported('findById on a composite physical key');
      if (input.idField !== undefined && input.idField !== table.partitionKey)
        throw unsupported('findById idField that differs from the physical partition key');
      const output = await this.client.send(
        new GetCommand({ TableName: table.name, Key: { [table.partitionKey]: input.id } }),
      );
      return success((output.Item as TRecord | undefined) ?? null);
    } catch (cause) {
      return failure(cause);
    }
  }

  /*** Inserts one complete item only when its physical key is absent. */
  public async insert<TRecord extends object>(
    input: DbInsertInput<TRecord>,
  ): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      if (input.values instanceof Array) throw unsupported('multi-item insert');
      validateDynamoDbItemKey(input.values, table);
      const condition = createDynamoDbKeyCondition(table, 'attribute_not_exists');
      await this.client.send(
        new PutCommand({
          TableName: table.name,
          Item: input.values,
          ConditionExpression: condition.expression,
          ExpressionAttributeNames: condition.names,
        }),
      );
      return success([input.values]);
    } catch (cause) {
      return failure(cause, 'DYNAMODB_CONFLICT');
    }
  }

  /*** Updates exactly one existing item selected by its complete physical key. */
  public async update<TRecord extends object>(
    input: DbUpdateInput<TRecord>,
  ): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      const key = toExactDynamoDbKey(input.filters, table, 'update');
      const values = Object.entries(input.values);
      if (values.length === 0) throw unsupported('empty update');
      const condition = createDynamoDbKeyCondition(table, 'attribute_exists');
      const update = this.updateExpression(values, table);
      const output = await this.client.send(
        new UpdateCommand({
          TableName: table.name,
          Key: key,
          UpdateExpression: update.expression,
          ConditionExpression: condition.expression,
          ExpressionAttributeNames: { ...update.names, ...condition.names },
          ExpressionAttributeValues: update.values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      if (output.Attributes === undefined)
        throw provider('DYNAMODB_ERROR', 'persisted update missing');
      return success([output.Attributes as TRecord]);
    } catch (cause) {
      return failure(cause, 'DYNAMODB_NOT_FOUND');
    }
  }

  /*** Deletes exactly one existing item selected by its complete physical key. */
  public async delete<TRecord extends object>(input: DbDeleteInput): Promise<DbResult<TRecord[]>> {
    try {
      const table = this.table(input.table, input.schema);
      const key = toExactDynamoDbKey(input.filters, table, 'delete');
      const condition = createDynamoDbKeyCondition(table, 'attribute_exists');
      const output = await this.client.send(
        new DeleteCommand({
          TableName: table.name,
          Key: key,
          ConditionExpression: condition.expression,
          ExpressionAttributeNames: condition.names,
          ReturnValues: 'ALL_OLD',
        }),
      );
      if (output.Attributes === undefined) throw provider('DYNAMODB_NOT_FOUND', 'record missing');
      return success([output.Attributes as TRecord]);
    } catch (cause) {
      return failure(cause, 'DYNAMODB_NOT_FOUND');
    }
  }

  /*** Resolves a table through the explicit application configuration only. */
  private table(name: string, schema: string | undefined): DynamoDbTable {
    if (schema !== undefined) throw unsupported('schema-qualified table');
    const table = Object.entries(this.tables).find(([candidate]) => candidate === name)?.[1];
    if (table === undefined) throw unsupported(`unconfigured table ${name}`);
    return table;
  }

  /*** Builds a safe update expression without permitting physical-key changes. */
  private updateExpression(
    values: readonly [string, unknown][],
    table: DynamoDbTable,
  ): {
    readonly expression: string;
    readonly names: Record<string, string>;
    readonly values: Record<string, unknown>;
  } {
    const physicalKeys = [
      table.partitionKey,
      ...(table.sortKey === undefined ? [] : [table.sortKey]),
    ];
    if (values.some(([field]) => physicalKeys.includes(field)))
      throw unsupported('update of a physical key attribute');
    return {
      expression: `SET ${values.map((_, index) => `#update${index} = :update${index}`).join(', ')}`,
      names: Object.fromEntries(values.map(([field], index) => [`#update${index}`, field])),
      values: Object.fromEntries(values.map(([, value], index) => [`:update${index}`, value])),
    };
  }
}
