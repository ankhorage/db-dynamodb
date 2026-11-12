import type { DbAdapter } from '@ankhorage/contracts/db';
import type { DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import type {
  DeleteCommand,
  DeleteCommandOutput,
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  PutCommandOutput,
  QueryCommand,
  QueryCommandOutput,
  UpdateCommand,
  UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';

/** Maps one portable collection name to a DynamoDB table and queryable key. */
export interface DynamoDbTable {
  readonly name: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
  readonly indexName?: string;
}

/** Supplies explicit table and client ownership configuration for the DynamoDB adapter. */
export interface DynamoDbAdapterConfig {
  readonly tables: Readonly<Record<string, DynamoDbTable>>;
  readonly client?: DynamoDBDocumentClient;
  readonly clientConfig?: DynamoDBClientConfig;
}

/** Represents the minimal AWS command boundary required by the adapter. */
export interface DynamoDbCommandTransport {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
  send(command: DeleteCommand): Promise<DeleteCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
}

/** Unites the AWS commands issued by this adapter. */
export type DynamoDbCommand =
  GetCommand | PutCommand | UpdateCommand | DeleteCommand | QueryCommand;

/** Exposes lifecycle ownership alongside the portable database adapter. */
export interface DynamoDbAdapterLifecycle {
  close(): Promise<void>;
  readonly ownsClient: boolean;
}

/** Defines the complete DynamoDB adapter surface. */
export type DynamoDbAdapter = DbAdapter & DynamoDbAdapterLifecycle;

/** Defines a factory accepted AWS client constructor. */
