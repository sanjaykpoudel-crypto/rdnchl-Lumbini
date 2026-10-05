/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/config', './rdmodule', 'N/ui/message', 'N/url', 'N/runtime'], function (record, config, rdmodu, message, url, runtime) {
        return {
            beforeLoad: context => {
                if (context.type === 'view') {
                    const form = context.form
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
                        // IPS (mode '2') responses only confirm the batch was received, so let the user query settlement
                        const isIps = context.newRecord.getValue('custrecord_nchl_tran_mode') === '2'
                        if (status === 'IN-PROGRESS' || (status === 'UNKNOWN' && isIps)) {
                            /* form.addButton({
                                 id: 'custpage_reinitiate',
                                 label: 'Reinitiate',
                                 functionName: `reinitiatetran('${JSON.stringify(requestBody)}')`
                             })*/
                            const tranDetailLink = url.resolveScript({
                                scriptId: 'customscript_get_nchl_tran_detail',
                                deploymentId: 'customdeploy_get_nchl_tran_detail',
                                params: {
                                    rectype: context.newRecord.type,
                                    recid: context.newRecord.id
                                }
                            })
                            //form.clientScriptModulePath = './justfortoken.js'
                            form.addButton({
                                id: 'custpage_get_tran_det',
                                label: 'Status',
                                //functionName: `generatetoken('${tranDetailLink}')`
                                functionName: `window.open('${tranDetailLink}')`
                            })
                        }
                    } else if (!tranresp && status === 'empty') {
                        status = 'Not posted'
                        msgDetail = 'Unexpected error occurred'
                    }
                    const showmessage = context.newRecord.getValue('custrecord_show_pageinit_msg')
                    if (showmessage) {
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

                        if (params.hasOwnProperty('billertype') && params.billertype === 'IRD') {
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
                    const batchInstruction = instructions.length > 0 ? instructions : instruction
                    record.submitFields({
                        type: context.newRecord.type,
                        id: context.newRecord.id,
                        values: {
                            name: batchId,
                            custrecord_nchl_tran_batch: JSON.stringify(batch),
                            custrecord_nchl_tran_instruction: JSON.stringify(batchInstruction)
                        }
                    })
                }
            }
        }
    }
)