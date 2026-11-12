# Public API

## createDynamoDbAdapter

Kind: `value`
Module: `src/features/dynamodb/createDynamoDbAdapter.ts`
Source: `src/features/dynamodb/createDynamoDbAdapter.ts:8:14`

Creates a DynamoDB adapter with either caller-owned or adapter-owned AWS client lifecycle.

### Signatures

- `(config: DynamoDbAdapterConfig) => DynamoDbAdapter`
  - config: `DynamoDbAdapterConfig`
  - returns: `DynamoDbAdapter`

## DynamoDbAdapter

Kind: `unknown`
Module: `src/features/dynamodb/types.ts`
Source: `src/features/dynamodb/types.ts:55:1`

## DynamoDbAdapterConfig

Kind: `type`
Module: `src/features/dynamodb/types.ts`
Source: `src/features/dynamodb/types.ts:32:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| client | property | `DynamoDbCommandTransport` | no |  |
| clientConfig | property | `DynamoDBClientConfig` | no |  |
| tables | property | `Readonly<Record<string, DynamoDbTable>>` | yes |  |

## DynamoDbAdapterLifecycle

Kind: `type`
Module: `src/features/dynamodb/types.ts`
Source: `src/features/dynamodb/types.ts:49:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| close | method | `() => Promise<void>` | yes |  |
| ownsClient | property | `boolean` | yes |  |

## DynamoDbCommandTransport

Kind: `type`
Module: `src/features/dynamodb/types.ts`
Source: `src/features/dynamodb/types.ts:39:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| destroy | method | `() => void` | no |  |
| send | method | `{ (command: GetCommand): Promise<GetCommandOutput>; (command: PutCommand): Promise<PutCommandOutput>; (command: UpdateCommand): Promise<UpdateCommandOutput>; (command: DeleteCommand): Promise<DeleteCommandOutput>; (command: QueryCommand): Promise<QueryCommandOutput>; }` | yes |  |

## DynamoDbIndex

Kind: `type`
Module: `src/features/dynamodb/types.ts`
Source: `src/features/dynamodb/types.ts:17:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| name | property | `string` | yes |  |
| partitionKey | property | `string` | yes |  |
| sortKey | property | `string` | no |  |

## DynamoDbTable

Kind: `type`
Module: `src/features/dynamodb/types.ts`
Source: `src/features/dynamodb/types.ts:24:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| index | property | `DynamoDbIndex` | no |  |
| name | property | `string` | yes |  |
| partitionKey | property | `string` | yes |  |
| sortKey | property | `string` | no |  |
