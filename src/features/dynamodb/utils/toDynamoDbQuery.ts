import type { DbSelectInput } from '@ankhorage/contracts/db';

import type { DynamoDbTable } from '../types.js';
import { unsupported } from './dynamoDbResult.js';

interface DynamoDbQueryKey {
  readonly partitionKey: string;
  readonly sortKey?: string;
}

/*** Translates a bounded portable select into its DynamoDB key-condition request. */
export const toDynamoDbQuery = (
  input: DbSelectInput,
  table: DynamoDbTable,
): {
  readonly IndexName?: string;
  readonly KeyConditionExpression: string;
  readonly ExpressionAttributeNames: Record<string, string>;
  readonly ExpressionAttributeValues: Record<string, unknown>;
} => {
  validateQueryPage(input);
  const key = table.index ?? table;
  validateQuerySort(input, key);
  return {
    ...(table.index === undefined ? {} : { IndexName: table.index.name }),
    ...createQueryCondition(input, key),
  };
};

/*** Rejects generic pagination and projection semantics DynamoDB cannot represent safely. */
const validateQueryPage = (input: DbSelectInput): void => {
  if (input.columns !== undefined) throw unsupported('column projection');
  if (input.page?.offset !== undefined) throw unsupported('offset pagination');
  if (
    input.page?.limit === undefined ||
    !Number.isSafeInteger(input.page.limit) ||
    input.page.limit < 1
  )
    throw unsupported('an unbounded or invalid query limit');
};

/*** Rejects portable sorts that do not match the configured DynamoDB query key. */
const validateQuerySort = (input: DbSelectInput, key: DynamoDbQueryKey): void => {
  if (input.sort && (input.sort.length !== 1 || input.sort[0]?.field !== key.sortKey))
    throw unsupported('sort outside the configured query sort key');
};

/*** Creates a DynamoDB key condition only from configured partition and sort filters. */
const createQueryCondition = (
  input: DbSelectInput,
  key: DynamoDbQueryKey,
): {
  readonly KeyConditionExpression: string;
  readonly ExpressionAttributeNames: Record<string, string>;
  readonly ExpressionAttributeValues: Record<string, unknown>;
} => {
  const filters = input.filters ?? [];
  const partition = filters.find((filter) => filter.field === key.partitionKey);
  if (partition?.operator !== 'eq') throw unsupported('query without query partition-key equality');
  const rest = filters.filter((filter) => filter !== partition);
  const [sort] = rest;
  if (
    rest.length > 1 ||
    (sort !== undefined &&
      (sort.field !== key.sortKey || !['eq', 'gt', 'gte', 'lt', 'lte'].includes(sort.operator)))
  )
    throw unsupported('query filters outside the configured query key');
  return sort === undefined
    ? {
        KeyConditionExpression: '#partition = :partition',
        ExpressionAttributeNames: { '#partition': key.partitionKey },
        ExpressionAttributeValues: { ':partition': partition.value },
      }
    : {
        KeyConditionExpression: `#partition = :partition AND #sort ${toDynamoOperator(sort.operator)} :sort`,
        ExpressionAttributeNames: { '#partition': key.partitionKey, '#sort': key.sortKey ?? '' },
        ExpressionAttributeValues: { ':partition': partition.value, ':sort': sort.value },
      };
};

/*** Maps portable range-filter operators to DynamoDB key-condition syntax. */
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
