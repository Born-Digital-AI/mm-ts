import { SqlUtil } from '../src/mm-util/SqlUtil';
export interface DbConfig {
    host?: string;
    user?: string;
    password?: string;
    database?: string;
    port?: string | number;
    logger?: (msg: any) => void;
    initSqls?: string[];
}
export interface PgDbConfig extends DbConfig {
    connectionTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    max?: number;
}
export interface MysqlDbConfig extends DbConfig {
}
export interface MysqlPoolDbConfig extends MysqlDbConfig {
    multipleStatements?: boolean;
}
export declare const testSuiteFactorySqlUtilDialectBased: (db: SqlUtil, testsAll: any, shouldSkipResolver: any) => void;
