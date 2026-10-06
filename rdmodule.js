/**
 * @NApiVersion 2.1
 */
define(['N/http', 'N/encode', './npiconfig', 'N/cache', 'N/search', 'N/record', 'N/crypto/certificate', 'N/error'],
    function (http, encode, npiconf, cache, search, record, certificate, error) {

        return {
            generatetoken: function () {
                try {
                    // Basic auth requires standard base64; the URL-safe alphabet changes '+' and '/'
                    const b64basic = encode.convert({
                        string: npiconf.USERNAME + ':' + npiconf.PASSWORD,
                        inputEncoding: encode.Encoding.UTF_8,
                        outputEncoding: encode.Encoding.BASE_64
                    })
                    const reqHeaders = {
                        "Authorization": 'Basic ' + b64basic,
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                    const postBody = {
                        "grant_type": "password",
                        "username": npiconf.USERID,
                        "password": npiconf.USERPASS
                    }
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + '/oauth/token',
                        headers: reqHeaders,
                        body: postBody
                    })
                    if (response.code !== 200) {
                        throw error.create({
                            name: 'NPI_TOKEN_ERROR',
                            message: 'NPI token request failed with HTTP ' + response.code + ': ' + response.body
                        })
                    }
                    return response.body
                } catch (e) {
                    log.error({
                        title: 'GEN_TOKEN_FN_ERROR',
                        details: e
                    })
                    throw e
                }
            },
            getbanklist: function (option) {
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
            getbankbranchlist: function (option) {
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
            verifyaccount: function (option) {

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
                    const npiAuth = JSON.parse(this.generatetoken())
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + '/api/postnchlipsbatch',
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + npiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: JSON.stringify(requestBody)
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
                    const npiAuth = JSON.parse(this.generatetoken())
                    const response = http.request({
                        method: http.Method.POST,
                        url: npiconf.HOST + '/api/postcipsbatch',
                        headers: {
                            'content-type': 'application/json',
                            'authorization': 'Bearer ' + npiAuth.access_token,
                            'accept': '*/*'
                        },
                        body: JSON.stringify(requestBody)
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
             * @returns {string} token
             */
            sigtoken: function (option) {
                const tokenString = option.batchstr + ',' + option.transtr + ',' + npiconf.USERID
                const signer = certificate.createSigner({
                    certId: npiconf.CERTIFICATE_ID,
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
                const url = npiconf.HOST + preApiUri + apiUrl
                const npiAuth = JSON.parse(this.generatetoken())
                const response = http.request({
                    method: http.Method.POST,
                    url: url,
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + npiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: JSON.stringify(requestBody)
                })
                log.debug({title: option.reqtype + '_RESPONSE', details: response})
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
                    columns: [relatedBankField]
                })
                log.debug('COABANK', coaBank)
                const linkedBank = coaBank[relatedBankField]
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
                const npiAuth = option.token ? {access_token: option.token} : JSON.parse(this.generatetoken())
                const url = npiconf.HOST + '/api/getnchlipstxnlistbybatchid'
                const response = http.request({
                    method: http.Method.POST,
                    url: url,
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + npiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: JSON.stringify({
                        batchId: option.batchid
                    })
                })
                log.debug('IPS_TRAN_DET_RESP', response)
                return response
            },
            /**
             * Asks NCHL for the settlement status of an IPS (non real time) transaction, saves it on the
             * NCHL transaction record and marks the related record paid once every credit is settled.
             * Only a failed debit counts as FAILED; any other unsettled credit stays IN-PROGRESS so a
             * second payment remains blocked until someone checks with the bank.
             * @param {string|number} nchltranid
             * @param {string} [token] NPI access token to reuse
             * @returns {{status: string, message: string, detail: Object}|null} null when not an IPS transaction
             */
            refreshipsstatus: function (nchltranid, token) {
                const tran = search.lookupFields({
                    type: 'customrecord_nchl_transaction',
                    id: nchltranid,
                    columns: ['custrecord_nchl_tran_mode', 'custrecord_nchl_tran_batch', 'custrecord_nchl_tran_response',
                        'custrecord_nchl_tran_rel_record', 'custrecord_rd_ns_record_type']
                })
                const mode = tran.custrecord_nchl_tran_mode.length ? tran.custrecord_nchl_tran_mode[0].value : ''
                if (mode !== '2') {
                    return null
                }
                const batch = JSON.parse(tran.custrecord_nchl_tran_batch || '{}')
                const response = this.getipstrandetail({batchid: batch.batchId, token: token})
                if (response.code !== 200) {
                    throw error.create({
                        name: 'NCHL_IPS_STATUS_ERROR',
                        message: 'NCHL status request for ' + batch.batchId + ' failed with HTTP ' + response.code + ': ' + response.body
                    })
                }
                const detail = JSON.parse(response.body)
                const lines = detail.nchlIpsTransactionDetailList || []
                const debitFailed = !!detail.debitStatus && detail.debitStatus !== '000'
                if (!debitFailed && lines.length === 0) {
                    return {status: this.gettranstatus(tran.custrecord_nchl_tran_response).status, message: 'NCHL returned no transactions yet', detail: detail}
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
                        // NCHL reports progress with ISO 20022 codes (SENT, ACTC, ...); 000 / ACSC = settlement completed
                        const settled = line.creditStatus === '000' || line.creditStatus === 'ACSC'
                        const reason = line.reasonDesc || line.reasonCode
                        return {
                            responseCode: debitFailed ? detail.debitStatus : (settled ? '000' : 'ENTR'),
                            creditStatus: settled ? '000' : line.creditStatus,
                            nchlCreditStatus: line.creditStatus,
                            instructionId: line.instructionId,
                            responseMessage: settled ? 'SETTLED' : 'NCHL IPS credit status ' + line.creditStatus +
                                (reason ? ': ' + reason : '') + (line.reversalStatus ? ' (reversal ' + line.reversalStatus + ')' : '')
                        }
                    }),
                    ipsStatusCheck: {checkedAt: new Date().toISOString(), settlementDate: detail.settlementDate},
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
                    record.submitFields({
                        type: tran.custrecord_rd_ns_record_type,
                        id: tran.custrecord_nchl_tran_rel_record[0].value,
                        values: {custbody_rdnchl_paid_online: true}
                    })
                }
                log.audit('IPS_STATUS_REFRESHED', {nchltran: nchltranid, batchId: batch.batchId, status: tranStatus.status})
                return {status: tranStatus.status, message: tranStatus.message, detail: detail}
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
                    result.status = resp.responseResult.responseCode === '000' ? 'SUCCESS' : 'FAILED'
                    result.message = resp.responseResult.responseDescription
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
                }
                return result
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
                        columns: ['custrecord_nchl_tran_response']
                    })
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