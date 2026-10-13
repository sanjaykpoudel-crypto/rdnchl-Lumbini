/**
 * @NApiVersion 2.1
 */
define(['N/http', 'N/https', 'N/file', 'N/encode', './npiconfig', 'N/cache', 'N/search', 'N/record', 'N/crypto/certificate', 'N/error', './govbillers', 'N/runtime'],
    function (http, https, file, encode, npiconf, cache, search, record, certificate, error, govbillers, runtime) {
        const TOKEN_CACHE = 'LC_NCHL_TOKENS'
        const LIST_CACHE = 'LC_NCHL_LISTS'
        const REFRESH_TOKEN_MS = 12 * 60 * 60 * 1000
        // renew a little early so a token does not expire while a request is on its way
        const TOKEN_MARGIN_MS = 30 * 1000

        /**
         * NCHL connection: the default one (npiconfig, through the relay) for payments, or the NPI Billers one
         * (govbillers.NPI, NCHL's separate UAT login) for paying bills confirmed in the iframe
         * @param {string} [name] 'BILLER' for the NPI Billers connection
         * @returns {{HOST, USERNAME, PASSWORD, USERID, USERPASS, CERTIFICATE_ID, cachePrefix: string}}
         */
        function connection(name) {
            if (name !== 'BILLER') {
                return Object.assign({cachePrefix: ''}, npiconf)
            }
            let secrets
            try {
                secrets = JSON.parse(file.load({id: govbillers.NPI.CREDENTIALS_FILE}).getContents())
            } catch (e) {
                throw error.create({name: 'NPI_BILLER_NOT_SET_UP', message: `NPI Billers passwords not found in ${govbillers.NPI.CREDENTIALS_FILE}`})
            }
            return Object.assign({cachePrefix: 'biller_'}, govbillers.NPI, {PASSWORD: secrets.PASSWORD, USERPASS: secrets.USERPASS})
        }

        // the relay is plain HTTP; NCHL's own hosts are HTTPS, which N/http does not call
        function transport(url) {
            return /^https:/i.test(url) ? https : http
        }

        /**
         * POST to NCHL's /oauth/token with the client's Basic credentials
         * @param {Object} body form fields
         * @param {Object} conn connection()
         * @returns {Object} NCHL's answer
         * @throws NPI_TOKEN_HTTP_<status> when NCHL answers with an error status
         */
        function requesttoken(body, conn) {
            // Basic auth requires standard base64; the URL-safe alphabet changes '+' and '/'
            const b64basic = encode.convert({
                string: conn.USERNAME + ':' + conn.PASSWORD,
                inputEncoding: encode.Encoding.UTF_8,
                outputEncoding: encode.Encoding.BASE_64
            })
            const response = transport(conn.HOST).request({
                method: http.Method.POST,
                url: conn.HOST + '/oauth/token',
                headers: {
                    'Authorization': 'Basic ' + b64basic,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            })
            if (response.code !== 200) {
                throw error.create({
                    name: `NPI_TOKEN_HTTP_${response.code}`,
                    message: `NCHL ${body.grant_type} token request failed with HTTP ${response.code}: ${response.body}`
                })
            }
            return JSON.parse(response.body)
        }

        function readcached(store, key) {
            const value = store.get({key: key})
            return value ? JSON.parse(value) : null
        }

        /**
         * @returns {{token: string, expiresAt: number}} what was cached
         */
        function savecached(store, key, token, lifetimeMs) {
            const entry = {token: token, expiresAt: Date.now() + lifetimeMs}
            // N/cache keeps an entry at least 300 seconds; expiresAt decides whether it is still usable
            store.put({key: key, value: JSON.stringify(entry), ttl: Math.max(300, Math.floor(lifetimeMs / 1000))})
            return entry
        }

        /**
         * NCHL lists change rarely; keep them 12 hours so forms do not wait for NCHL on every change.
         * Empty answers (NCHL unreachable) are not kept.
         */
        function cachedlist(key, load) {
            const store = cache.getCache({name: LIST_CACHE, scope: cache.Scope.PROTECTED})
            const cached = store.get({key: key})
            if (cached) {
                return JSON.parse(cached)
            }
            const list = load() || []
            if (list.length > 0) {
                store.put({key: key, value: JSON.stringify(list), ttl: 12 * 60 * 60})
            }
            return list
        }

        return {
            // NCHL categoryPurpose codes offered on the payment pages
            categorypurposes: {CUST: 'Customer Payment', SUPP: 'Supplier Payment'},
            /**
             * NCHL access token, kept in a server cache shared by all scripts. NCHL's rules: the password grant only
             * yields a refresh token (its access token must not be used); a refresh token lasts 12 hours and buys
             * access tokens that last 300 seconds; a refresh rejected with HTTP 400 means logging in again.
             * @param {string} [connName] 'BILLER' for the NPI Billers connection
             * @returns {string} JSON {access_token}, the shape callers already parse
             */
            generatetoken: function (connName) {
                try {
                    const conn = connection(connName)
                    const key = name => conn.cachePrefix + name
                    const store = cache.getCache({name: TOKEN_CACHE, scope: cache.Scope.PROTECTED})
                    const now = Date.now()
                    const access = readcached(store, key('access'))
                    if (access && access.expiresAt - TOKEN_MARGIN_MS > now) {
                        return JSON.stringify({access_token: access.token})
                    }
                    let refresh = readcached(store, key('refresh'))
                    if (!refresh || refresh.expiresAt - TOKEN_MARGIN_MS <= now) {
                        refresh = this.loginnchl(store, conn)
                        if (!refresh) {
                            return JSON.stringify({access_token: readcached(store, key('access')).token})
                        }
                    }
                    let granted
                    try {
                        granted = requesttoken({grant_type: 'refresh_token', refresh_token: refresh.token}, conn)
                    } catch (e) {
                        if (e.name !== 'NPI_TOKEN_HTTP_400') {
                            throw e
                        }
                        // refresh token expired or revoked before its 12 hours: log in again
                        refresh = this.loginnchl(store, conn)
                        if (!refresh) {
                            return JSON.stringify({access_token: readcached(store, key('access')).token})
                        }
                        granted = requesttoken({grant_type: 'refresh_token', refresh_token: refresh.token}, conn)
                    }
                    if (granted.refresh_token && granted.refresh_token !== refresh.token) {
                        savecached(store, key('refresh'), granted.refresh_token, REFRESH_TOKEN_MS)
                    }
                    savecached(store, key('access'), granted.access_token, (granted.expires_in || 300) * 1000)
                    return JSON.stringify({access_token: granted.access_token})
                } catch (e) {
                    log.error({
                        title: 'GEN_TOKEN_FN_ERROR',
                        details: e
                    })
                    throw e
                }
            },
            /**
             * Password grant: keeps only the refresh token
             */
            loginnchl: function (store, conn) {
                const login = requesttoken({grant_type: 'password', username: conn.USERID, password: conn.USERPASS}, conn)
                if (login.refresh_token) {
                    return savecached(store, conn.cachePrefix + 'refresh', login.refresh_token, REFRESH_TOKEN_MS)
                }
                // not what NCHL documents; keep payments working with the login's access token and make it visible
                log.error('NPI_NO_REFRESH_TOKEN', {fields: Object.keys(login)})
                savecached(store, conn.cachePrefix + 'access', login.access_token, (login.expires_in || 300) * 1000)
                return null
            },
            /**
             * Drops the cached access token, e.g. after NCHL answered 401 with it
             * @param {string} [connName] 'BILLER' for the NPI Billers connection
             */
            forgetaccesstoken: function (connName) {
                cache.getCache({name: TOKEN_CACHE, scope: cache.Scope.PROTECTED}).remove({key: connection(connName).cachePrefix + 'access'})
            },
            /**
             * NCHL bank list for CIPS or IPS, kept 12 hours
             */
            getbanklist: function (option) {
                return cachedlist(`banks_${option.type}`, () => this.fetchbanklist(option))
            },
            /**
             * Branches of one bank, kept 12 hours
             */
            getbankbranchlist: function (option) {
                return cachedlist(`branches_${option.bankId}`, () => this.fetchbankbranchlist(option))
            },
            fetchbanklist: function (option) {
                try {
                    const apiAuth = JSON.parse(this.generatetoken())
                    const uri = option.type === 'CIPS' ? '/api/getcipsbanklist' : '/api/getbanklist'
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + uri,
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + apiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: {}
                    })
                    const responseBody = JSON.parse(response.body)
                    return responseBody.sort((a, b) => {
                        const nameA = a.bankName.toUpperCase()
                        const nameB = b.bankName.toUpperCase()
                        if (nameA < nameB) {
                            return -1;
                        }
                        if (nameA > nameB) {
                            return 1;
                        }
                    })
                } catch (e) {
                    log.error({
                        title: 'ERROR_NPI_BANK_LIST',
                        details: e
                    })
                    return []
                }
            },
            fetchbankbranchlist: function (option) {
                try {
                    const apiAuth = JSON.parse(this.generatetoken())
                    const response = http.request({
                        method: http.Method.GET,
                        url: npiconf.HOST + '/api/getbranchlist/' + option.bankId,
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + apiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: {}
                    })
                    const responseBody = JSON.parse(response.body)
                    return responseBody.sort((a, b) => {
                        const nameA = a.branchName.toUpperCase()
                        const nameB = b.branchName.toUpperCase()
                        if (nameA < nameB) {
                            return -1;
                        }
                        if (nameA > nameB) {
                            return 1;
                        }
                    })
                } catch (e) {
                    log.error({
                        title: 'ERROR_NPI_BRANCH_LIST',
                        details: e
                    })
                    return []
                }
            },
            getbillertypes: function (type = 'ALL') {
                try {
                    const npiAuth = JSON.parse(this.generatetoken())
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + '/billers/v2/categories',
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + npiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: JSON.stringify({category: type})
                    })
                    //log.debug('billerresponse',response)
                    const responseBody = JSON.parse(response.body)
                    return responseBody.data
                } catch (e) {
                    log.error({
                        title: 'ERROR_NPI',
                        details: e
                    })
                    return []
                }
            },
            getentitybanks: function (entityid, type) {
                const selectOptions = [{value: '', text: ''}]
                search.create({
                    type: 'customrecord_rd_nchl_bank_detail',
                    filters: [
                        ['custrecord_nchl_bank_entity', 'anyof', entityid],
                        'AND',
                        ['custrecord_nchl_bank_type', 'is', type]
                    ],
                    columns: ['name']
                }).run().each(result => {
                    selectOptions.push({
                        value: result.id,
                        text: result.getValue('name')
                    })
                    return true
                })
                return selectOptions
            },
            /**
             * Active, NCHL-verified bank accounts of a payee for one payment type
             * @param {string|number} entityid vendor / employee internal id
             * @param {string} type CIPS or IPS
             * @returns {{id: string, name: string, bank: Object, branch: Object, accountName: string, accountNumber: string}[]}
             */
            getpayeeaccounts: function (entityid, type) {
                const accounts = []
                search.create({
                    type: 'customrecord_rd_nchl_bank_detail',
                    filters: [
                        ['custrecord_nchl_bank_entity', 'anyof', entityid],
                        'AND',
                        this.banktypefilter(type),
                        'AND',
                        ['custrecord_nchl_account_verified', 'is', 'T'],
                        'AND',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: ['name', 'custrecord_nchl_bank_type', 'custrecord_rdnchl_bank_prop', 'custrecord_rdnchl_bank_branch_prop',
                        'custrecord_rdnchl_account_name', 'custrecord_rdnchl_account_number']
                }).run().each(result => {
                    accounts.push({
                        id: result.id,
                        type: result.getValue('custrecord_nchl_bank_type'),
                        name: result.getValue('name'),
                        bank: JSON.parse(result.getValue('custrecord_rdnchl_bank_prop') || '{}'),
                        branch: JSON.parse(result.getValue('custrecord_rdnchl_bank_branch_prop') || '{}'),
                        accountName: result.getValue('custrecord_rdnchl_account_name'),
                        accountNumber: result.getValue('custrecord_rdnchl_account_number')
                    })
                    return true
                })
                return this.uniqueaccounts(accounts, type)
            },
            /**
             * Bank detail types that can receive a payment of this type: real time (CIPS) needs a bank on NCHL's CIPS
             * list; non real time (IPS) reaches any account, and NCHL uses the same bank codes on both lists
             * @param {string} type CIPS or IPS
             */
            banktypefilter: function (type) {
                return type === 'IPS'
                    ? [['custrecord_nchl_bank_type', 'is', 'IPS'], 'OR', ['custrecord_nchl_bank_type', 'is', 'CIPS']]
                    : ['custrecord_nchl_bank_type', 'is', 'CIPS']
            },
            /**
             * One entry per real account when it is saved both as a CIPS and an IPS bank detail, keeping the one of the
             * payment's own type
             * @param {{type: string, bank: Object, accountNumber: string}[]} accounts
             * @param {string} type CIPS or IPS
             */
            uniqueaccounts: function (accounts, type) {
                const byAccount = {}
                accounts.forEach(account => {
                    const key = `${account.bank.value}|${account.accountNumber}`
                    if (!byAccount[key] || (account.type === type && byAccount[key].type !== type)) {
                        byAccount[key] = account
                    }
                })
                return accounts.filter(account => byAccount[`${account.bank.value}|${account.accountNumber}`] === account)
            },
            /**
             * Which of the given entities are employees
             * @param {string[]} entityids
             * @returns {Set<string>} internal ids of the employees among them
             */
            getemployeeids: function (entityids) {
                const employees = new Set()
                if (entityids.length === 0) {
                    return employees
                }
                search.create({
                    type: search.Type.EMPLOYEE,
                    filters: [['internalid', 'anyof', entityids]]
                }).run().each(result => {
                    employees.add(String(result.id))
                    return true
                })
                return employees
            },
            /**
             * Asks NCHL whether the account number and name match the bank's records
             * @param option
             * @param {string} option.bankId NCHL bank id
             * @param {string} option.accountNumber
             * @param {string} option.accountName
             * @returns {Object} NCHL answer; matchPercentate 100 means verified
             */
            verifyaccount: function (option) {
                const npiAuth = JSON.parse(this.generatetoken())
                const response = http.request({
                    method: http.Method.POST,
                    url: npiconf.HOST + '/api/validatebankaccount',
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + npiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: JSON.stringify({
                        bankId: option.bankId,
                        accountId: option.accountNumber,
                        accountName: option.accountName
                    })
                })
                if (response.code !== 200) {
                    throw error.create({
                        name: 'NCHL_VERIFY_ERROR',
                        message: 'NCHL account check failed with HTTP ' + response.code + ': ' + response.body
                    })
                }
                return JSON.parse(response.body)
            },
            getappid: function (entityid) {
                try {
                    const depProp = search.lookupFields({
                        type: search.Type.ENTITY,
                        id: entityid,
                        columns: ['custentity_rec_vendor_department']
                    })
                    if (depProp) {
                        log.debug({title: 'SRCH_APP_ID_RES', details: depProp})
                        const valueprop = JSON.parse(depProp.custentity_rec_vendor_department)
                        return valueprop.value
                    }
                } catch (e) {
                    log.error({title: 'FIND_APP_ID_ERROR', details: e})
                    return false
                }
            },
            /**
             *
             * @param option
             * @param {string} option.relrecord
             * @param {object} option.params
             */
            savenchltran: function (option) {
                log.debug('OPTION_PARAM', option)
                const nchltran = record.create({
                    type: 'customrecord_nchl_transaction'
                })
                const parentRecObj = JSON.parse(option.relrecord)
                nchltran.setValue({fieldId: 'name', value: 'to be generated'})
                nchltran.setValue({
                    fieldId: 'custrecord_rd_ns_record_type',
                    value: parentRecObj.type
                })
                nchltran.setValue({
                    fieldId: 'custrecord_nchl_tran_rel_record',
                    value: parentRecObj.id
                })
                nchltran.setValue({
                    fieldId: 'custrecord_nchl_tran_mode',
                    value: option.params.paymenttype === 'CIPS' ? '1' : '2'
                })
                nchltran.setValue({
                    fieldId: 'custrecord_nchl_tran_raw_detail',
                    value: JSON.stringify(option.params)
                })
                return nchltran.save()
            },
            /**
             * Sends one POST to NCHL and records it in the NCHL API Log of the NCHL transaction it belongs to.
             * Getting the access token is part of the call, so a failed login is logged as well.
             * @param {Object} option
             * @param {string|number} [option.nchltranid] NCHL transaction to log against; nothing is logged without it
             * @param {string} option.action what the request does, shown in the log
             * @param {string} option.path NCHL path after npiconfig.HOST
             * @param {Object} option.body request body
             * @param {string} [option.token] access token to reuse instead of requesting a new one
             * @param {string} [option.conn] 'BILLER' for the NPI Billers connection
             * @returns {http.ClientResponse}
             */
            callnchl: function (option) {
                const response = this.sendnchl(option)
                if (response.code === 401 && !option.token) {
                    // the cached access token was no longer accepted: get a fresh one and send once more
                    this.forgetaccesstoken(option.conn)
                    return this.sendnchl(option)
                }
                return response
            },
            /**
             * One attempt of callnchl, logged
             */
            sendnchl: function (option) {
                const request = {
                    url: connection(option.conn).HOST + option.path,
                    headers: {'content-type': 'application/json', 'accept': '*/*'},
                    body: JSON.stringify(option.body)
                }
                const started = Date.now()
                let response = null, failure = null
                try {
                    const token = option.token || JSON.parse(this.generatetoken(option.conn)).access_token
                    response = transport(request.url).request({
                        method: http.Method.POST,
                        url: request.url,
                        headers: Object.assign({'authorization': 'Bearer ' + token}, request.headers),
                        body: request.body
                    })
                    return response
                } catch (e) {
                    failure = e
                    throw e
                } finally {
                    this.writeapilog(option, request, response, failure, Date.now() - started)
                }
            },
            /**
             * Never throws: a log that cannot be saved must not stop a payment
             */
            writeapilog: function (option, request, response, failure, duration) {
                if (!option.nchltranid) {
                    return
                }
                // CLOBTEXT holds up to 1,000,000 characters
                const clob = text => {
                    let value = typeof text === 'string' ? text : JSON.stringify(text)
                    try {
                        value = JSON.stringify(JSON.parse(value), null, 2)
                    } catch (e) {
                        // not JSON: keep as received
                    }
                    return value && value.length > 999000 ? value.substring(0, 999000) + '\n[truncated]' : value
                }
                try {
                    const values = {
                        custrecord_lc_nchllog_tran: option.nchltranid,
                        custrecord_lc_nchllog_action: option.action,
                        custrecord_lc_nchllog_method: 'POST',
                        custrecord_lc_nchllog_url: request.url,
                        custrecord_lc_nchllog_duration: duration,
                        custrecord_lc_nchllog_request: clob(request.body),
                        // the access token itself is never stored
                        custrecord_lc_nchllog_req_headers: clob(Object.assign({'authorization': 'Bearer ***'}, request.headers))
                    }
                    if (response) {
                        values.custrecord_lc_nchllog_http_code = response.code
                        values.custrecord_lc_nchllog_response = clob(response.body)
                        values.custrecord_lc_nchllog_resp_headers = clob(response.headers)
                    }
                    if (failure) {
                        values.custrecord_lc_nchllog_error = clob(`${failure.name}: ${failure.message}\n` +
                            (Array.isArray(failure.stack) ? failure.stack.join('\n') : (failure.stack || '')))
                    }
                    const logRecord = record.create({type: 'customrecord_lc_nchl_api_log'})
                    Object.keys(values).forEach(fieldId => {
                        if (values[fieldId] !== undefined && values[fieldId] !== null && values[fieldId] !== '') {
                            logRecord.setValue({fieldId: fieldId, value: values[fieldId]})
                        }
                    })
                    logRecord.save()
                } catch (e) {
                    log.error('NCHL_API_LOG_NOT_SAVED', {nchltran: option.nchltranid, action: option.action, error: e.message})
                }
            },
            /**
             * Payment requests sent to NCHL for an NCHL transaction, oldest first (status checks left out)
             * @param {string|number} nchltranid
             * @returns {{action: string, created: string, code: string, request: string}[]}
             */
            getpaymentrequests: function (nchltranid) {
                const requests = []
                search.create({
                    type: 'customrecord_lc_nchl_api_log',
                    filters: [
                        ['custrecord_lc_nchllog_tran', 'anyof', nchltranid],
                        'AND',
                        ['custrecord_lc_nchllog_action', 'isnot', 'STATUS CHECK']
                    ],
                    columns: [search.createColumn({name: 'internalid', sort: search.Sort.ASC}), 'created',
                        'custrecord_lc_nchllog_action', 'custrecord_lc_nchllog_http_code', 'custrecord_lc_nchllog_request']
                }).run().each(result => {
                    requests.push({
                        action: result.getValue('custrecord_lc_nchllog_action'),
                        created: result.getValue('created'),
                        code: result.getValue('custrecord_lc_nchllog_http_code'),
                        request: result.getValue('custrecord_lc_nchllog_request')
                    })
                    return true
                })
                return requests
            },
            postipsbatch: function (nchltranid) {
                const nchltranrec = record.load({type: 'customrecord_nchl_transaction', id: nchltranid})
                const batch = JSON.parse(nchltranrec.getValue('custrecord_nchl_tran_batch'))
                const instruction = JSON.parse(nchltranrec.getValue('custrecord_nchl_tran_instruction'))
                const requestBody = {
                    nchlIpsBatchDetail: batch
                }
                const batchstr = `${batch.batchId},${batch.debtorAgent},${batch.debtorBranch},${batch.debtorAccount},${batch.batchAmount},${batch.batchCrncy},${batch.categoryPurpose}`
                let transtr
                if (instruction.length && instruction.length > 0) {
                    const transactionsString = []
                    instruction.forEach(instruction => {
                        const transtr = `${instruction.instructionId},${instruction.creditorAgent},${instruction.creditorBranch},${instruction.creditorAccount},${instruction.amount}`
                        transactionsString.push(transtr)
                    })
                    transtr = transactionsString.join(',')
                    requestBody.nchlIpsTransactionDetailList = instruction
                } else {
                    transtr = `${instruction.instructionId},${instruction.creditorAgent},${instruction.creditorBranch},${instruction.creditorAccount},${instruction.amount}`
                    requestBody.nchlIpsTransactionDetailList = [instruction]
                }
                //const transtr = `${instruction.instructionId},${instruction.creditorAgent},${instruction.creditorBranch},${instruction.creditorAccount},${instruction.amount}`
                requestBody.token = this.sigtoken({batchstr: batchstr, transtr: transtr})
                log.debug({title: 'POSTIPS_REQ_BODY', details: requestBody})
                try {
                    const response = this.callnchl({
                        nchltranid: nchltranid,
                        action: 'POST IPS BATCH',
                        path: '/api/postnchlipsbatch',
                        body: requestBody
                    })
                    log.debug({title: 'IPS_BATCH_RESONSE', details: response})
                    return response
                } catch (e) {
                    log.error({
                        title: 'NS_ERROR_FAILED_REQUEST',
                        details: e
                    })
                    return "NS_ERROR_FAILED_REQUEST"
                }
            },
            postcipsbatch: function (nchltranid) {
                const nchltranrec = record.load({type: 'customrecord_nchl_transaction', id: nchltranid})
                const batch = JSON.parse(nchltranrec.getValue('custrecord_nchl_tran_batch'))
                const instruction = JSON.parse(nchltranrec.getValue('custrecord_nchl_tran_instruction'))
                const batchstr = `${batch.batchId},${batch.debtorAgent},${batch.debtorBranch},${batch.debtorAccount},${batch.batchAmount},${batch.batchCrncy}`
                const requestBody = {
                    cipsBatchDetail: batch
                }
                let transtr
                if (instruction.length && instruction.length > 0) {
                    const transactionsString = []
                    instruction.forEach(instruction => {
                        const transtr = `${instruction.instructionId},${instruction.creditorAgent},${instruction.creditorBranch},${instruction.creditorAccount},${instruction.amount}`
                        transactionsString.push(transtr)
                    })
                    transtr = transactionsString.join(',')
                    requestBody.cipsTransactionDetailList = instruction
                } else {
                    transtr = `${instruction.instructionId},${instruction.creditorAgent},${instruction.creditorBranch},${instruction.creditorAccount},${instruction.amount}`
                    requestBody.cipsTransactionDetailList = [instruction]
                }
                requestBody.token = this.sigtoken({batchstr: batchstr, transtr: transtr})
                log.debug({title: 'POSTCIPS_REQ_BODY', details: requestBody})
                try {
                    const response = this.callnchl({
                        nchltranid: nchltranid,
                        action: 'POST CIPS BATCH',
                        path: '/api/postcipsbatch',
                        body: requestBody
                    })
                    log.debug({title: 'CIPS_BATCH_RESONSE', details: response})
                    return response
                } catch (e) {
                    log.error({
                        title: 'NS_ERROR_FAILED_REQUEST',
                        details: e
                    })
                    return "NS_ERROR_FAILED_REQUEST"
                }
                //return requestBody
            },
            getbankdetail: function (recordid) {
                return search.lookupFields({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: recordid,
                    columns: [
                        'custrecord_rdnchl_bank_prop',
                        'custrecord_rdnchl_bank_branch_prop',
                        'custrecord_rdnchl_account_name',
                        'custrecord_rdnchl_account_number'
                    ]
                })
            },
            getappgroupid: function (appcode) {
                try {
                    const npiAuth = JSON.parse(this.generatetoken())
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + '/billers/v2/appjourneydetails',
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + npiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: JSON.stringify({appCode: appcode})
                    })
                    //log.debug('billerresponse',response)
                    const responseBody = JSON.parse(response.body)
                    return responseBody.appGroup
                } catch (e) {
                    log.error({
                        title: 'ERROR_NPI',
                        details: e
                    })
                    return null
                }
            },
            /**
             * A biller's form definition (fields, labels, mandatory flags) as NCHL's app journey describes it
             * @param {string} appCode e.g. GON-6-RBB-FDRL (IRD)
             */
            getappjourney: function (appCode) {
                const response = this.callnchl({path: '/billers/v2/appjourneydetails', body: {appCode: appCode}})
                return JSON.parse(response.body)
            },
            getdocofficelist: function (appid) {
                try {
                    const npiAuth = JSON.parse(this.generatetoken())
                    const appGroupId = this.getappgroupid(appid)
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + '/billers/v2/detail/dropdown-list',
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + npiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: JSON.stringify({
                            "fieldName": "appId",
                            "appGroup": appGroupId
                        })
                    })
                    const responseBody = JSON.parse(response.body)
                    return responseBody.data
                } catch (e) {
                    log.error({
                        title: 'ERROR_GET_DOC_OFFICE_LIST',
                        details: e
                    })
                    return []
                }
            },
            /**
             *
             * @param option
             * @param {string} option.batchstr
             * @param {string} option.transtr
             * @param {string} [option.conn] 'BILLER' for the NPI Billers connection (its user and certificate)
             * @returns {string} token
             */
            sigtoken: function (option) {
                const conn = option.conn === 'BILLER' ? govbillers.NPI : npiconf
                const tokenString = option.batchstr + ',' + option.transtr + ',' + conn.USERID
                const signer = certificate.createSigner({
                    certId: conn.CERTIFICATE_ID,
                    algorithm: certificate.HashAlg.SHA256
                })
                signer.update(tokenString)
                return signer.sign()
            },
            getdocdetail: function (params) {
                const batch = {
                    "batchId": params.batchid,
                    "batchAmount": 0,
                    "batchCount": 1,
                    "batchCrncy": "NPR",
                    "categoryPurpose": params.purpose,
                    "debtorAgent": params.drbank,
                    "debtorBranch": params.drbankbranch,
                    "debtorName": params.draccountname,
                    "debtorAccount": params.draccount,
                    "debtorIdType": "0001",
                    "debtorIdValue": "123456",
                    "debtorAddress": "Kathmandu Nepal",
                    "debtorPhone": "+977-01-4255306",
                    "debtorMobile": "+977-9841011688",
                    "debtorEmail": "test@test.com"
                }
                const instruction = {
                    "instructionId": params.batchid + "-INSTR-1",
                    "endToEndId": params.etoeid,
                    "amount": 0
                }
                let transtr
                if (params.appId) {
                    instruction.appId = params.appId
                    instruction.refId = params.refId
                    instruction.addenda3 = params.addenda3
                    instruction.freeText1 = params.freeText1
                    instruction.freeText2 = params.freeText2
                    instruction.freeCode1 = params.freeCode1
                    instruction.freeCode2 = params.freeCode2
                    transtr = `${instruction.instructionId},${instruction.appId},${instruction.refId}`
                    const requestBody = {
                        "cipsBatchDetail": batch,
                        cipsTransactionDetail: instruction
                    }
                    const batchstr = `${batch.batchId},${batch.debtorAgent},${batch.debtorBranch},${batch.debtorAccount},${batch.batchAmount},${batch.batchCrncy}`
                    requestBody.token = this.sigtoken({batchstr: batchstr, transtr: transtr})
                    log.debug('NECAS_DETAIL_POST_BODY', requestBody)
                    try {
                        const npiAuth = JSON.parse(this.generatetoken())
                        const response = http.request({
                            method: http.Method.POST,
                            url: npiconf.HOST + '/api/tp/necas/detail',
                            headers: {
                                'content-type': 'application/json',
                                'authorization': 'Bearer ' + npiAuth.access_token,
                                'accept': '*/*'
                            },
                            body: JSON.stringify(requestBody)
                        })
                        log.debug({title: 'NECAS_DETAIL_RESPONSE', details: response})
                        return JSON.parse(response.body)
                    } catch (e) {
                        log.error({
                            title: 'NECAS_DETAIL_RESPONSE_ERROR',
                            details: e
                        })
                        return "NS_ERROR_FAILED_REQUEST"
                    }
                } else {
                    return "APP ID not found"
                }
            },
            processbill: function (option) {
                const nchlTranRecord = record.load({
                    type: 'customrecord_nchl_transaction',
                    id: option.nchltranrecid
                })
                const batch = JSON.parse(nchlTranRecord.getValue('custrecord_nchl_tran_batch'))
                const instruction = JSON.parse(nchlTranRecord.getValue('custrecord_nchl_tran_instruction'))
                const batchstr = `${batch.batchId},${batch.debtorAgent},${batch.debtorBranch},${batch.debtorAccount},${batch.batchAmount},${batch.batchCrncy}`
                const transtr = `${instruction.instructionId},${instruction.appId},${instruction.refId}`
                const signedToken = this.sigtoken({batchstr: batchstr, transtr: transtr})
                const requestBody = {
                    cipsBatchDetail: batch,
                    cipsTransactionDetail: instruction,
                    token: signedToken
                }
                log.debug('REQ_BODY', requestBody)
                // custrecord_nchl_tran_mode is set by savenchltran: '1' = CIPS (real time), '2' = IPS
                const isRealTime = nchlTranRecord.getValue('custrecord_nchl_tran_mode') === '1'
                const preApiUri = isRealTime ? '/api/billpayment/' : '/api/ips/billpayment/'
                const apiUrl = option.reqtype === 'lodge' ? 'lodgebillpay.do' : 'confirmbillpay.do'
                const response = this.callnchl({
                    nchltranid: option.nchltranrecid,
                    action: option.reqtype === 'lodge' ? 'BILL LODGE' : 'BILL CONFIRM',
                    path: preApiUri + apiUrl,
                    body: requestBody
                })
                log.debug({title: option.reqtype + '_RESPONSE', details: response})
                return JSON.parse(response.body)
            },
            /**
             * Pays a bill confirmed in the NPI Billers iframe (spec v2, 4.7): the npiObject's batch with our bank as
             * debtor and its transaction, signed with the NPI certificate; sent with NCHL's NPI Billers login
             * @param {string|number} nchltranid NCHL transaction holding the batch and instruction
             * @returns {Object} NCHL's response
             */
            confirmbillerpay: function (nchltranid) {
                const nchlTranRecord = record.load({type: 'customrecord_nchl_transaction', id: nchltranid})
                const batch = JSON.parse(nchlTranRecord.getValue('custrecord_nchl_tran_batch'))
                const instruction = JSON.parse(nchlTranRecord.getValue('custrecord_nchl_tran_instruction'))
                const batchstr = `${batch.batchId},${batch.debtorAgent},${batch.debtorBranch},${batch.debtorAccount},${batch.batchAmount},${batch.batchCrncy}`
                const transtr = `${instruction.id},${instruction.instructionId},${instruction.endToEndId},${instruction.appId},${instruction.refId},${instruction.amount}`
                const response = this.callnchl({
                    nchltranid: nchltranid,
                    conn: 'BILLER',
                    action: 'BILLER CONFIRM',
                    path: '/api/npibiller/confirmbillerpay.do',
                    body: {
                        cipsBatchDetail: batch,
                        cipsTransactionDetail: instruction,
                        token: this.sigtoken({batchstr: batchstr, transtr: transtr, conn: 'BILLER'})
                    }
                })
                return JSON.parse(response.body)
            },
            updaterelrecord: function (option) {
                return record.submitFields({
                    type: option.type,
                    id: option.id,
                    values: option.values
                })
            },
            getcoabankdetail: function (coaid, bankType) {
                const relatedBankField = bankType === 'CIPS' ? 'custrecord_rdnchl_coa_bank_detail' : 'custrecord_ips_bank'
                const coaBank = search.lookupFields({
                    type: search.Type.ACCOUNT,
                    id: coaid,
                    columns: ['custrecord_rdnchl_coa_bank_detail', 'custrecord_ips_bank']
                })
                log.debug('COABANK', coaBank)
                let linkedBank = coaBank[relatedBankField]
                if (bankType === 'IPS' && (!linkedBank || linkedBank.length === 0)) {
                    // a non real time payment can use the account's CIPS bank detail (same bank codes on both lists)
                    linkedBank = coaBank.custrecord_rdnchl_coa_bank_detail
                }
                if (!linkedBank || linkedBank.length === 0) {
                    throw error.create({
                        name: 'NCHL_COA_BANK_MISSING',
                        message: 'GL account ' + coaid + ' has no ' + bankType + ' NCHL bank detail linked (' + relatedBankField + ')'
                    })
                }
                const bankRecordId = linkedBank[0].value
                return search.lookupFields({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: bankRecordId,
                    columns: [
                        'custrecord_nchl_bank_type',
                        'custrecord_rdnchl_bank_prop',
                        'custrecord_rdnchl_bank_branch_prop',
                        'custrecord_rdnchl_account_name',
                        'custrecord_rdnchl_account_number'
                    ]
                })
            },
            /**
             *
             * @param option
             * @param {string} option.batchid
             * @param {string} option.token
             * @returns {ClientResponse}
             */
            getipstrandetail: function (option) {
                return this.gettrandetail(option, '/api/getnchlipstxnlistbybatchid', 'IPS_TRAN_DET_RESP')
            },
            /**
             * Status of a CIPS (real time) batch
             * @param option
             * @param {string} option.batchid
             * @param {string} option.token
             * @returns {ClientResponse}
             */
            getcipstrandetail: function (option) {
                return this.gettrandetail(option, '/api/getcipstxnlistbybatchid', 'CIPS_TRAN_DET_RESP')
            },
            gettrandetail: function (option, uri, logTitle) {
                const response = this.callnchl({
                    nchltranid: option.nchltranid,
                    action: 'STATUS CHECK',
                    path: uri,
                    body: {batchId: option.batchid},
                    token: option.token,
                    conn: option.conn
                })
                log.debug(logTitle, response)
                return response
            },
            /**
             * Asks NCHL for the settlement status of a CIPS (real time) or IPS (non real time) transfer, saves it
             * on the NCHL transaction record and marks the related record paid once every credit is settled.
             * Only a failed debit counts as FAILED; any other unsettled credit stays IN-PROGRESS so a
             * second payment remains blocked until someone checks with the bank.
             * Bill payments (IRD / DOC) have their own lodge/confirm result and are not refreshed here; bills paid
             * through the NPI Billers iframe are, with NCHL's batch id and the NPI Billers login.
             * @param {string|number} nchltranid
             * @param {string} [token] NPI access token to reuse
             * @returns {{status: string, message: string, detail: Object}|null} null when not refreshable
             */
            refreshtranstatus: function (nchltranid, token) {
                const tran = search.lookupFields({
                    type: 'customrecord_nchl_transaction',
                    id: nchltranid,
                    columns: ['custrecord_nchl_tran_mode', 'custrecord_nchl_tran_batch', 'custrecord_nchl_tran_response',
                        'custrecord_nchl_tran_rel_record', 'custrecord_rd_ns_record_type', 'custrecord_nchl_tran_raw_detail']
                })
                const mode = tran.custrecord_nchl_tran_mode.length ? tran.custrecord_nchl_tran_mode[0].value : ''
                const isIframeBill = /"npiobject"/.test(tran.custrecord_nchl_tran_raw_detail || '')
                const isBillPayment = /"responseResult"/.test(tran.custrecord_nchl_tran_response || '') && !isIframeBill
                if ((mode !== '1' && mode !== '2') || isBillPayment) {
                    return null
                }
                const isRealTime = mode === '1'
                const batch = JSON.parse(tran.custrecord_nchl_tran_batch || '{}')
                // the iframe bill's batch was posted with the NPI Billers login, so it is looked up with it (own token)
                const detailOption = isIframeBill
                    ? {batchid: batch.batchId, conn: 'BILLER', nchltranid: nchltranid}
                    : {batchid: batch.batchId, token: token, nchltranid: nchltranid}
                const response = isRealTime ? this.getcipstrandetail(detailOption) : this.getipstrandetail(detailOption)
                if (response.code !== 200) {
                    throw error.create({
                        name: 'NCHL_STATUS_ERROR',
                        message: 'NCHL status request for ' + batch.batchId + ' failed with HTTP ' + response.code + ': ' + response.body
                    })
                }
                const detail = JSON.parse(response.body)
                const lines = (isRealTime ? detail.cipsTransactionDetailList : detail.nchlIpsTransactionDetailList) || []
                const debitFailed = !!detail.debitStatus && detail.debitStatus !== '000'
                const savedStatus = this.gettranstatus(tran.custrecord_nchl_tran_response).status
                // NCHL returns the batch whenever it has it, even unfinished (debit ENTR), and an empty list when it
                // has no batch with this id at all: then the payment never reached NCHL and nothing was debited.
                // Trusted only an hour after the payment, so a batch NCHL is still creating is not taken for a
                // missing one. Seen on the CIPS lookup only; IPS keeps the old rule.
                const noBatch = Array.isArray(detail) ? detail.length === 0 : !detail.batchId
                if (isRealTime && noBatch && savedStatus !== 'SUCCESS' && this.gettranagehours(nchltranid) >= 1) {
                    let original = tran.custrecord_nchl_tran_response
                    try {
                        original = JSON.parse(original || '{}').originalResponse || original
                    } catch (e) {
                        // not JSON (a connection error): keep it as saved
                    }
                    const noBatchMessage = 'NCHL has no record of batch ' + batch.batchId + ', so nothing was debited.'
                    const failedText = JSON.stringify({
                        cipsBatchResponse: {responseCode: 'NOBATCH', responseMessage: noBatchMessage, batchId: batch.batchId},
                        cipsTxnResponseList: [],
                        statusCheck: {checkedAt: new Date().toISOString(), nchlAnswer: detail},
                        originalResponse: original
                    })
                    record.submitFields({
                        type: 'customrecord_nchl_transaction',
                        id: nchltranid,
                        values: {custrecord_nchl_tran_response: failedText}
                    })
                    log.audit('NCHL_STATUS_REFRESHED', {nchltran: nchltranid, batchId: batch.batchId, status: 'FAILED', reason: 'no batch at NCHL'})
                    return {status: 'FAILED', message: noBatchMessage, detail: detail}
                }
                if (!debitFailed && lines.length === 0) {
                    return {
                        status: savedStatus,
                        message: savedStatus === 'FAILED'
                            ? 'NCHL has no transaction for this batch: it was rejected, so nothing was paid.'
                            : 'NCHL has no transaction for this batch yet.',
                        detail: detail
                    }
                }
                let previous = {}
                try {
                    previous = JSON.parse(tran.custrecord_nchl_tran_response || '{}')
                } catch (e) {
                    previous = {}
                }
                // stored in the same shape as a CIPS response so gettranstatus and the record view understand it
                const normalized = {
                    cipsBatchResponse: {
                        responseCode: debitFailed ? detail.debitStatus : '000',
                        responseMessage: detail.debitReasonDesc,
                        batchId: detail.batchId,
                        debitStatus: detail.debitStatus
                    },
                    cipsTxnResponseList: lines.map(line => {
                        // NCHL reports progress with ISO 20022 codes (SENT, ACTC, ...); 000 / ACSC = settlement completed,
                        // a bill also counts as paid with the biller's own credit statuses (DEFER, ...)
                        const settled = line.creditStatus === '000' || line.creditStatus === 'ACSC' ||
                            (isIframeBill && govbillers.PAID_CREDIT_STATUSES.includes(line.creditStatus))
                        const reason = line.reasonDesc || line.reasonCode
                        // no credit status yet: the debit itself is still open at NCHL (ENTR = entered, 999 = timed out)
                        const pendingText = line.creditStatus ? 'NCHL credit status ' + line.creditStatus
                            : 'NCHL debit status ' + (detail.debitStatus || 'not set') + ' - not final, confirm with NCHL before paying again'
                        return {
                            responseCode: debitFailed ? detail.debitStatus : (settled ? '000' : 'ENTR'),
                            creditStatus: settled ? '000' : line.creditStatus,
                            nchlCreditStatus: line.creditStatus,
                            instructionId: line.instructionId,
                            responseMessage: settled ? 'SETTLED' : pendingText +
                                (reason ? ': ' + reason : '') + (line.reversalStatus ? ' (reversal ' + line.reversalStatus + ')' : '')
                        }
                    }),
                    statusCheck: {checkedAt: new Date().toISOString(), settlementDate: detail.settlementDate},
                    originalResponse: previous.originalResponse || tran.custrecord_nchl_tran_response
                }
                const responseText = JSON.stringify(normalized)
                record.submitFields({
                    type: 'customrecord_nchl_transaction',
                    id: nchltranid,
                    values: {custrecord_nchl_tran_response: responseText}
                })
                const tranStatus = this.gettranstatus(responseText)
                if (tranStatus.status === 'SUCCESS' && tran.custrecord_nchl_tran_rel_record.length) {
                    try {
                        record.submitFields({
                            type: tran.custrecord_rd_ns_record_type,
                            id: tran.custrecord_nchl_tran_rel_record[0].value,
                            values: {custbody_rdnchl_paid_online: true}
                        })
                    } catch (e) {
                        // paid online is not applied to journals and contra vouchers; their NCHL transaction blocks a second payment
                        log.audit('PAID_FLAG_NOT_SET', {nchltran: nchltranid, error: e.message})
                    }
                }
                log.audit('NCHL_STATUS_REFRESHED', {nchltran: nchltranid, batchId: batch.batchId, status: tranStatus.status})
                return {status: tranStatus.status, message: tranStatus.message, detail: detail}
            },
            /**
             * The logged-in employee has the Administrator role. Read from the employee record, not user.role: some
             * deployments run as Administrator, which could report that role for every user.
             * @returns {boolean}
             */
            isadmin: function () {
                const user = runtime.getCurrentUser()
                if (!(Number(user.id) > 0)) {
                    return false
                }
                return search.create({
                    type: search.Type.EMPLOYEE,
                    filters: [['internalid', 'anyof', user.id], 'AND', ['role', 'anyof', '3']]
                }).runPaged().count > 0
            },
            /**
             * Our own payment code updates records from these contexts (status, Paid Online); anything else is a person
             * (the UI, CSV import, web services)
             * @returns {boolean}
             */
            isscripted: function () {
                const types = runtime.ContextType
                return [types.SUITELET, types.SCHEDULED, types.USER_EVENT, types.MAP_REDUCE].includes(runtime.executionContext)
            },
            /**
             * User event guard for a vendor payment, prepayment, journal or contra paid through NCHL (an NCHL transaction
             * that succeeded, is in progress or unknown, or Paid Online ticked): nobody may edit or delete it, a mistake
             * is corrected with a reversing entry. Our payment scripts may still update it. Throws when not allowed.
             * @param {Object} context beforeLoad or beforeSubmit context
             */
            guardpaidrecord: function (context) {
                const types = context.UserEventType
                if (![types.EDIT, types.XEDIT, types.DELETE].includes(context.type)) {
                    return
                }
                if (context.type !== types.DELETE && this.isscripted()) {
                    return
                }
                const lock = this.getpaidlock(context.oldRecord || context.newRecord)
                if (lock) {
                    // a plain message: NetSuite shows a thrown SuiteScriptError as raw JSON with its stack
                    throw lock
                }
            },
            /**
             * @param {record.Record} rec vendor payment, prepayment, journal or contra
             * @returns {string|null} why the record is locked (paid through NCHL), or null
             */
            getpaidlock: function (rec) {
                if (!rec || !rec.id) {
                    return null
                }
                const active = this.getactivenchltran(rec.id)
                if (!active && !rec.getValue('custbody_rdnchl_paid_online')) {
                    return null
                }
                return 'This record was paid through NCHL' + (active ? ` (${active.name}, ${active.status})` : '') +
                    ' and cannot be edited or deleted. Correct it with a reversing entry.'
            },
            /**
             * Hides the standard Edit button of a locked record's view page (the guards still block the edit)
             */
            hideeditbutton: function (form) {
                try {
                    form.removeButton({id: 'edit'})
                } catch (e) {
                    // not every form has a removable Edit button
                }
            },
            NOT_ALLOWED: 'You are not allowed to make NCHL payments. An Administrator can add you to Allowed Payers ' +
                'in NCHL Payment Settings. Nothing was paid.',
            /**
             * Who may pay through NCHL: Administrators always, anyone else only when listed in Allowed Payers of an
             * active NCHL Payment Settings record (no record or an empty list: Administrators only). Checked by every
             * Pay Online button and again by every payment page, so a page opened by its link cannot pay either.
             * @returns {boolean}
             */
            canpay: function () {
                const user = runtime.getCurrentUser()
                if (this.isadmin()) {
                    return true
                }
                let allowed = false
                search.create({
                    type: 'customrecord_lc_nchl_pay_settings',
                    filters: [['isinactive', 'is', 'F']],
                    columns: ['custrecord_lc_nchlset_payers']
                }).run().each(result => {
                    allowed = String(result.getValue('custrecord_lc_nchlset_payers') || '').split(',').includes(String(user.id))
                    return !allowed
                })
                return allowed
            },
            /**
             * @param {string|number} nchltranid
             * @returns {number} hours since the NCHL transaction was created (worked out by NetSuite, so no date
             * format or time zone is involved)
             */
            gettranagehours: function (nchltranid) {
                let hours = 0
                search.create({
                    type: 'customrecord_nchl_transaction',
                    filters: [['internalid', 'anyof', nchltranid]],
                    columns: [search.createColumn({name: 'formulanumeric', formula: '({now} - {created}) * 24'})]
                }).run().each(result => {
                    hours = parseFloat(result.getValue(result.columns[0])) || 0
                    return false
                })
                return hours
            },
            /**
             * Classifies a saved NCHL response (custrecord_nchl_tran_response)
             * @param {string} responseText
             * @returns {{status: string, message: string, lineMessages: string[]}} status is SUCCESS, FAILED, IN-PROGRESS or UNKNOWN
             */
            gettranstatus: function (responseText) {
                const result = {status: 'UNKNOWN', message: '', lineMessages: []}
                if (!responseText) {
                    return result
                }
                let resp
                try {
                    resp = JSON.parse(responseText)
                } catch (e) {
                    result.message = responseText
                    return result
                }
                if (resp.hasOwnProperty('responseResult')) { //for biller transaction
                    const batchDetail = resp.cipsBatchDetail || resp.nchlIpsBatchDetail || {}
                    const tranDetail = resp.cipsTransactionDetail || resp.nchlIpsTransactionDetail || {}
                    const fieldErrors = (resp.responseResult.fieldErrors || []).map(fe => fe.message).filter(Boolean)
                    result.message = fieldErrors.length > 0 ? fieldErrors.join('<br/>') : resp.responseResult.responseDescription
                    if (['999', 'ENTR'].includes(batchDetail.debitStatus)) {
                        // no final answer on the debit yet, even when the response code says failed (NCHL answered
                        // E999 FAILED with debitStatus 999): the money may still move, so it must not be paid again
                        result.status = 'IN-PROGRESS'
                        result.message = (batchDetail.debitReasonDesc || 'Debit status ' + batchDetail.debitStatus) +
                            ' - not final, confirm with NCHL before paying again'
                    } else if (resp.responseResult.responseCode !== '000') {
                        result.status = 'FAILED'
                    } else if (batchDetail.debitStatus && batchDetail.debitStatus !== '000') {
                        result.status = 'FAILED'
                        result.message = batchDetail.debitReasonDesc || 'Debit status ' + batchDetail.debitStatus
                    } else if (!tranDetail.creditStatus || govbillers.PAID_CREDIT_STATUSES.includes(tranDetail.creditStatus)) {
                        result.status = 'SUCCESS'
                    } else {
                        result.status = 'IN-PROGRESS'
                        result.message = tranDetail.reasonDesc || 'Credit status ' + tranDetail.creditStatus
                    }
                } else if (resp.hasOwnProperty('cipsBatchResponse')) {
                    const lines = resp.cipsTxnResponseList || []
                    result.lineMessages = lines.map(line => line.responseMessage)
                    const batchSuccess = resp.cipsBatchResponse.responseCode === '000'
                    const allCreditsSuccess = lines.length > 0 && lines.every(line =>
                        line.responseCode === '000' && (line.creditStatus === undefined || line.creditStatus === '000'))
                    // ENTR = queued; 999 = NCHL timed out after the debit ("CONFIRM WITH BANK BEFORE RE-POSTING")
                    const pendingCodes = ['ENTR', '999']
                    const inProgress = lines.some(line => pendingCodes.includes(line.responseCode) || pendingCodes.includes(line.creditStatus))
                    if (batchSuccess && allCreditsSuccess) {
                        result.status = 'SUCCESS'
                    } else if (inProgress) {
                        result.status = 'IN-PROGRESS'
                        result.message = result.lineMessages.join('<br/>')
                    } else {
                        result.status = 'FAILED'
                        result.message = resp.cipsBatchResponse.responseMessage
                    }
                } else if (resp.hasOwnProperty('responseCode') && resp.hasOwnProperty('responseDescription')) {
                    if (resp.responseCode !== '000' || resp.fieldErrors) {
                        result.status = 'FAILED'
                        result.message = resp.fieldErrors && resp.fieldErrors.length > 0
                            ? resp.fieldErrors.map(fielderr => fielderr.message).join('<br/>')
                            : resp.responseDescription
                    }
                } else if (resp.hasOwnProperty('responseCode') && resp.hasOwnProperty('responseMessage')) {
                    // NCHL refused the request itself (e.g. E001 INVALID IP ADDRESS): nothing was processed.
                    // 999 (timeout) and E999 (NCHL's general error, HTTP 500) do not say whether the debit happened,
                    // so they stay UNKNOWN and block another payment until NCHL confirms.
                    result.message = resp.responseMessage
                    if (resp.responseCode !== '000' && !['999', 'E999'].includes(resp.responseCode)) {
                        result.status = 'FAILED'
                    }
                }
                return result
            },
            /**
             * Status shown in the NCHL transaction list, worked out the same way as on the record page
             * @param {string} responseText custrecord_nchl_tran_response
             * @param {string} rawDetail custrecord_nchl_tran_raw_detail
             * @returns {string} SUCCESS, FAILED, IN-PROGRESS, UNKNOWN, NOT PAID (bill fetched only) or NOT POSTED
             */
            getstatuslabel: function (responseText, rawDetail) {
                if (responseText) {
                    return this.gettranstatus(responseText).status
                }
                return this.isbillnotpaid(rawDetail) ? 'NOT PAID' : 'NOT POSTED'
            },
            /**
             * A government bill that was only fetched (lodged) or chosen in the NPI Billers iframe (REVIEWED), never
             * confirmed: neither moves money
             * @param {string} rawDetail custrecord_nchl_tran_raw_detail
             */
            isbillnotpaid: function (rawDetail) {
                try {
                    const stage = JSON.parse(rawDetail || '{}').stage
                    return ['LODGING', 'LODGED', 'REVIEWED'].includes(stage)
                } catch (e) {
                    return false
                }
            },
            /**
             * Finds an earlier NCHL transaction for the same NetSuite record that has not definitely failed.
             * Used to block a second payment while the first one succeeded, is in progress or has an unknown result.
             * @param {string|number} relrecordid internal id of the vendor payment / prepayment / journal
             * @returns {{id: string, name: string, status: string}|null}
             */
            getactivenchltran: function (relrecordid) {
                let active = null
                search.create({
                    type: 'customrecord_nchl_transaction',
                    filters: [
                        ['custrecord_nchl_tran_rel_record', 'anyof', relrecordid],
                        'AND',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: ['name']
                }).run().each(result => {
                    const saved = search.lookupFields({
                        type: 'customrecord_nchl_transaction',
                        id: result.id,
                        columns: ['custrecord_nchl_tran_response', 'custrecord_nchl_tran_raw_detail']
                    })
                    if (!saved.custrecord_nchl_tran_response && this.isbillnotpaid(saved.custrecord_nchl_tran_raw_detail)) {
                        return true
                    }
                    const tranStatus = this.gettranstatus(saved.custrecord_nchl_tran_response)
                    if (tranStatus.status !== 'FAILED') {
                        active = {id: result.id, name: result.getValue('name'), status: tranStatus.status}
                        return false
                    }
                    return true
                })
                return active
            }
        }
    })