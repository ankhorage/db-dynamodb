import type { DynamoDbTable } from '../types.js';
import { unsupported } from './dynamoDbResult.js';

/*** Builds a DynamoDB condition over every configured physical key attribute. */
export const createDynamoDbKeyCondition = (
  table: DynamoDbTable,
  predicate: 'attribute_exists' | 'attribute_not_exists',
): { readonly expression: string; readonly names: Record<string, string> } => {
  const fields = physicalKeyFields(table);
  return {
    expression: fields.map((_, index) => `${predicate}(#key${index})`).join(' AND '),
    names: Object.fromEntries(fields.map((field, index) => [`#key${index}`, field])),
  };
};

/*** Extracts a complete physical primary key from equality filters. */
export const toExactDynamoDbKey = (
  filters: readonly {
    readonly field: string;
    readonly operator: string;
    readonly value: unknown;
  }[],
  table: DynamoDbTable,
  operation: string,
): Record<string, unknown> => {
  const fields = physicalKeyFields(table);
  if (filters.length !== fields.length || filters.some((filter) => filter.operator !== 'eq'))
    throw unsupported(`${operation} without exact physical-key equality`);
  const key = Object.fromEntries(filters.map((filter) => [filter.field, filter.value]));
  if (Object.keys(key).length !== fields.length || fields.some((field) => !(field in key)))
    throw unsupported(`${operation} without an exact configured physical key`);
  return key;
};

/*** Rejects inserts that omit a configured physical primary-key attribute. */
export const validateDynamoDbItemKey = (item: object, table: DynamoDbTable): void => {
  if (
    physicalKeyFields(table).some(
      (field) =>
        !Object.prototype.hasOwnProperty.call(item, field) ||
        Reflect.get(item, field) === undefined,
    )
  )
    throw unsupported('insert without complete physical-key attributes');
};

/*** Returns the configured physical attributes that identify one DynamoDB item. */
const physicalKeyFields = (table: DynamoDbTable): readonly string[] => [
  table.partitionKey,
  ...(table.sortKey === undefined ? [] : [table.sortKey]),
];
