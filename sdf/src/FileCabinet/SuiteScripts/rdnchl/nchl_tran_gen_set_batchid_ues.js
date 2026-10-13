/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/config', './rdmodule', 'N/ui/message', 'N/url', 'N/runtime', 'N/search'], function (record, config, rdmodu, message, url, runtime, search) {
        /**
         * Keeps the stored Status (custrecord_lc_nchl_status, shown in the NCHL transaction list) in line with the
         * saved NCHL response. Its own update comes back here as xedit and stops because nothing changed.
         */
        /**
         * NCHL transactions are the payment audit trail: only the payment scripts create and update them, nobody
         * creates or edits them by hand, and only an attempt that debited nothing (failed, unpaid, unsent) is deleted
         */
        function guardaudittrail(context) {
            const types = context.UserEventType
            const byPerson = !rdmodu.isscripted()
            if (context.type === types.DELETE && rdmodu.isdeletable(context.oldRecord.getValue('custrecord_nchl_tran_response'),
                context.oldRecord.getValue('custrecord_nchl_tran_raw_detail'))) {
                // a failed, unpaid or unsent attempt debited nothing (Delete Failed Attempt on the record)
                return
            }
            if (context.type === types.DELETE || ([types.CREATE, types.COPY, types.EDIT, types.XEDIT].includes(context.type) && byPerson)) {
                // a plain message: NetSuite shows a thrown SuiteScriptError as raw JSON with its stack
                throw 'NCHL transactions are created and updated only by the NCHL payment scripts and cannot be ' +
                    'added or edited. Only a failed, unpaid or unsent attempt can be deleted (Delete Failed Attempt).'
            }
        }

        function updatestatus(recType, recId) {
            const saved = search.lookupFields({
                type: recType,
                id: recId,
                columns: ['custrecord_nchl_tran_response', 'custrecord_nchl_tran_raw_detail', 'custrecord_lc_nchl_status']
            })
            const status = rdmodu.getstatuslabel(saved.custrecord_nchl_tran_response, saved.custrecord_nchl_tran_raw_detail)
            if (status !== saved.custrecord_lc_nchl_status) {
                record.submitFields({type: recType, id: recId, values: {custrecord_lc_nchl_status: status}})
            }
        }

        return {
            beforeLoad: context => {
                guardaudittrail(context)
                if (context.type === 'view') {
                    const form = context.form
                    rdmodu.hideeditbutton(form)
                    const isRealTime = context.newRecord.getValue('custrecord_is_real_time')
                    const batch = JSON.parse(context.newRecord.getValue('custrecord_nchl_tran_batch') || '{}')
                    /*const instruction = JSON.parse(context.newRecord.getValue('custrecord_nchl_tran_instruction'))
                    const batchstr = `${batch.batchId},${batch.debtorAgent},${batch.debtorBranch},${batch.debtorAccount},${batch.batchAmount},${batch.batchCrncy}`
                    let transtr
                    if (instruction.appId) {
                        transtr = `${instruction.instructionId},${instruction.appId},${instruction.refId}`
                    } else {
                        transtr = `${instruction.instructionId},${instruction.creditorAgent},${instruction.creditorBranch},${instruction.creditorAccount},${instruction.amount}`
                    }
                    const cipsToken = rdmodu.sigtoken({batchstr: batchstr, transtr: transtr})
                    const ipsToken = rdmodu.sigtoken({batchstr: batchstr + ',' + batch.categoryPurpose, transtr: transtr})
                    const requestBody = {
                        isrealtime: isRealTime,
                        transaction: {
                            batch: batch,
                            instruction: instruction,
                            token: ipsToken
                        }
                    }*/
                    /*form.addButton({
                        id: 'custpage_get_transtat',
                        label: 'Check Status',
                        functionName: `console.log('${JSON.stringify(requestBody)}')`
                    })*/
                    const fnOpt = {
                        isrealtime: isRealTime,
                        batchid: batch.batchId
                    }
                    //form.clientScriptModulePath = './nchl_tran_client.js'
                    /*form.addButton({
                        id: 'custpage_get_transtat',
                        label: 'Check Status',
                        functionName: `gettranstatus('${JSON.stringify(fnOpt)}')`
                    })*/
                    let status = 'empty', showreason = false, reasonmsg = 'empty'
                    const tranresp = context.newRecord.getValue('custrecord_nchl_tran_response')
                    let msgType = message.Type.ERROR, msgTitle = 'ERROR', msgDetail = ''
                    if (tranresp) {
                        const tranStatus = rdmodu.gettranstatus(tranresp)
                        let isBiller = false
                        try {
                            isBiller = JSON.parse(tranresp).hasOwnProperty('responseResult')
                        } catch (e) {
                            // not JSON: the request to NCHL failed before a response was received
                        }
                        status = isBiller ? tranStatus.message : tranStatus.status
                        if (tranStatus.status === 'FAILED') {
                            showreason = true
                            reasonmsg = tranStatus.message
                            msgDetail = reasonmsg
                        } else if (tranStatus.status === 'IN-PROGRESS') {
                            showreason = true
                            reasonmsg = tranStatus.message
                            msgType = message.Type.INFORMATION
                            msgTitle = 'In Progress'
                            msgDetail = reasonmsg
                        } else if (tranStatus.status === 'SUCCESS') {
                            msgType = message.Type.CONFIRMATION
                            msgTitle = tranStatus.status
                        } else if (tranStatus.status === 'UNKNOWN') {
                            showreason = true
                            reasonmsg = 'Result not confirmed by NCHL. Check the status with NCHL before paying again. ' + tranStatus.message
                            msgType = message.Type.WARNING
                            msgTitle = 'Unknown'
                            msgDetail = reasonmsg
                        }
                        if (showreason) {
                            form.addField({
                                id: 'custpage_failed_reason',
                                label: 'reason',
                                type: 'textarea'
                            }).updateDisplayType({displayType: 'inline'})
                                .defaultValue = reasonmsg
                        }
                    } else if (!tranresp && rdmodu.isbillnotpaid(context.newRecord.getValue('custrecord_nchl_tran_raw_detail'))) {
                        // government payment page: the bill was fetched, Make Payment was not clicked
                        status = 'Bill fetched, not paid'
                        msgType = message.Type.INFORMATION
                        msgTitle = 'Not paid'
                        msgDetail = 'The bill was fetched from NCHL but not paid. Nothing was debited.'
                    } else if (!tranresp && status === 'empty') {
                        status = 'Not posted'
                        msgDetail = 'Unexpected error occurred'
                    }
                    // Resync only asks NCHL for the current status (rdmodule.refreshtranstatus); it never resends the
                    // payment, because a timed-out or failed-looking request may still have debited the account.
                    // Biller payments (IRD / DOC) have no status API, so they are left out. Bills paid through the NPI
                    // Billers iframe (raw detail holds the npiObject) carry NCHL's own batch id, which can be looked up.
                    const mode = context.newRecord.getValue('custrecord_nchl_tran_mode')
                    const isBillerResponse = /"responseResult"/.test(tranresp || '') &&
                        !/"npiobject"/.test(context.newRecord.getValue('custrecord_nchl_tran_raw_detail') || '')
                    const billNotPaid = !tranresp && rdmodu.isbillnotpaid(context.newRecord.getValue('custrecord_nchl_tran_raw_detail'))
                    if ((mode === '1' || mode === '2') && !isBillerResponse && !billNotPaid && status !== 'SUCCESS') {
                        const resyncLink = url.resolveScript({
                            scriptId: 'customscript_lc_get_nchl_tran_detail',
                            deploymentId: 'customdeploy_lc_get_nchl_tran_detail',
                            params: {
                                rectype: context.newRecord.type,
                                recid: context.newRecord.id,
                                resync: 'T'
                            }
                        })
                        form.addButton({
                            id: 'custpage_resync_nchl',
                            label: 'Resync with NCHL',
                            // NetSuite appends "()" to functionName, so pass a function rather than a statement
                            functionName: `(function () { window.location.href = '${resyncLink}' })`
                        })
                    }
                    // nothing was debited: whoever may pay can delete the attempt, correct the record and pay again
                    if (rdmodu.isdeletable(tranresp, context.newRecord.getValue('custrecord_nchl_tran_raw_detail')) && rdmodu.canpay()) {
                        const deleteLink = url.resolveScript({
                            scriptId: 'customscript_lc_get_nchl_tran_detail',
                            deploymentId: 'customdeploy_lc_get_nchl_tran_detail',
                            params: {recid: context.newRecord.id, deletetran: 'T'}
                        })
                        form.addButton({
                            id: 'custpage_delete_nchl',
                            label: 'Delete Failed Attempt',
                            functionName: `(function () { if (window.confirm('Delete this NCHL attempt? Nothing was paid by it. ' +
                                'You can then correct the record and pay again.')) { window.location.href = '${deleteLink}' } })`
                        })
                    }
                    form.addTab({id: 'custpage_nchl_response_tab', label: 'NCHL Response'})
                    let prettyResponse = tranresp || 'No response received from NCHL'
                    try {
                        prettyResponse = JSON.stringify(JSON.parse(tranresp), null, 2)
                    } catch (e) {
                        // not JSON (e.g. a connection error message): show it as saved
                    }
                    const escapedResponse = prettyResponse.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    form.addField({
                        id: 'custpage_nchl_response_json',
                        label: 'NCHL Response',
                        type: 'inlinehtml',
                        container: 'custpage_nchl_response_tab'
                    }).defaultValue = '<pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;' +
                        'background:#f6f8fa;border:1px solid #d0d7de;padding:10px;max-height:600px;overflow:auto">' +
                        escapedResponse + '</pre>'
                    form.addTab({id: 'custpage_nchl_request_tab', label: 'NCHL Request'})
                    const escapeJson = text => {
                        let pretty = text || ''
                        try {
                            pretty = JSON.stringify(JSON.parse(text), null, 2)
                        } catch (e) {
                            // not JSON: show as saved
                        }
                        return pretty.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    }
                    const preStyle = 'white-space:pre-wrap;word-break:break-all;font-size:12px;' +
                        'background:#f6f8fa;border:1px solid #d0d7de;padding:10px;max-height:600px;overflow:auto'
                    // the exact bodies sent, from the NCHL API Log; status checks are only in the log table
                    const sentRequests = rdmodu.getpaymentrequests(context.newRecord.id)
                    let requestHtml = sentRequests.map(sent =>
                        `<p><b>${escapeJson(sent.action)}</b> - ${escapeJson(sent.created)} - HTTP ${escapeJson(sent.code || 'no response')}</p>` +
                        `<pre style="${preStyle}">${escapeJson(sent.request)}</pre>`).join('')
                    if (!requestHtml) {
                        // paid before the API log existed: show what was built for NCHL, without the signature token
                        const built = {
                            batch: JSON.parse(context.newRecord.getValue('custrecord_nchl_tran_batch') || '{}'),
                            instructions: JSON.parse(context.newRecord.getValue('custrecord_nchl_tran_instruction') || '[]')
                        }
                        requestHtml = '<p>The exact request (with its signature token) was not logged for this transaction. ' +
                            'Batch and instructions as built for NCHL:</p>' +
                            `<pre style="${preStyle}">${escapeJson(JSON.stringify(built))}</pre>`
                    }
                    form.addField({
                        id: 'custpage_nchl_request_json',
                        label: 'NCHL Request',
                        type: 'inlinehtml',
                        container: 'custpage_nchl_request_tab'
                    }).defaultValue = requestHtml
                    const showmessage = context.newRecord.getValue('custrecord_show_pageinit_msg')
                    // set by the resync Suitelet's redirect; both come from the URL, so escape before showing
                    const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    const resyncStatus = context.request && context.request.parameters.nchlresync
                    if (resyncStatus) {
                        form.addPageInitMessage({
                            message: message.create({
                                type: resyncStatus === 'SUCCESS' ? message.Type.CONFIRMATION
                                    : resyncStatus === 'FAILED' ? message.Type.ERROR : message.Type.INFORMATION,
                                title: 'Resynced with NCHL: ' + escapeHtml(resyncStatus),
                                message: escapeHtml(context.request.parameters.nchlresyncmsg || '')
                            })
                        })
                    } else if (showmessage) {
                        form.addPageInitMessage({
                            message: message.create({
                                type: msgType,
                                title: msgTitle,
                                message: msgDetail
                            })
                        })
                    }
                    form.addField({
                        id: 'custpage_status',
                        label: 'transaction status',
                        type: 'text'
                    }).defaultValue = status

                   /* record.submitFields({
                        type: context.newRecord.type,
                        id: context.newRecord.id,
                        values: {
                            custrecord_show_pageinit_msg: false
                        }
                    })*/
                }
            }
            ,
            beforeSubmit: context => guardaudittrail(context),
            afterSubmit: context => {
                if (context.type === 'create' || context.type === 'edit') {
                    /*const companyInformation = config.load({
                        type: config.Type.COMPANY_INFORMATION
                    })
                    const companyId = companyInformation.getValue('companyid')*/
                    const recordId = context.newRecord.id
                    const parentRecordId = context.newRecord.getValue('custrecord_nchl_tran_rel_record')
                    //const batchId = companyId + '-PR-' + parentRecordId + '-PMT-' + recordId
                    const batchId = 'PMT-' + parentRecordId + '-TRAN-' + recordId
                    const params = JSON.parse(context.newRecord.getValue('custrecord_nchl_tran_raw_detail'))
                    const batch = {
                        batchId: batchId,
                        batchAmount: typeof params.amount === 'string' ? parseFloat(params.amount) : params.amount,
                        batchCount: 1,
                        batchCrncy: "NPR",
                        categoryPurpose: params.purpose,
                        debtorAgent: params.drbank,
                        debtorBranch: params.drbankbranch,
                        debtorName: params.draccountname,
                        debtorAccount: params.draccount,
                        debtorIdType: "0001",
                        debtorIdValue: "123456",
                        debtorAddress: "Kathmandu Nepal",
                        debtorPhone: "+977-01-4255306",
                        debtorMobile: "+977-9841011688",
                        debtorEmail: "test@test.com"
                    }
                    let instruction = ''
                    const instructions = []
                    if (params.hasOwnProperty('instructions') && params.instructions.length > 0) {
                        params.instructions.forEach((instruction, i) => {
                            instructions.push({
                                instructionId: batchId + "-INSTR-" + (i + 1),
                                endToEndId: instruction.endtoendid,
                                creditorAgent: instruction.crbank,
                                creditorBranch: instruction.crbankbranch,
                                creditorName: instruction.craccountname,
                                creditorAccount: instruction.craccount,
                                amount: parseFloat(instruction.amount),
                                remarks: instruction.remarks
                            })
                        })
                        batch.batchCount = params.instructions.length
                    } else {
                        instruction = {
                            instructionId: batchId + "-INSTR-1",
                            endToEndId: params.endtoendid,
                            amount: typeof params.amount === 'string' ? parseFloat(params.amount) : params.amount,
                        }

                        if (params.hasOwnProperty('billerfields')) {
                            // government payment page (govpayment_confirm_page_sl.js): appId and the biller's bill fields
                            Object.assign(instruction, params.billerfields)
                        } else if (params.hasOwnProperty('billertype') && params.billertype === 'IRD') {
                            instruction.appId = params.appId
                            instruction.refId = params.refId
                            instruction.particulars = params.particulars
                        } else if (params.hasOwnProperty('billertype') && params.billertype === 'DOC') {
                            instruction.appId = params.appId
                            instruction.refId = params.refId
                            instruction.addenda3 = params.addenda3
                            instruction.freeText1 = params.freeText1
                            instruction.freeText2 = params.freeText2
                            instruction.freeCode1 = params.freeCode1
                            instruction.freeCode2 = params.freeCode2
                        } else {
                            instruction.creditorAgent = params.crbank
                            instruction.creditorBranch = params.crbankbranch
                            instruction.creditorName = params.craccountname
                            instruction.creditorAccount = params.craccount
                            instruction.remarks = params.remarks
                        }
                    }
                    params.batchId = batchId
                    let batchInstruction = instructions.length > 0 ? instructions : instruction
                    let savedBatch = batch
                    if (params.hasOwnProperty('npiobject')) {
                        // bill confirmed in the NPI Billers iframe: NCHL's own batch and transaction are paid as they
                        // are, only the debtor (our bank) is added (spec v2, 4.7)
                        savedBatch = Object.assign({}, params.npiobject.cipsBatchDetail, {
                            categoryPurpose: params.npiobject.cipsBatchDetail.categoryPurpose || params.purpose,
                            debtorAgent: params.drbank,
                            debtorBranch: params.drbankbranch,
                            debtorName: params.draccountname,
                            debtorAccount: params.draccount
                        })
                        batchInstruction = params.npiobject.cipsTransactionDetail
                    }
                    record.submitFields({
                        type: context.newRecord.type,
                        id: context.newRecord.id,
                        values: {
                            name: batchId,
                            custrecord_nchl_tran_batch: JSON.stringify(savedBatch),
                            custrecord_nchl_tran_instruction: JSON.stringify(batchInstruction)
                        }
                    })
                }
                if (context.type !== 'delete') {
                    updatestatus(context.newRecord.type, context.newRecord.id)
                }
            }
        }
    }
)