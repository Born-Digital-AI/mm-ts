"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
// import isObject from 'lodash-es/isObject';
// import isDate from 'lodash-es/isDate';
const util = require("util");
const mysqlSqlstring = require("sqlstring");
class SqlUtil {
    /**
     * @param dialect
     * @param db
     * @param initSqls
     */
    constructor(dialect, db, initSqls) {
        this.initSqls = initSqls;
        /**
         * lazy initiate just once helper flag
         */
        this._initiated = false;
        this.dialect = SqlUtil.normalizeDialectName(dialect);
        if (!this.isPg() && !this.isMysql() && !this.isSqlite()) {
            throw new Error(`Dialect ${this.dialect} not (yet) supported.`);
        }
        if (db) {
            this.db = db;
        }
    }
    /**
     * @private
     */
    _lazyInitOnce() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._initiated) {
                this._initiated = true;
                if (this.initSqls && Array.isArray(this.initSqls)) {
                    for (let sql of this.initSqls) {
                        yield this.query(sql);
                    }
                }
            }
        });
    }
    static normalizeDialectName(dialect) {
        for (let normalized of Object.keys(SqlUtil._dialectNormalizeMap)) {
            if (SqlUtil._dialectNormalizeMap[normalized].test(dialect)) {
                return normalized;
            }
        }
        return dialect;
    }
    /**
     * @param driverProxy
     */
    set db(driverProxy) {
        this._db = driverProxy;
    }
    /**
     * @returns {any}
     */
    get db() {
        return this._db;
    }
    /**
     * @param driverProxy
     * @param initSqls
     */
    static pg(driverProxy, initSqls) {
        return new SqlUtil('pg', driverProxy, initSqls);
    }
    /**
     * @param driverProxy
     * @param initSqls
     */
    static mysql(driverProxy, initSqls) {
        return new SqlUtil('mysql', driverProxy, initSqls);
    }
    /**
     * @param driverProxy
     * @param initSqls
     */
    static sqlite(driverProxy, initSqls) {
        return new SqlUtil('sqlite', driverProxy, initSqls);
    }
    /**
     * @returns {boolean}
     */
    isPg() {
        return this.dialect === SqlUtil.DIALECT_PG;
    }
    /**
     * @returns {boolean}
     */
    isMysql() {
        return this.dialect === SqlUtil.DIALECT_MYSQL;
    }
    /**
     *
     */
    isSqlite() {
        return this.dialect === SqlUtil.DIALECT_SQLITE;
    }
    /**
     * @param {string} column
     * @param {boolean} forceNOT
     * @returns {{column: string; sign: string}}
     * @private
     */
    _getOptionalSignFromColNotation(column, forceNOT = false) {
        let sign = '';
        let m;
        let LIKE = this.isPg() ? 'ILIKE' : 'LIKE';
        // match na 2 posledne znaky
        m = column.substr(-2).match(/^(!=|<>|<=|>=|!~)$/);
        if (m) {
            sign = m[1] === '!=' ? '<>' : m[1]; // normalize to <>
            if ('!~' === sign) {
                sign = `NOT ${LIKE}`;
            }
            column = column.substr(0, column.length - 2);
        }
        else {
            // match na 1 posledny znak
            m = column.substr(-1).match(/^([!<>=~])$/);
            if (m) {
                sign = m[1] === '!' ? '<>' : m[1];
                if ('~' === sign) {
                    sign = `${LIKE}`;
                }
                column = column.substr(0, column.length - 1);
            }
        }
        // ak forcujeme NOT, tak bud NOT alebo nic (ostatne ignorujeme)
        if (forceNOT && '<>' === sign) {
            sign = 'NOT';
        }
        return { column, sign };
    }
    /**
     * @param columnMaybeWithSign
     * @returns {{column: string; sign: string}}
     */
    getSignFromColNotation(columnMaybeWithSign) {
        let { column, sign } = this._getOptionalSignFromColNotation(`${columnMaybeWithSign}`, false);
        return {
            column,
            sign: sign !== '' ? sign : '=',
        };
    }
    /**
     * Toto vysklada z where "AND $k = $v" podmienku... s tym, ze pozna rozne
     * notacie a aj nejake carovne stringy... pridana hodnota oproti rucnemu
     * vyskladaniu je automaticke quotovanie (ak $where je pole)... mozne pouzitie:
     *
     * where                  ---> sql
     * ------------------------------------------------------
     * "id = 1"               ---> id = 1
     * {"id":   1}            ---> id = '1'
     * {"id" :  [1,2]}        ---> id IN ('1','2')
     * {"id!":  1}            ---> id <> '1'
     * {"id<":  1}            ---> id < '1'
     * {"id<=": 1}            ---> id <= '1'
     * {"id!":  [1,2]}        ---> id NOT IN ('1','2')
     * {"id~":  'abc'}        ---> id ILIKE 'abc'
     * {"id!~": 'abc'}        ---> id NOT ILIKE 'abc'
     * {"=":    "untouched"}  ---> untouched
     *
     * @param {string | Object} where
     * @param {string} operator
     * @returns {string}
     */
    buildWhere(where, operator = 'AND') {
        let sql = '';
        const signParser = this._getOptionalSignFromColNotation.bind(this); // shortcut
        where = where || '';
        if (_.isObject(where)) {
            Object.keys(where).forEach((col) => {
                let val = where[col];
                // ak je `col` rovny "=" vtedy nic neescapuje ani nevyskladava...
                // taky mini hack ak potrebujem dat nejake special veci (ci uz
                // nejaku expressionu alebo vnorenu "OR" podmienku atd...)
                // ale stale chcem vyuzit `where` (vzdy mozem sql napisat rucne)
                if ('=' === col) {
                    sql += `${val}`;
                }
                // ak je hodnota array, tak vyskladame (NOT)? IN (...)
                else if (Array.isArray(val)) {
                    val = val.map(this.qv.bind(this));
                    let { sign, column } = signParser(col, true);
                    sql += util.format(`${operator} %s %s IN (%s) `, this.qi(column), sign, val.join(','));
                }
                // nakoniec normalne "k znamienko v"
                else {
                    let parsed;
                    if (null === val) {
                        parsed = signParser(col, true);
                        let sign = parsed.sign;
                        if (sign === '=') {
                            sign = '';
                        }
                        val = ` IS ${sign} NULL `;
                    }
                    else {
                        parsed = signParser(col);
                        let { sign } = parsed;
                        if ('' === sign) {
                            sign = ' = ';
                        }
                        val = ` ${sign} ` + this.qv(val);
                    }
                    sql += util.format(` ${operator} %s %s `, this.qi(parsed.column), val);
                }
            });
        }
        //
        else if ('' !== `${where}`.trim()) {
            sql += `${operator} ${where}`;
        }
        sql = sql.trim();
        // odrezeme `operator` zlava
        if (operator === sql.substr(0, operator.length)) {
            sql = sql.substr(operator.length);
        }
        return sql.trim();
    }
    /**
     * @param addons
     * @returns {string}
     */
    buildAddons(addons) {
        let sql = '';
        if (!addons) {
            return sql;
        }
        if (addons.group_by) {
            sql += util.format(`GROUP BY %s `, this.qi(addons.group_by));
        }
        if (addons.order_by) {
            sql += util.format(`ORDER BY %s `, addons.order_by);
        }
        if (addons.limit) {
            sql += util.format(`LIMIT %i `, addons.limit);
        }
        if (addons.offset) {
            sql += util.format(`OFFSET %i `, addons.offset);
        }
        return sql.trim();
    }
    /**
     * qoute value in postgres dialect
     * https://github.com/segmentio/pg-escape
     * @param val
     * @returns {any}
     * @private
     */
    _qvPg(val) {
        // nulls (and undefineds) are NULL
        if (null === val || val === void 0) {
            return 'NULL';
        }
        // opnionated: Dates are converted to ISO
        if (_.isDate(val)) {
            val = val.toISOString();
        }
        if (Array.isArray(val)) {
            let vals = val.map(this._qvPg);
            return `(${vals.join(', ')})`;
        }
        val = `${val}`;
        let backslash = -1 !== val.indexOf('\\');
        let prefix = backslash ? 'E' : '';
        val = val.replace(/'/g, `''`);
        val = val.replace(/\\/g, `\\\\`);
        return `${prefix}'${val}'`;
    }
    /**
     * @param val
     * @returns {any}
     * @private
     */
    _qvMysql(val) {
        return mysqlSqlstring.escape(val);
    }
    /**
     * @param val
     * @private
     */
    _qvSqlite(val) {
        if (null === val || val === void 0) {
            return 'NULL';
        }
        // opnionated: Dates are converted to ISO
        if (_.isDate(val)) {
            val = val.toISOString();
        }
        val = `${val}`;
        val = val.replace(/'/g, `''`);
        return `'${val}'`;
    }
    /**
     * "qv" = quote value
     * @param val
     * @returns {string}
     */
    qv(val) {
        if (this.isPg()) {
            return this._qvPg(val);
        }
        if (this.isMysql()) {
            return this._qvMysql(val);
        }
        if (this.isSqlite()) {
            return this._qvSqlite(val);
        }
        throw new Error('Not supported');
    }
    /**
     * quote identifier in postgres dialect
     * https://github.com/segmentio/pg-escape
     * @param id
     * @returns {string}
     * @private
     */
    _qiPg(id) {
        return `"${id.replace(/"/g, '""')}"`;
    }
    /**
     * @param id
     * @returns {any}
     * @private
     */
    _qiMysql(id) {
        return mysqlSqlstring.escapeId(id);
    }
    /**
     * @param id
     * @private
     */
    _qiSqlite(id) {
        return this._qiPg(id);
    }
    /**
     * "qi" = quote identifier
     * @param val
     * @returns {string}
     */
    qi(val) {
        if (this.isPg()) {
            return this._qiPg(val);
        }
        if (this.isMysql()) {
            return this._qiMysql(val);
        }
        if (this.isSqlite()) {
            return this._qiSqlite(val);
        }
        throw new Error('Not supported');
    }
    /**
     * execute "raw" query
     * @param query
     * @param params
     * @param {boolean} debug
     * @returns {Promise<void>}
     */
    query(query, params, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            if (`${query}`.trim() === '') {
                return null;
            }
            yield this._lazyInitOnce();
            debug && console.log('QUERY:', query, '\nPARAMS:', params);
            return this.db.query(query, params ? params : []);
        });
    }
    /**
     * @param {string} fields
     * @param {string} table
     * @param where
     * @param options
     * @param {boolean} debug
     * @returns {Promise<any>}
     */
    fetchRow(fields, table, where, options, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            options = Object.assign({}, options || {}, { limit: 1 });
            let rows = yield this._fetchAll(fields, table, where, options, debug);
            return rows[0];
        });
    }
    /**
     * First col (via Object.keys...) of first row
     * @param {string} field
     * @param {string} table
     * @param where
     * @param options
     * @param {boolean} debug
     * @returns {Promise<any>}
     */
    fetchOne(field, table, where, options, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            options = Object.assign({}, options || {}, { limit: 1 });
            let rows = yield this._fetchAll(field, table, where, options, debug);
            if (!rows || !rows.length) {
                return false;
            }
            let key = Object.keys(rows[0])[0];
            return rows[0][key];
        });
    }
    /**
     * @param {string} fields
     * @param {string} table
     * @param where
     * @param options
     * @param {boolean} debug
     * @returns {Promise<any[]>}
     */
    fetchAll(fields, table, where, options, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            return this._fetchAll(fields, table, where, options, debug);
        });
    }
    /**
     * @param {string} fields
     * @param {string} table
     * @param where
     * @param options
     * @param {boolean} debug
     * @returns {Promise<any[]>}
     * @private
     */
    _fetchAll(fields, table, where, options, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            where = this.buildWhere(where);
            if (where !== '') {
                where = ` WHERE ${where}`;
            }
            let addons = this.buildAddons(options);
            let sql = `SELECT ${fields} FROM ${table} ${where} ${addons}`;
            // let { rows } = await this.query(sql, [], debug);
            // return rows;
            // normalizujem do pg tvaru
            let res = yield this.query(sql, [], debug);
            return res.rows ? res.rows : res;
        });
    }
    /**
     * @param {string} table
     * @param where
     * @param {boolean} debug
     * @returns {Promise<number>}
     */
    fetchCount(table, where, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            where = this.buildWhere(where);
            if (where !== '') {
                where = ` WHERE ${where}`;
            }
            let sql = `SELECT COUNT(*) AS count FROM ${table} ${where}`;
            // let { rows } = await this.query(sql, [], debug);
            // normalizujem do pg tvaru
            let res = yield this.query(sql, [], debug);
            let rows = res.rows ? res.rows : res;
            return parseInt(rows[0].count, 10);
        });
    }
    /**
     * WARNING: return value depends on the driver...
     * @param {string} table
     * @param data
     * @param {boolean} debug
     * @returns {Promise<any>}
     */
    insert(table, data, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            let sql = `INSERT INTO ${table} `;
            let keys = [];
            let values = [];
            Object.keys(data).forEach((k) => {
                keys.push(this.qi(k));
                values.push(this.qv(data[k]));
            });
            sql += `(${keys.join(', ')}) VALUES (${values.join(', ')})`;
            // WARNING: different behaviour for different driver
            let res;
            // PG: return the new row
            if (this.isPg()) {
                sql += ' RETURNING *'; // hard postgres dialect
                res = yield this.query(sql, [], debug);
                return res.rows[0];
            }
            res = yield this.query(sql, [], debug);
            // note: this might be confusing as diferent engines returns different value...
            // (sqlite returns 'rowid', mysql might return insert id for previous inserts...)
            // consumer must know how to handle the result
            return this.lastInsertId();
        });
    }
    /**
     * WARNING: return value depends on the driver...
     * @param {string} table
     * @param data
     * @param where
     * @param {boolean} debug
     * @returns {Promise<any>}
     */
    update(table, data, where, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            let sql = `UPDATE ${table} SET `;
            let pairs = [];
            Object.keys(data).forEach((k) => {
                let val = data[k];
                // ne neescapovanie podporujeme s operatorom "="
                let { sign, column } = this._getOptionalSignFromColNotation(k, false);
                if (sign.trim() === '=') {
                    k = column;
                }
                else {
                    val = this.qv(val);
                }
                pairs.push(`${this.qi(k)} = ${val}`);
            });
            where = this.buildWhere(where);
            if (where !== '') {
                where = ` WHERE ${where}`;
            }
            sql += `${pairs.join(', ')} ${where}`;
            // WARNING: different behaviour for different driver
            let res;
            // PG: return the new row
            if (this.isPg()) {
                sql += ' RETURNING *'; // hard postgres dialect
                res = yield this.query(sql, [], debug);
                return res.rows[0];
            }
            // MYSQL: return affected rows count
            res = yield this.query(sql, [], debug);
            if (this.isMysql()) {
                return res.affectedRows;
            }
            // if (this.isSqlite()) {
            //     // to do
            // }
            // should not be reached...
            return null;
        });
    }
    /**
     * @param {string} table
     * @param where
     * @param options
     * @param {boolean} debug
     * @returns {Promise<boolean>}
     */
    delete(table, where, options, debug = false) {
        return __awaiter(this, void 0, void 0, function* () {
            let addons = '';
            if (where === true) {
                // use with caution!
                where = '1=1';
            }
            else {
                where = this.buildWhere(where);
                if (where === '') {
                    return false;
                }
                addons = this.buildAddons(options);
            }
            let sql = `DELETE FROM ${table} WHERE ${where} ${addons}`;
            return yield this.query(sql, [], debug);
        });
    }
    /**
     * @param {any} name
     * @returns {Promise<any>}
     */
    lastInsertId(name = null) {
        return __awaiter(this, void 0, void 0, function* () {
            // pg
            if (this.isPg()) {
                // CURRVAL: Return value most recently obtained with nextval for specified sequence
                // LASTVAL: Return value most recently obtained with nextval for any sequence
                let sql = name
                    ? `SELECT CURRVAL(${this.qi(name)}) AS lid;`
                    : `SELECT LASTVAL() AS lid;`;
                let { rows } = yield this.query(sql);
                return parseInt(rows[0].lid, 10);
            }
            // mysql
            else if (this.isMysql()) {
                let rows = yield this.query(`SELECT LAST_INSERT_ID() AS lid;`);
                return parseInt(rows[0].lid, 10);
            }
            // sqlite
            else if (this.isSqlite()) {
                let rows = yield this.query(`SELECT last_insert_rowid() AS lid;`);
                return parseInt(rows[0].lid, 10);
            }
            return null;
        });
    }
}
exports.SqlUtil = SqlUtil;
SqlUtil.DIALECT_PG = 'pg';
SqlUtil.DIALECT_MYSQL = 'mysql';
SqlUtil.DIALECT_SQLITE = 'sqlite';
/**
 *
 */
SqlUtil._dialectNormalizeMap = {
    [SqlUtil.DIALECT_PG]: /pg(sql)?|postgres(ql)?/i,
    [SqlUtil.DIALECT_MYSQL]: /mysql|mariadb/i,
    [SqlUtil.DIALECT_SQLITE]: /sqlite/i,
};
