/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/ui/message', 'N/redirect', 'N/url', 'N/search'], function (serverWidget, record, rdmod, message, redirect, url, search) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'NCHL Transaction Detail'})
            // "Delete Failed Attempt" on the NCHL transaction: a confirmation page (GET), then the delete (POST) of an
            // attempt that debited nothing, back to its record, which can then be corrected and paid again
            if (context.request.parameters.deletetran === 'T' || context.request.parameters.custpage_deletetran) {
                const recid = context.request.parameters.recid || context.request.parameters.custpage_deletetran
                try {
                    if (!rdmod.canpay()) {
                        throw new Error(rdmod.NOT_ALLOWED)
                    }
                    if (context.request.method === 'GET') {
                        const tran = search.lookupFields({
                            type: 'customrecord_nchl_transaction',
                            id: recid,
                            columns: ['name', 'custrecord_nchl_tran_response', 'custrecord_nchl_tran_raw_detail', 'custrecord_nchl_tran_rel_record']
                        })
                        const status = rdmod.getstatuslabel(tran.custrecord_nchl_tran_response, tran.custrecord_nchl_tran_raw_detail)
                        if (!rdmod.DELETABLE_STATUSES.includes(status)) {
                            throw new Error(`${tran.name} is ${status}; only failed, unpaid or unsent attempts can be deleted.`)
                        }
                        const confirmForm = serverWidget.createForm({title: 'Delete Failed NCHL Attempt'})
                        confirmForm.addPageInitMessage({
                            message: message.create({
                                type: message.Type.WARNING,
                                title: 'Delete ' + tran.name + '?',
                                message: `Status ${status}: nothing was debited by this attempt. Deleting it removes the attempt and its ` +
                                    'API log. You can then correct the record and pay again.'
                            })
                        })
                        const show = (id, label, value) => {
                            confirmForm.addField({id: id, label: label, type: serverWidget.FieldType.TEXT})
                                .updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE}).defaultValue = value
                        }
                        show('custpage_name', 'NCHL Transaction', tran.name)
                        show('custpage_status', 'Status', status)
                        show('custpage_record', 'Record', tran.custrecord_nchl_tran_rel_record.length ? tran.custrecord_nchl_tran_rel_record[0].text : '')
                        confirmForm.addField({id: 'custpage_deletetran', label: 'id', type: serverWidget.FieldType.TEXT})
                            .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN}).defaultValue = recid
                        confirmForm.addSubmitButton({label: 'Delete Attempt'})
                        confirmForm.addButton({
                            id: 'custpage_cancel',
                            label: 'Cancel',
                            functionName: `(function () { window.location.href = '${url.resolveRecord({recordType: 'customrecord_nchl_transaction', recordId: recid})}' })`
                        })
                        context.response.writePage({pageObject: confirmForm})
                        return
                    }
                    const deleted = rdmod.deletenchltran(recid)
                    if (deleted.relRecordId) {
                        // NetSuite opens the right transaction type from the generic transaction link
                        redirect.redirect({url: '/app/accounting/transactions/transaction.nl?id=' + deleted.relRecordId})
                        return
                    }
                    form.addPageInitMessage({
                        message: message.create({type: message.Type.CONFIRMATION, title: 'Deleted', message: 'The NCHL attempt was deleted.'})
                    })
                } catch (e) {
                    log.error('NCHL_DELETE_FAILED', {recid: recid, error: e.message})
                    form.addPageInitMessage({
                        message: message.create({type: message.Type.ERROR, title: 'Not deleted', message: e.message})
                    })
                    form.addField({
                        id: 'custpage_back',
                        label: 'Back',
                        type: serverWidget.FieldType.INLINEHTML
                    }).defaultValue = '<a href="' + url.resolveRecord({recordType: 'customrecord_nchl_transaction', recordId: recid}) +
                        '">Back to NCHL transaction</a>'
                }
                context.response.writePage({pageObject: form})
                return
            }
            // "Check NCHL Status" on the NCHL transaction: refresh the status, then go back to the record,
            // whose view shows the new status banner and response
            if (context.request.parameters.resync === 'T') {
                const rectype = context.request.parameters.rectype
                const recid = context.request.parameters.recid
                try {
                    const refreshed = rdmod.refreshtranstatus(recid, context.request.parameters.token)
                    redirect.toRecord({
                        type: rectype,
                        id: recid,
                        parameters: {
                            nchlresync: refreshed ? refreshed.status : 'NOT SUPPORTED',
                            // the record escapes this text, so drop the <br/> separators gettranstatus puts between lines
                            nchlresyncmsg: refreshed ? (refreshed.message || '').replace(/<br\/>/g, '; ')
                                : 'NCHL has no status check for this payment type'
                        }
                    })
                } catch (e) {
                    log.error('NCHL_RESYNC_FAILED', {recid: recid, error: e.message})
                    form.addPageInitMessage({
                        message: message.create({
                            type: message.Type.ERROR,
                            title: 'NCHL status check failed',
                            message: e.message
                        })
                    })
                    form.addField({
                        id: 'custpage_back',
                        label: 'Back',
                        type: serverWidget.FieldType.INLINEHTML
                    }).defaultValue = '<a href="' + url.resolveRecord({recordType: rectype, recordId: recid}) +
                        '">Back to NCHL transaction</a>'
                    context.response.writePage({pageObject: form})
                }
                return
            }

            const tranRec = record.load({
                type: context.request.parameters.rectype,
                id: context.request.parameters.recid
            })
            const batch = JSON.parse(tranRec.getValue('custrecord_nchl_tran_batch'))
            // query NCHL and save the result on the NCHL transaction (and mark the payment paid once settled)
            const refreshed = rdmod.refreshtranstatus(context.request.parameters.recid, context.request.parameters.token)
            if (refreshed) {
                form.addPageInitMessage({
                    message: message.create({
                        type: refreshed.status === 'SUCCESS' ? message.Type.CONFIRMATION
                            : refreshed.status === 'FAILED' ? message.Type.ERROR : message.Type.INFORMATION,
                        title: refreshed.status,
                        message: refreshed.message || ''
                    })
                })
            }
            // CIPS (mode 1) batches are looked up on the CIPS endpoint, not the IPS one
            const isRealTime = tranRec.getValue('custrecord_nchl_tran_mode') === '1'
            const detailOption = {batchid: batch.batchId, token: context.request.parameters.token, nchltranid: tranRec.id}
            const detailResponse = refreshed ? null
                : isRealTime ? rdmod.getcipstrandetail(detailOption) : rdmod.getipstrandetail(detailOption)

            const instructionSublist = form.addSublist({
                id: 'instructions',
                label: 'instructions',
                type:  serverWidget.SublistType.LIST
            })
            instructionSublist.addField({
                id: 'custpage_ac_name',
                label: 'Account Name',
                type: serverWidget.FieldType.TEXT
            })
            instructionSublist.addField({
                id: 'custpage_ac_number',
                label: 'Account Number',
                type: serverWidget.FieldType.TEXT
            })
            instructionSublist.addField({
                id: 'custpage_amount',
                label: 'Amount',
                type: serverWidget.FieldType.TEXT
            })
            instructionSublist.addField({
                id: 'custpage_status',
                label: 'Status',
                type: serverWidget.FieldType.TEXT
            })
            const responseBody = refreshed ? refreshed.detail : JSON.parse(detailResponse.body)
            const lines = responseBody.nchlIpsTransactionDetailList || responseBody.cipsTransactionDetailList
                || Object.values(responseBody).find(value => Array.isArray(value)) || []
            lines.forEach((inst, line) => {
                instructionSublist.setSublistValue({
                    id: 'custpage_ac_name',
                    value: inst.creditorName,
                    line: line
                })
                instructionSublist.setSublistValue({
                    id: 'custpage_ac_number',
                    value: inst.creditorAccount,
                    line: line
                })
                instructionSublist.setSublistValue({
                    id: 'custpage_amount',
                    value: inst.amount,
                    line: line
                })
                instructionSublist.setSublistValue({
                    id: 'custpage_status',
                    value: inst.creditStatus,
                    line: line
                })
            })
            /*form.addField({
                id: 'custpgae_mt_dev',
                label: 'MT DEV',
                type: serverWidget.FieldType.LONGTEXT
            }).defaultValue = detailResponse.body*/
            context.response.writePage({pageObject: form})
        }
    }
})