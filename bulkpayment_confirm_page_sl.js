/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/ui/message', 'N/redirect'], function (serverWidget, record, rdmod, message, redirect) {
    /**
     * Reads debtor and creditor bank details from the journal. Used on GET to build the page and on POST so the
     * amounts and bank accounts sent to NCHL come from the journal, not from the submitted form.
     * @param {record.Record} paymentRecord
     */
    function getjournalpayment(paymentRecord) {
        const pmtType = paymentRecord.getValue('custbody_nchl_payment_type')
        const lineCount = paymentRecord.getLineCount({sublistId: 'line'})
        let debtorBankDetails = '', debtorMissing = false, creditTotal = 0, messageText = ''
        const creditLines = []
        for (let i = 0; i < lineCount; i++) {
            const debit = paymentRecord.getSublistValue({sublistId: 'line', fieldId: 'debit', line: i})
            const credit = paymentRecord.getSublistValue({sublistId: 'line', fieldId: 'credit', line: i})
            const bankRecord = paymentRecord.getSublistValue({
                sublistId: 'line',
                fieldId: 'custcol_col_entity_bank',
                line: i
            })
            if (debit) {
                const coaId = paymentRecord.getSublistValue({
                    sublistId: 'line',
                    fieldId: 'account',
                    line: i
                })
                log.debug('COA_ID', coaId)
                if (coaId) {
                    const bankType = pmtType === '1' ? 'CIPS' : 'IPS'
                    debtorBankDetails = rdmod.getcoabankdetail(coaId, bankType)
                    log.debug('COA_BANk', debtorBankDetails)
                } else {
                    debtorMissing = true
                }
            }
            if (!bankRecord && credit) {
                messageText += `line ${i + 1} doesn't have bank account selected\n`
            } else if (bankRecord && credit) {
                const lineMemo = paymentRecord.getSublistValue({
                    sublistId: 'line',
                    fieldId: 'memo',
                    line: i
                })
                const bankDetails = rdmod.getbankdetail(bankRecord)
                bankDetails.amount = credit
                bankDetails.linememo = lineMemo ? lineMemo : 'empty'
                creditLines.push(bankDetails)
                creditTotal += parseFloat(credit)
            }
        }
        return {pmtType, debtorBankDetails, debtorMissing, creditLines, creditTotal, messageText}
    }

    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Bulk Payment'})
            if (context.request.method === 'GET') {
                try {
                    const paymentRecord = record.load({
                        type: context.request.parameters.recordtype,
                        id: context.request.parameters.recordid
                    })
                    const activeTran = rdmod.getactivenchltran(context.request.parameters.recordid)
                    if (paymentRecord.getValue('custbody_rdnchl_paid_online') || activeTran) {
                        form.addPageInitMessage({
                            message: message.create({
                                type: message.Type.WARNING,
                                title: 'Payment already submitted',
                                message: activeTran
                                    ? `NCHL transaction ${activeTran.name} for this journal is ${activeTran.status}. Check its status instead of paying again.`
                                    : 'This journal is already marked as paid online.'
                            })
                        })
                        context.response.writePage({pageObject: form})
                        return
                    }
                    const journalPayment = getjournalpayment(paymentRecord)
                    const pmtType = journalPayment.pmtType
                    const paymentTypeField = form.addField({
                        id: 'custpage_payment_type',
                        label: 'Payment Type',
                        type: serverWidget.FieldType.SELECT
                    })
                    paymentTypeField.addSelectOption({value: 'CIPS', text: 'Real-Time', isSelected: pmtType === '1'})
                    paymentTypeField.addSelectOption({value: 'IPS', text: 'Non-Real-Time', isSelected: pmtType === '2'})
                    paymentTypeField.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                    const debtorBankField = form.addField({
                        id: 'custpage_dr_bank',
                        label: 'Bank',
                        type: serverWidget.FieldType.SELECT
                    })
                    let messageBox = {}
                    const {debtorBankDetails, creditLines, creditTotal, messageText} = journalPayment
                    if (journalPayment.debtorMissing) {
                        messageBox = {
                            type: message.Type.ERROR,
                            message: 'Debtor Bank Detail not available'
                        }
                    }
                    const formSublist = form.addSublist({
                        id: 'batch_transaction',
                        label: 'Batch Transaction',
                        type: serverWidget.SublistType.LIST
                    })
                    form.addField({
                        id: 'custpage_relrecord',
                        label: 'related record',
                        type: serverWidget.FieldType.TEXT
                    })
                        .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                        .defaultValue = JSON.stringify({
                        type: context.request.parameters.recordtype,
                        id: context.request.parameters.recordid
                    })
                    formSublist.addField({
                        id: 'custpage_selected',
                        label: 'select',
                        type: serverWidget.FieldType.CHECKBOX
                    })
                        .updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                        .defaultValue = 'T'
                    const bankField = formSublist.addField({
                        id: 'custpage_bank',
                        label: 'Bank',
                        type: serverWidget.FieldType.SELECT
                    })
                    const bankBranchField = formSublist.addField({
                        id: 'custpage_branch',
                        label: 'Bank Branch',
                        type: serverWidget.FieldType.SELECT
                    })
                    formSublist.addField({
                        id: 'custpage_ac_name',
                        label: 'Account Name',
                        type: serverWidget.FieldType.TEXT
                    })
                    formSublist.addField({
                        id: 'custpage_ac_number',
                        label: 'Account Number',
                        type: serverWidget.FieldType.TEXT
                    })
                    formSublist.addField({
                        id: 'custpage_linememo',
                        label: 'line memo',
                        type: serverWidget.FieldType.TEXT
                    })
                    formSublist.addField({
                        id: 'custpage_amount',
                        label: 'Amount',
                        type: serverWidget.FieldType.CURRENCY
                    })
                    if (messageText) {
                        messageBox = {
                            type: message.Type.ERROR,
                            message: messageText
                        }
                    }
                    //log.debug('DEBTOR_BANK_DETAIL', debtorBankDetails.custrecord_rdnchl_bank_prop)
                    debtorBankField.addSelectOption(JSON.parse(debtorBankDetails.custrecord_rdnchl_bank_prop))
                    const drBankBranchField = form.addField({
                        id: 'custpage_dr_bank_branch',
                        label: 'Bank Branch',
                        type: serverWidget.FieldType.SELECT
                    })
                    drBankBranchField.addSelectOption(JSON.parse(debtorBankDetails.custrecord_rdnchl_bank_branch_prop))
                    form.addField({
                        id: 'custpage_dr_bank_ac_name',
                        label: 'Account Name',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = debtorBankDetails.custrecord_rdnchl_account_name
                    form.addField({
                        id: 'custpage_dr_bank_ac_number',
                        label: 'Account Number',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = debtorBankDetails.custrecord_rdnchl_account_number
                    form.addField({
                        id: 'custpage_category_purpose',
                        label: 'category purpose',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = 'CUST'
                    form.addField({
                        id: 'custpage_batch_amount',
                        label: 'total amount',
                        type: serverWidget.FieldType.CURRENCY
                    }).defaultValue = creditTotal
                    form.addField({
                        id: 'custpage_memo',
                        label: 'memo',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = paymentRecord.getValue('memo')
                    creditLines.forEach((creditLine, index) => {
                        const bankOption = JSON.parse(creditLine.custrecord_rdnchl_bank_prop)
                        const bankBranchOption = JSON.parse(creditLine.custrecord_rdnchl_bank_branch_prop)
                        bankField.addSelectOption(bankOption)
                        bankBranchField.addSelectOption(bankBranchOption)
                        formSublist.setSublistValue({
                            id: 'custpage_bank',
                            value: bankOption.value,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_branch',
                            value: bankBranchOption.value,
                            line: index
                        })
                        bankField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        bankBranchField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        formSublist.setSublistValue({
                            id: 'custpage_ac_name',
                            value: creditLine.custrecord_rdnchl_account_name,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_ac_number',
                            value: creditLine.custrecord_rdnchl_account_number,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_linememo',
                            value: creditLine.linememo === 'empty' ? paymentRecord.getValue('memo') + (index + 1) : creditLine.linememo,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_amount',
                            value: creditLine.amount,
                            line: index
                        })
                    })
                    form.addSubmitButton({label: 'Okay'})
                    //formSublist.setSublistValue({id: 'custpage_bank', line})
                    if (messageBox.hasOwnProperty('type') && messageBox.hasOwnProperty('message')) {
                        const msg = message.create(messageBox)
                        form.addPageInitMessage({message: msg})
                    } else {
                        form.addField({
                            id: 'devhtml',
                            label: 'devhtml',
                            type: serverWidget.FieldType.INLINEHTML
                        }).defaultValue = `<script>console.log('${messageBox}')</script>`
                    }
                } catch (e) {
                    log.error('GET_ERROR', e)
                }
            } else {
                try {
                    const requestParams = context.request
                    const relRecProp = JSON.parse(requestParams.parameters.custpage_relrecord)
                    // Re-check on submit: the form may have been opened twice or submitted twice
                    const activeTran = rdmod.getactivenchltran(relRecProp.id)
                    if (activeTran) {
                        redirect.toRecord({
                            type: 'customrecord_nchl_transaction',
                            id: activeTran.id
                        })
                        return
                    }
                    // Amounts and bank accounts are re-read from the journal; only memo and purpose come from the form
                    const journalPayment = getjournalpayment(record.load({type: relRecProp.type, id: relRecProp.id}))
                    if (journalPayment.debtorMissing || journalPayment.messageText || journalPayment.creditLines.length === 0) {
                        throw new Error(journalPayment.messageText || 'Debtor Bank Detail not available')
                    }
                    const debtor = journalPayment.debtorBankDetails
                    const paymentType = journalPayment.pmtType === '1' ? 'CIPS' : 'IPS'
                    const params = {
                        paymenttype: paymentType,
                        amount: journalPayment.creditTotal,
                        purpose: requestParams.parameters.custpage_category_purpose,
                        drbank: JSON.parse(debtor.custrecord_rdnchl_bank_prop).value,
                        drbankbranch: JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).value,
                        draccountname: debtor.custrecord_rdnchl_account_name,
                        draccount: debtor.custrecord_rdnchl_account_number,
                        remarks: requestParams.parameters.custpage_memo
                    }
                    params.instructions = journalPayment.creditLines.map((creditLine, x) => ({
                        crbank: JSON.parse(creditLine.custrecord_rdnchl_bank_prop).value,
                        crbankbranch: JSON.parse(creditLine.custrecord_rdnchl_bank_branch_prop).value,
                        craccountname: creditLine.custrecord_rdnchl_account_name,
                        craccount: creditLine.custrecord_rdnchl_account_number,
                        amount: creditLine.amount,
                        remarks: requestParams.getSublistValue({
                            group: 'batch_transaction',
                            name: 'custpage_linememo',
                            line: x
                        }) || creditLine.linememo
                    }))
                    const nchlTranRecord = rdmod.savenchltran({
                        relrecord: requestParams.parameters.custpage_relrecord,
                        params: params
                    })
                    if (nchlTranRecord) {
                        // post*batch returns a string when the request itself failed
                        const nchlResponse = paymentType === 'CIPS'
                            ? rdmod.postcipsbatch(nchlTranRecord)
                            : rdmod.postipsbatch(nchlTranRecord)
                        log.debug('POST_BATCH_RESP', nchlResponse)
                        const responseText = typeof nchlResponse === 'string' ? nchlResponse : nchlResponse.body
                        const tranRecord = rdmod.updaterelrecord({
                            type: 'customrecord_nchl_transaction',
                            id: nchlTranRecord,
                            values: {custrecord_nchl_tran_response: responseText}
                        })
                        log.debug('NCHL_TRAN_RECORD', `Record updated with response record id = ${tranRecord}`)
                        // Mark the journal (not the NCHL record) as paid, and only when NCHL confirmed every credit
                        if (rdmod.gettranstatus(responseText).status === 'SUCCESS') {
                            relRecProp.values = {custbody_rdnchl_paid_online: true}
                            rdmod.updaterelrecord(relRecProp)
                        }
                        redirect.toRecord({
                            type: 'customrecord_nchl_transaction',
                            id: nchlTranRecord
                        })
                    }

                    /*const response = rdmod.postcipsbatch('992')
                    log.debug('POSTCIPS_RESP', response)
                    form.addField({
                        id: 'custpage_dev_field',
                        label: 'dev field',
                        type: 'longtext'
                    }).defaultValue = JSON.stringify(requestParams)*/
                } catch (e) {
                    log.debug('POST_ERROR', e)
                    form.addPageInitMessage({
                        message: message.create({
                            type: message.Type.ERROR,
                            title: 'ERROR',
                            message: JSON.stringify(e)
                        })
                    })
                }
            }
            context.response.writePage({pageObject: form})
        }
    }
})