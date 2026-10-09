/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/ui/message', 'N/redirect'], function (serverWidget, record, rdmod, message, redirect) {
    const CONTRA_TYPE = 'customtransaction_contra'
    // contra voucher status B = Approved, A = Pending Approval
    const APPROVED_STATUS = 'B'

    /**
     * Reads the contra voucher: the credit line is the paying (debtor) bank account, each debit line is a
     * receiving bank account. Used on GET to build the page and on POST so the amounts and bank accounts
     * sent to NCHL come from the voucher, not from the submitted form.
     * @param {record.Record} contraRecord
     */
    function getcontrapayment(contraRecord) {
        const pmtType = contraRecord.getValue('custbody_nchl_payment_type')
        const lineCount = contraRecord.getLineCount({sublistId: 'line'})
        let receivingLines = 0
        for (let i = 0; i < lineCount; i++) {
            if (contraRecord.getSublistValue({sublistId: 'line', fieldId: 'debit', line: i})) {
                receivingLines++
            }
        }
        // NCHL real time (CIPS) takes one payment per batch, so several receiving lines go as one non real time batch
        const batchOnly = receivingLines > 1
        const bankType = pmtType === '1' && !batchOnly ? 'CIPS' : 'IPS'
        let debtorBankDetails = null, creditTotal = 0
        const creditLines = [], problems = []
        for (let i = 0; i < lineCount; i++) {
            const debit = contraRecord.getSublistValue({sublistId: 'line', fieldId: 'debit', line: i})
            const credit = contraRecord.getSublistValue({sublistId: 'line', fieldId: 'credit', line: i})
            const coaId = contraRecord.getSublistValue({sublistId: 'line', fieldId: 'account', line: i})
            if (credit) {
                if (debtorBankDetails) {
                    problems.push(`line ${i + 1}: only one paying (credit) bank line is supported`)
                } else {
                    debtorBankDetails = rdmod.getcoabankdetail(coaId, bankType)
                }
            } else if (debit) {
                const bankDetails = rdmod.getcoabankdetail(coaId, bankType)
                bankDetails.amount = debit
                bankDetails.linememo = contraRecord.getSublistValue({sublistId: 'line', fieldId: 'memo', line: i}) || ''
                bankDetails.endtoendid = contraRecord.getSublistValue({sublistId: 'line', fieldId: 'custcol_nchl_endtoendid', line: i}) ||
                    `${contraRecord.getValue('tranid')}-${i + 1}`.replace(/\s/g, '')
                creditLines.push(bankDetails)
                creditTotal += parseFloat(debit)
            }
        }
        if (!debtorBankDetails) {
            problems.push('Debtor Bank Detail not available')
        }
        if (creditLines.length === 0) {
            problems.push('No receiving (debit) bank lines')
        }
        return {pmtType, bankType, batchOnly, debtorBankDetails, creditLines, creditTotal, problems}
    }

    function showmessage(form, type, title, text) {
        form.addPageInitMessage({message: message.create({type: type, title: title, message: text})})
    }

    // This page only pays contra vouchers, whatever record type the URL or the submitted form names
    function loadcontra(id) {
        return record.load({type: CONTRA_TYPE, id: id})
    }

    /**
     * Same conditions as the Pay Online button, checked again because this page can be opened or submitted directly
     * @returns {{title: string, message: string, activeTran: Object}|null} why the voucher cannot be paid
     */
    function getblockreason(contraRecord) {
        const activeTran = rdmod.getactivenchltran(contraRecord.id)
        if (activeTran) {
            return {
                title: 'Payment already submitted',
                message: `NCHL transaction ${activeTran.name} for this voucher is ${activeTran.status}. Check its status instead of paying again.`,
                activeTran: activeTran
            }
        }
        if (contraRecord.getValue('custbody_rdnchl_paid_online')) {
            return {title: 'Payment already submitted', message: 'This voucher is already marked as paid online.'}
        }
        if (contraRecord.getValue('transtatus') !== APPROVED_STATUS) {
            return {title: 'Not approved', message: 'Only approved vouchers can be paid online.'}
        }
        return null
    }

    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Payment Confirm'})
            if (context.request.method === 'GET') {
                try {
                    const contraRecord = loadcontra(context.request.parameters.recordid)
                    const blockReason = getblockreason(contraRecord)
                    if (blockReason) {
                        showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                        context.response.writePage({pageObject: form})
                        return
                    }
                    const contra = getcontrapayment(contraRecord)
                    if (contra.problems.length > 0) {
                        showmessage(form, message.Type.ERROR, 'Cannot pay this voucher online', contra.problems.join('<br/>'))
                        context.response.writePage({pageObject: form})
                        return
                    }
                    const debtor = contra.debtorBankDetails
                    const paymentTypeField = form.addField({
                        id: 'custpage_payment_type',
                        label: 'Payment Type',
                        type: serverWidget.FieldType.SELECT
                    })
                    paymentTypeField.addSelectOption({value: 'CIPS', text: 'Real-Time', isSelected: contra.bankType === 'CIPS'})
                    paymentTypeField.addSelectOption({value: 'IPS', text: 'Non-Real-Time', isSelected: contra.bankType === 'IPS'})
                    if (contra.batchOnly && contra.pmtType === '1') {
                        showmessage(form, message.Type.INFORMATION, 'Non-Real-Time batch',
                            `NCHL real-time payments carry one payment per batch, so the ${contra.creditLines.length} receiving ` +
                            'accounts are paid in one non-real-time batch. It settles later.')
                    }
                    paymentTypeField.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                    // inline select on the transaction list renders as a link to the voucher
                    const createdFromField = form.addField({
                        id: 'custpage_created_from',
                        label: 'Created From',
                        type: serverWidget.FieldType.SELECT,
                        source: 'transaction'
                    })
                    createdFromField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    createdFromField.defaultValue = contraRecord.id
                    form.addField({
                        id: 'custpage_dr_bank',
                        label: 'Bank',
                        type: serverWidget.FieldType.SELECT
                    }).addSelectOption(JSON.parse(debtor.custrecord_rdnchl_bank_prop))
                    form.addField({
                        id: 'custpage_dr_bank_branch',
                        label: 'Bank Branch',
                        type: serverWidget.FieldType.SELECT
                    }).addSelectOption(JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop))
                    form.addField({
                        id: 'custpage_dr_bank_ac_name',
                        label: 'Account Name',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = debtor.custrecord_rdnchl_account_name
                    form.addField({
                        id: 'custpage_dr_bank_ac_number',
                        label: 'Account Number',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = debtor.custrecord_rdnchl_account_number
                    const purposeField = form.addField({
                        id: 'custpage_category_purpose',
                        label: 'category purpose',
                        type: serverWidget.FieldType.SELECT
                    })
                    purposeField.isMandatory = true
                    Object.keys(rdmod.categorypurposes).forEach(code => purposeField.addSelectOption({
                        value: code,
                        text: `${code} - ${rdmod.categorypurposes[code]}`,
                        isSelected: code === 'CUST'
                    }))
                    form.addField({
                        id: 'custpage_batch_amount',
                        label: 'total amount',
                        type: serverWidget.FieldType.CURRENCY
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = contra.creditTotal
                    form.addField({
                        id: 'custpage_memo',
                        label: 'memo',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = contraRecord.getValue('memo')
                    form.addField({
                        id: 'custpage_relrecord',
                        label: 'related record',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                        .defaultValue = JSON.stringify({type: CONTRA_TYPE, id: contraRecord.id})
                    const formSublist = form.addSublist({
                        id: 'batch_transaction',
                        label: 'Batch Transaction',
                        type: serverWidget.SublistType.LIST
                    })
                    formSublist.addField({id: 'custpage_endtoendid', label: 'nchl memo', type: serverWidget.FieldType.TEXT})
                    const bankField = formSublist.addField({id: 'custpage_bank', label: 'Bank', type: serverWidget.FieldType.SELECT})
                    const bankBranchField = formSublist.addField({id: 'custpage_branch', label: 'Bank Branch', type: serverWidget.FieldType.SELECT})
                    formSublist.addField({id: 'custpage_ac_name', label: 'Account Name', type: serverWidget.FieldType.TEXT})
                    formSublist.addField({id: 'custpage_ac_number', label: 'Account Number', type: serverWidget.FieldType.TEXT})
                    formSublist.addField({id: 'custpage_linememo', label: 'line memo', type: serverWidget.FieldType.TEXT})
                    formSublist.addField({id: 'custpage_amount', label: 'Amount', type: serverWidget.FieldType.CURRENCY})
                    contra.creditLines.forEach((creditLine, index) => {
                        const bankOption = JSON.parse(creditLine.custrecord_rdnchl_bank_prop)
                        const bankBranchOption = JSON.parse(creditLine.custrecord_rdnchl_bank_branch_prop)
                        bankField.addSelectOption(bankOption)
                        bankBranchField.addSelectOption(bankBranchOption)
                        const setValue = (id, value) => {
                            if (value !== '' && value !== null && value !== undefined) {
                                formSublist.setSublistValue({id: id, value: value, line: index})
                            }
                        }
                        setValue('custpage_endtoendid', creditLine.endtoendid)
                        setValue('custpage_bank', bankOption.value)
                        setValue('custpage_branch', bankBranchOption.value)
                        setValue('custpage_ac_name', creditLine.custrecord_rdnchl_account_name)
                        setValue('custpage_ac_number', creditLine.custrecord_rdnchl_account_number)
                        setValue('custpage_linememo', creditLine.linememo)
                        setValue('custpage_amount', creditLine.amount)
                    })
                    bankField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    bankBranchField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    form.addSubmitButton({label: 'Make Payment'})
                } catch (e) {
                    log.error('GET_ERROR', e)
                    showmessage(form, message.Type.ERROR, 'ERROR', e.message || JSON.stringify(e))
                }
            } else {
                try {
                    const requestParams = context.request
                    const contraRecord = loadcontra(JSON.parse(requestParams.parameters.custpage_relrecord).id)
                    const relRecProp = {type: CONTRA_TYPE, id: contraRecord.id}
                    // Re-check on submit: the form may have been opened twice or submitted twice
                    const blockReason = getblockreason(contraRecord)
                    if (blockReason && blockReason.activeTran) {
                        redirect.toRecord({type: 'customrecord_nchl_transaction', id: blockReason.activeTran.id})
                        return
                    }
                    if (blockReason) {
                        throw new Error(blockReason.message)
                    }
                    // Amounts and bank accounts are re-read from the voucher; only purpose and NCHL memos come from the form
                    const contra = getcontrapayment(contraRecord)
                    if (contra.problems.length > 0) {
                        throw new Error(contra.problems.join('; '))
                    }
                    const debtor = contra.debtorBankDetails
                    const params = {
                        paymenttype: contra.bankType,
                        amount: contra.creditTotal,
                        purpose: rdmod.categorypurposes.hasOwnProperty(requestParams.parameters.custpage_category_purpose)
                            ? requestParams.parameters.custpage_category_purpose : 'CUST',
                        drbank: JSON.parse(debtor.custrecord_rdnchl_bank_prop).value,
                        drbankbranch: JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).value,
                        draccountname: debtor.custrecord_rdnchl_account_name,
                        draccount: debtor.custrecord_rdnchl_account_number,
                        remarks: requestParams.parameters.custpage_memo
                    }
                    const formValue = (name, line) => requestParams.getSublistValue({group: 'batch_transaction', name: name, line: line})
                    params.instructions = contra.creditLines.map((creditLine, x) => ({
                        endtoendid: formValue('custpage_endtoendid', x) || creditLine.endtoendid,
                        crbank: JSON.parse(creditLine.custrecord_rdnchl_bank_prop).value,
                        crbankbranch: JSON.parse(creditLine.custrecord_rdnchl_bank_branch_prop).value,
                        craccountname: creditLine.custrecord_rdnchl_account_name,
                        craccount: creditLine.custrecord_rdnchl_account_number,
                        amount: creditLine.amount,
                        remarks: formValue('custpage_linememo', x) || creditLine.linememo
                    }))
                    log.debug('INSTRUCTIONS', params.instructions)
                    const nchlTranRecord = rdmod.savenchltran({
                        relrecord: JSON.stringify(relRecProp),
                        params: params
                    })
                    if (nchlTranRecord) {
                        // post*batch returns a string when the request itself failed
                        const nchlResponse = contra.bankType === 'CIPS'
                            ? rdmod.postcipsbatch(nchlTranRecord)
                            : rdmod.postipsbatch(nchlTranRecord)
                        const responseText = typeof nchlResponse === 'string' ? nchlResponse : nchlResponse.body
                        rdmod.updaterelrecord({
                            type: 'customrecord_nchl_transaction',
                            id: nchlTranRecord,
                            values: {custrecord_nchl_tran_response: responseText}
                        })
                        if (rdmod.gettranstatus(responseText).status === 'SUCCESS') {
                            try {
                                relRecProp.values = {custbody_rdnchl_paid_online: true}
                                rdmod.updaterelrecord(relRecProp)
                            } catch (e) {
                                // the paid-online field may not be applied to contra vouchers; the NCHL
                                // transaction alone already blocks a second payment
                                log.audit('CONTRA_PAID_FLAG_NOT_SET', e.message)
                            }
                        }
                        redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranRecord})
                    }
                } catch (e) {
                    log.error('POST_ERROR', e)
                    showmessage(form, message.Type.ERROR, 'ERROR', e.message || JSON.stringify(e))
                }
            }
            context.response.writePage({pageObject: form})
        }
    }
})
