import type { DbAdapter } from '@ankhorage/contracts/db';
import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
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

/** Maps an optional DynamoDB query index without changing a table's physical key. */
export interface DynamoDbIndex {
  readonly name: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
}

/** Maps one portable collection name to its physical DynamoDB table key and optional query index. */
export interface DynamoDbTable {
  readonly name: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
  readonly index?: DynamoDbIndex;
}

/** Supplies explicit table and client ownership configuration for the DynamoDB adapter. */
export interface DynamoDbAdapterConfig {
  readonly tables: Readonly<Record<string, DynamoDbTable>>;
  readonly client?: DynamoDbCommandTransport;
  readonly clientConfig?: DynamoDBClientConfig;
}

/** Represents the minimal AWS command boundary required by the adapter. */
export interface DynamoDbCommandTransport {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
  send(command: DeleteCommand): Promise<DeleteCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  destroy?(): void;
}

/** Exposes lifecycle ownership alongside the portable database adapter. */
export interface DynamoDbAdapterLifecycle {
  close(): Promise<void>;
  readonly ownsClient: boolean;
}

/** Defines the complete DynamoDB adapter surface. */
export type DynamoDbAdapter = DbAdapter & DynamoDbAdapterLifecycle;
