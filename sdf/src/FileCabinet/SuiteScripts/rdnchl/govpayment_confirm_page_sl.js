/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
// Pays a government bill (IRD, SSF, CIT) from an approved journal through NCHL billers, in two steps:
// Fetch Bill lodges it (NCHL and the biller check it and return its details, nothing is paid) and
// Make Payment confirms it. The journal's credit line is the paying bank; its amount must equal the bill.
define(['N/ui/serverWidget', 'N/record', 'N/search', 'N/ui/message', 'N/redirect', './rdmodule', './govbillers'],
    function (serverWidget, record, search, message, redirect, rdmod, gov) {
        const TITLE = 'Government Payment'
        const BILLER_FIELD = 'custbody_lc_nchl_gov_biller'
        // NCHL real-time (CIPS) limit for a payment to another bank
        const REAL_TIME_LIMIT = 2000000

        function showmessage(form, type, title, text) {
            form.addPageInitMessage({message: message.create({type: type, title: title, message: text})})
        }

        function addinline(form, option) {
            const field = form.addField(option)
            field.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
            return field
        }

        function addhidden(form, id, value) {
            form.addField({id: id, label: id, type: serverWidget.FieldType.LONGTEXT})
                .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                .defaultValue = value
        }

        function round(amount) {
            return Math.round((parseFloat(amount) || 0) * 100) / 100
        }

        /**
         * Same conditions as the Pay Online button, checked again because this page can be opened or submitted directly
         */
        function getblockreason(journal) {
            const activeTran = rdmod.getactivenchltran(journal.id)
            if (activeTran) {
                return {
                    title: 'Payment already submitted',
                    message: `NCHL transaction ${activeTran.name} for this journal is ${activeTran.status}. Check its status instead of paying again.`,
                    activeTran: activeTran
                }
            }
            if (journal.getValue('approvalstatus') !== '2') {
                return {title: 'Not approved', message: 'Only approved journals can be paid online.'}
            }
            return null
        }

        /**
         * Reads the biller, the paying bank and the amount from the journal, so what is sent to NCHL comes from
         * NetSuite and not from the submitted form
         * @param {record.Record} journal
         */
        function getgovpayment(journal) {
            const problems = []
            const billerKey = gov.getbillerkey(journal.getText(BILLER_FIELD))
            if (!billerKey) {
                problems.push('Choose the NCHL Government Payment (IRD, SSF or CIT) on the journal')
            }
            const lineValue = (fieldId, line) => journal.getSublistValue({sublistId: 'line', fieldId: fieldId, line: line})
            let debtorBank = null, amount = 0, creditLines = 0
            for (let i = 0; i < journal.getLineCount({sublistId: 'line'}); i++) {
                const credit = parseFloat(lineValue('credit', i)) || 0
                if (!credit) {
                    continue
                }
                creditLines++
                if (creditLines > 1) {
                    problems.push(`Line ${i + 1}: one journal pays one government bill from one bank (credit) line`)
                    continue
                }
                amount = round(credit)
                try {
                    debtorBank = rdmod.getcoabankdetail(lineValue('account', i), 'CIPS')
                } catch (e) {
                    problems.push(`Line ${i + 1}: ${e.message}`)
                }
            }
            if (creditLines === 0) {
                problems.push('No paying (credit) bank line')
            }
            if (amount > REAL_TIME_LIMIT) {
                problems.push(`The amount is above the NCHL real-time limit (${REAL_TIME_LIMIT}). Non-real-time government payments are not supported yet.`)
            }
            return {billerKey, biller: billerKey ? gov.BILLERS[billerKey] : null, debtorBank, amount, problems}
        }

        function adddetail(form, journal, payment) {
            form.addFieldGroup({id: 'primaryinformation', label: 'PRIMARY INFORMATION'})
            // inline select on the transaction list renders as a link to the journal
            addinline(form, {id: 'custpage_created_from', label: 'Created From', type: serverWidget.FieldType.SELECT, source: 'transaction', container: 'primaryinformation'})
                .defaultValue = journal.id
            addinline(form, {id: 'custpage_biller', label: 'Government Payment', type: serverWidget.FieldType.TEXT, container: 'primaryinformation'})
                .defaultValue = payment.biller ? payment.biller.label : journal.getText(BILLER_FIELD)
            addinline(form, {id: 'custpage_amount', label: 'Amount', type: serverWidget.FieldType.CURRENCY, container: 'primaryinformation'})
                .defaultValue = payment.amount
            addinline(form, {id: 'custpage_ptype', label: 'Payment Type', type: serverWidget.FieldType.TEXT, container: 'primaryinformation'})
                .defaultValue = 'Real-Time'

            form.addFieldGroup({id: 'debtor', label: 'DEBIT DETAIL'})
            const debtor = payment.debtorBank
            const debtorDetail = {
                custpage_dr_bank: ['Bank', debtor ? JSON.parse(debtor.custrecord_rdnchl_bank_prop).text : ''],
                custpage_dr_bank_branch: ['Bank Branch', debtor ? JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).text : ''],
                custpage_dr_bank_ac_name: ['Account Name', debtor ? debtor.custrecord_rdnchl_account_name : ''],
                custpage_dr_bank_ac_number: ['Account Number', debtor ? debtor.custrecord_rdnchl_account_number : '']
            }
            Object.keys(debtorDetail).forEach(fieldId => {
                addinline(form, {id: fieldId, label: debtorDetail[fieldId][0], type: serverWidget.FieldType.TEXT, container: 'debtor'})
                    .defaultValue = debtorDetail[fieldId][1]
            })
        }

        /**
         * Step 1: the bill reference fields of the journal's biller
         */
        function writebillform(context, journal) {
            const form = serverWidget.createForm({title: TITLE})
            const blockReason = getblockreason(journal)
            if (blockReason) {
                showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                return form
            }
            const payment = getgovpayment(journal)
            adddetail(form, journal, payment)
            if (payment.problems.length > 0) {
                showmessage(form, message.Type.ERROR, 'Cannot pay this journal', payment.problems.join('<br>'))
                return form
            }
            addhidden(form, 'custpage_journal', journal.id)
            addhidden(form, 'custpage_step', 'lodge')
            form.addFieldGroup({id: 'bill', label: 'BILL'})
            payment.biller.fields.forEach(billField => {
                const field = form.addField({id: 'custpage_bill_' + billField.id.toLowerCase(), label: billField.label, type: serverWidget.FieldType.TEXT, container: 'bill'})
                field.isMandatory = true
                field.maxLength = billField.maxLength
            })
            showmessage(form, message.Type.INFORMATION, 'Step 1 of 2',
                'Enter the bill reference and click Fetch Bill. NCHL checks the bill with ' + payment.billerKey + ' and shows it here; nothing is paid yet.')
            form.addSubmitButton({label: 'Fetch Bill'})
            return form
        }

        /**
         * NCHL's labels for the bill details it returns (app journey response field mapping)
         */
        function getresponselabels(appId) {
            try {
                const journey = rdmod.getappjourney(appId)
                const step = (journey.data || [])[0] || {}
                const labels = {}
                ;(step.responseFieldMapping || []).forEach(f => {
                    labels[f.fieldName] = f.fieldLabel
                })
                return labels
            } catch (e) {
                log.error('GOV_APP_JOURNEY_ERROR', e.message)
                return {}
            }
        }

        function readlodgeerror(lodge) {
            const result = lodge.responseResult || {}
            const fieldErrors = (result.fieldErrors || []).map(fe => fe.message).filter(Boolean)
            return fieldErrors.length > 0 ? fieldErrors.join('<br>') : (result.responseDescription || JSON.stringify(lodge))
        }

        function updateraw(nchlTranId, raw) {
            record.submitFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                values: {custrecord_nchl_tran_raw_detail: JSON.stringify(raw)}
            })
        }

        /**
         * Step 2: lodge the bill, show what NCHL returned and offer Make Payment when the amount matches the journal
         */
        function lodgebill(context, journal) {
            const request = context.request
            const form = serverWidget.createForm({title: TITLE})
            const blockReason = getblockreason(journal)
            if (blockReason && blockReason.activeTran) {
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: blockReason.activeTran.id})
                return null
            }
            if (blockReason) {
                showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                return form
            }
            const payment = getgovpayment(journal)
            adddetail(form, journal, payment)
            if (payment.problems.length > 0) {
                showmessage(form, message.Type.ERROR, 'Cannot pay this journal', payment.problems.join('<br>'))
                return form
            }
            const billerFields = {appId: payment.biller.appId}
            const missing = []
            payment.biller.fields.forEach(billField => {
                const value = String(request.parameters['custpage_bill_' + billField.id.toLowerCase()] || '').trim()
                if (!value) {
                    missing.push(billField.label)
                }
                billerFields[billField.id] = value.slice(0, billField.maxLength)
            })
            if (missing.length > 0) {
                showmessage(form, message.Type.ERROR, 'Missing bill details', missing.join(', '))
                return form
            }
            const debtor = payment.debtorBank
            const tranId = journal.getValue('tranid')
            const raw = {
                paymenttype: 'CIPS',
                // a biller that sets the amount is lodged with 0 and confirmed with the amount it returns
                amount: payment.biller.amountFromBiller ? 0 : payment.amount,
                purpose: gov.PURPOSE,
                drbank: JSON.parse(debtor.custrecord_rdnchl_bank_prop).value,
                drbankbranch: JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).value,
                draccountname: debtor.custrecord_rdnchl_account_name,
                draccount: debtor.custrecord_rdnchl_account_number,
                endtoendid: `JRN${tranId}-${payment.billerKey}`.replace(/\s/g, '').slice(0, 30),
                billertype: payment.billerKey,
                billerfields: billerFields,
                journalamount: payment.amount,
                // LODGING / LODGED: nothing paid yet, so getactivenchltran does not block another try
                stage: 'LODGING'
            }
            const nchlTranId = rdmod.savenchltran({relrecord: JSON.stringify({type: journal.type, id: journal.id}), params: raw})
            let lodge
            try {
                lodge = rdmod.processbill({nchltranrecid: nchlTranId, reqtype: 'lodge'})
            } catch (e) {
                log.error('GOV_LODGE_ERROR', e)
                showmessage(form, message.Type.ERROR, 'NCHL could not fetch the bill', e.message || String(e))
                return form
            }
            if (!lodge.responseResult || lodge.responseResult.responseCode !== '000') {
                // nothing was paid: saving the answer marks this NCHL transaction FAILED
                record.submitFields({
                    type: 'customrecord_nchl_transaction',
                    id: nchlTranId,
                    values: {custrecord_nchl_tran_response: JSON.stringify(lodge)}
                })
                showmessage(form, message.Type.ERROR, 'Bill not accepted', readlodgeerror(lodge))
                return form
            }
            const bill = lodge.cipsTransactionDetail || {}
            raw.stage = 'LODGED'
            raw.lodgeResponse = lodge
            updateraw(nchlTranId, raw)

            form.addFieldGroup({id: 'bill', label: 'BILL FROM ' + payment.billerKey})
            const labels = getresponselabels(payment.biller.appId)
            Object.keys(labels).forEach(fieldName => {
                const value = bill[fieldName]
                if (value !== null && value !== undefined && value !== '') {
                    addinline(form, {id: 'custpage_bill_' + fieldName.toLowerCase(), label: labels[fieldName], type: serverWidget.FieldType.TEXT, container: 'bill'})
                        .defaultValue = String(value)
                }
            })
            const billAmount = round(bill.amount)
            if (billAmount !== payment.amount) {
                showmessage(form, message.Type.ERROR, 'Amount does not match',
                    `The bill is ${billAmount}, the journal ${payment.amount}. Correct the journal (or the bill) and try again; nothing was paid.`)
                return form
            }
            addhidden(form, 'custpage_journal', journal.id)
            addhidden(form, 'custpage_nchltran', nchlTranId)
            addhidden(form, 'custpage_step', 'confirm')
            showmessage(form, message.Type.CONFIRMATION, 'Step 2 of 2',
                'NCHL accepted the bill. Check it and click Make Payment to pay ' + payment.amount + '.')
            form.addSubmitButton({label: 'Make Payment'})
            return form
        }

        /**
         * Step 3: confirm (pay) the lodged bill, once
         */
        function confirmbill(context, journal) {
            const request = context.request
            const form = serverWidget.createForm({title: TITLE})
            const nchlTranId = request.parameters.custpage_nchltran
            const tran = search.lookupFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                columns: ['custrecord_nchl_tran_rel_record', 'custrecord_nchl_tran_raw_detail', 'custrecord_nchl_tran_batch', 'custrecord_nchl_tran_instruction']
            })
            const relRecord = tran.custrecord_nchl_tran_rel_record.length ? String(tran.custrecord_nchl_tran_rel_record[0].value) : ''
            const raw = JSON.parse(tran.custrecord_nchl_tran_raw_detail || '{}')
            if (relRecord !== String(journal.id) || raw.stage !== 'LODGED') {
                // already confirmed (or being confirmed): show it instead of paying twice
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranId})
                return null
            }
            const blockReason = getblockreason(journal)
            if (blockReason && blockReason.activeTran) {
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: blockReason.activeTran.id})
                return null
            }
            if (blockReason) {
                showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
                return form
            }
            const payment = getgovpayment(journal)
            const bill = (raw.lodgeResponse && raw.lodgeResponse.cipsTransactionDetail) || {}
            const billAmount = round(bill.amount)
            if (payment.problems.length > 0 || billAmount !== payment.amount || payment.billerKey !== raw.billertype) {
                adddetail(form, journal, payment)
                showmessage(form, message.Type.ERROR, 'Journal changed', 'The journal no longer matches the fetched bill. Fetch the bill again.')
                return form
            }
            // confirm sends the lodged bill again with the amount from the bill
            const batch = JSON.parse(tran.custrecord_nchl_tran_batch)
            const instruction = JSON.parse(tran.custrecord_nchl_tran_instruction)
            batch.batchAmount = billAmount
            instruction.amount = billAmount
            raw.amount = billAmount
            // set before the request: if the answer is lost, the payment stays blocked until someone checks it
            raw.stage = 'CONFIRMING'
            record.submitFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                values: {
                    custrecord_nchl_tran_raw_detail: JSON.stringify(raw),
                    custrecord_nchl_tran_batch: JSON.stringify(batch),
                    custrecord_nchl_tran_instruction: JSON.stringify(instruction)
                }
            })
            let confirm
            try {
                confirm = rdmod.processbill({nchltranrecid: nchlTranId, reqtype: 'confirm'})
            } catch (e) {
                // no answer: the result is unknown, so the record stays blocked (UNKNOWN) instead of being retried
                log.error('GOV_CONFIRM_ERROR', e)
                redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranId})
                return null
            }
            raw.stage = 'CONFIRMED'
            record.submitFields({
                type: 'customrecord_nchl_transaction',
                id: nchlTranId,
                values: {
                    custrecord_nchl_tran_response: JSON.stringify(confirm),
                    custrecord_nchl_tran_raw_detail: JSON.stringify(raw)
                }
            })
            redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranId})
            return null
        }

        return {
            onRequest: context => {
                let form
                try {
                    const params = context.request.parameters
                    const journal = record.load({type: record.Type.JOURNAL_ENTRY, id: params.custpage_journal || params.recordid})
                    if (context.request.method === 'GET') {
                        form = writebillform(context, journal)
                    } else if (params.custpage_step === 'confirm') {
                        form = confirmbill(context, journal)
                    } else {
                        form = lodgebill(context, journal)
                    }
                } catch (e) {
                    log.error('GOV_PAYMENT_ERROR', e)
                    form = serverWidget.createForm({title: TITLE})
                    showmessage(form, message.Type.ERROR, 'ERROR', e.message || JSON.stringify(e))
                }
                if (form) {
                    context.response.writePage({pageObject: form})
                }
            }
        }
    })
