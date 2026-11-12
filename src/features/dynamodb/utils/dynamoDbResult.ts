import type { DbAdapterError } from '@ankhorage/contracts/db';

/*** Produces a successful portable result. */
export const success = <TData>(data: TData): { readonly ok: true; readonly data: TData } => ({
  ok: true,
  data,
});

/*** Converts provider and validation failures into safe portable error categories. */
export const failure = (
  cause: unknown,
  conditionalFailureCode?: 'DYNAMODB_CONFLICT' | 'DYNAMODB_NOT_FOUND',
): { readonly ok: false; readonly error: DbAdapterError } => ({
  ok: false,
  error: toError(cause, conditionalFailureCode),
});

/*** Creates a deterministic unsupported-operation error. */
export const unsupported = (operation: string): DynamoDbAdapterError =>
  provider('DYNAMODB_UNSUPPORTED', `DynamoDB does not safely support ${operation}.`);

/*** Creates a safe provider failure without retaining the original provider error. */
export const provider = (code: string, category: string): DynamoDbAdapterError =>
  new DynamoDbAdapterError(code, `DynamoDB ${category}.`);

/*** Normalizes AWS failures without exposing provider messages, metadata, tokens, or stacks. */
const toError = (
  cause: unknown,
  conditionalFailureCode?: 'DYNAMODB_CONFLICT' | 'DYNAMODB_NOT_FOUND',
): DbAdapterError => {
  if (cause instanceof DynamoDbAdapterError) return { code: cause.code, message: cause.message };
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'ConditionalCheckFailedException')
    return conditionalFailureCode === 'DYNAMODB_NOT_FOUND'
      ? { code: 'DYNAMODB_NOT_FOUND', message: 'The requested record does not exist.' }
      : {
          code: 'DYNAMODB_CONFLICT',
          message: 'The requested record state conflicts with persisted data.',
        };
  if (name === 'ValidationException')
    return { code: 'DYNAMODB_INVALID_REQUEST', message: 'DynamoDB rejected the request.' };
  if (name === 'ProvisionedThroughputExceededException' || name === 'ThrottlingException')
    return { code: 'DYNAMODB_UNAVAILABLE', message: 'DynamoDB is temporarily unavailable.' };
  return { code: 'DYNAMODB_ERROR', message: 'DynamoDB request failed.' };
};

/** Represents a safe adapter failure category without carrying provider details. */
class DynamoDbAdapterError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
