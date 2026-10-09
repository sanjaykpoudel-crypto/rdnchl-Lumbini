/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
// Pays a salary journal through NCHL as one batch: the credit line is the paying bank, each debit line an employee
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/ui/message', 'N/redirect'], function (serverWidget, record, rdmod, message, redirect) {
    const PAY_TYPES = {CIPS: 'Real-Time', IPS: 'Non-Real-Time'}

    function getpaytype(value) {
        return PAY_TYPES.hasOwnProperty(value) ? value : 'CIPS'
    }

    function getpurpose(value) {
        return rdmod.categorypurposes.hasOwnProperty(value) ? value : 'CUST'
    }

    /**
     * Same conditions as the Pay Online button, checked again because this page can be opened or submitted directly
     * @returns {{title: string, message: string, activeTran: Object}|null} why the journal cannot be paid
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
     * Reads the paying bank and the employee lines from the journal. Used on GET to build the page and on POST so
     * the amounts and bank accounts sent to NCHL come from NetSuite, not from the submitted form.
     * @param {record.Record} journal
     * @param {string} payType CIPS or IPS
     */
    function getsalarypayment(journal, payType) {
        const lineValue = (fieldId, line) => journal.getSublistValue({sublistId: 'line', fieldId: fieldId, line: line})
        const lineCount = journal.getLineCount({sublistId: 'line'})
        const entityIds = []
        for (let i = 0; i < lineCount; i++) {
            if (lineValue('entity', i)) {
                entityIds.push(lineValue('entity', i))
            }
        }
        const employees = rdmod.getemployeeids(entityIds)
        const problems = [], lines = []
        let debtorBank = null, hasCredit = false, total = 0
        for (let i = 0; i < lineCount; i++) {
            const debit = parseFloat(lineValue('debit', i)) || 0
            const credit = parseFloat(lineValue('credit', i)) || 0
            if (credit) {
                if (hasCredit) {
                    problems.push(`Line ${i + 1}: only one paying (credit) bank line is supported`)
                    continue
                }
                hasCredit = true
                try {
                    debtorBank = rdmod.getcoabankdetail(lineValue('account', i), payType)
                } catch (e) {
                    problems.push(`Line ${i + 1}: ${e.message}`)
                }
            } else if (debit) {
                const employeeId = String(lineValue('entity', i) || '')
                if (!employees.has(employeeId)) {
                    problems.push(`Line ${i + 1}: debit lines must name an employee`)
                    continue
                }
                const employeeName = journal.getSublistText({sublistId: 'line', fieldId: 'entity', line: i})
                const accounts = rdmod.getpayeeaccounts(employeeId, payType)
                if (accounts.length === 0) {
                    problems.push(`Line ${i + 1}: ${employeeName} has no NCHL-verified ${PAY_TYPES[payType]} bank account`)
                }
                lines.push({line: i + 1, employeeName, amount: debit, memo: lineValue('memo', i) || '', accounts})
                total += debit
            }
        }
        if (!hasCredit) {
            problems.push('No paying (credit) bank line')
        }
        if (lines.length === 0) {
            problems.push('No employee (debit) lines')
        }
        return {debtorBank, lines, total: Math.round(total * 100) / 100, problems}
    }

    function showmessage(form, type, title, text) {
        form.addPageInitMessage({message: message.create({type: type, title: title, message: text})})
    }

    function addinline(form, option) {
        const field = form.addField(option)
        field.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
        return field
    }

    function writepage(context, journal) {
        const payType = getpaytype(context.request.parameters.ptype)
        const form = serverWidget.createForm({title: 'Salary Payment'})
        form.clientScriptModulePath = './suitelet_client.js'
        const blockReason = getblockreason(journal)
        if (blockReason) {
            showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
            return form
        }
        const salary = getsalarypayment(journal, payType)
        form.addField({id: 'custpage_journal', label: 'journal', type: serverWidget.FieldType.TEXT})
            .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
            .defaultValue = journal.id
        // changing it reloads the page with that type's paying bank and employee accounts (suitelet_client.js)
        const payTypeField = form.addField({id: 'custpage_ptype', label: 'Payment Type', type: serverWidget.FieldType.SELECT})
        payTypeField.updateLayoutType({layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE})
        Object.keys(PAY_TYPES).forEach(code => payTypeField.addSelectOption({
            value: code,
            text: PAY_TYPES[code],
            isSelected: code === payType
        }))

        form.addFieldGroup({id: 'primaryinformation', label: 'PRIMARY INFORMATION'})
        // inline select on the transaction list renders as a link to the journal
        addinline(form, {
            id: 'custpage_created_from',
            label: 'Created From',
            type: serverWidget.FieldType.SELECT,
            source: 'transaction',
            container: 'primaryinformation'
        }).defaultValue = journal.id
        const purposeField = form.addField({
            id: 'custpage_category_purpose',
            label: 'Category Purpose',
            type: serverWidget.FieldType.SELECT,
            container: 'primaryinformation'
        })
        purposeField.isMandatory = true
        Object.keys(rdmod.categorypurposes).forEach(code => purposeField.addSelectOption({
            value: code,
            text: `${code} - ${rdmod.categorypurposes[code]}`,
            isSelected: code === 'CUST'
        }))
        form.addField({id: 'custpage_memo', label: 'Memo', type: serverWidget.FieldType.TEXT, container: 'primaryinformation'})
            .defaultValue = journal.getValue('memo')
        addinline(form, {id: 'custpage_batch_amount', label: 'Total Amount', type: serverWidget.FieldType.CURRENCY, container: 'primaryinformation'})
            .defaultValue = salary.total

        form.addFieldGroup({id: 'debtor', label: 'DEBIT DETAIL'})
        const debtor = salary.debtorBank
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

        const sublist = form.addSublist({id: 'custpage_lines', label: 'Employees', type: serverWidget.SublistType.LIST})
        sublist.addField({id: 'custpage_line', label: 'Journal Line', type: serverWidget.FieldType.INTEGER})
        sublist.addField({id: 'custpage_employee', label: 'Employee', type: serverWidget.FieldType.TEXT})
        // one option list is shared by all rows, so each option names its employee; POST rejects another employee's account
        const accountField = sublist.addField({id: 'custpage_cr_account', label: 'Pay To Account', type: serverWidget.FieldType.SELECT})
        accountField.updateDisplayType({displayType: serverWidget.FieldDisplayType.ENTRY})
        accountField.addSelectOption({value: '', text: ''})
        sublist.addField({id: 'custpage_amount', label: 'Amount', type: serverWidget.FieldType.CURRENCY})
        sublist.addField({id: 'custpage_remarks', label: 'Remarks', type: serverWidget.FieldType.TEXT})
            .updateDisplayType({displayType: serverWidget.FieldDisplayType.ENTRY})
        const added = new Set()
        salary.lines.forEach((line, index) => {
            line.accounts.forEach(account => {
                if (!added.has(account.id)) {
                    added.add(account.id)
                    accountField.addSelectOption({
                        value: account.id,
                        text: `${line.employeeName}: ${account.bank.text} - ${account.accountNumber} (${account.accountName})`
                    })
                }
            })
            sublist.setSublistValue({id: 'custpage_line', line: index, value: String(line.line)})
            sublist.setSublistValue({id: 'custpage_employee', line: index, value: line.employeeName})
            if (line.accounts.length === 1) {
                sublist.setSublistValue({id: 'custpage_cr_account', line: index, value: line.accounts[0].id})
            }
            sublist.setSublistValue({id: 'custpage_amount', line: index, value: String(line.amount)})
            const remarks = line.memo || journal.getValue('memo')
            if (remarks) {
                sublist.setSublistValue({id: 'custpage_remarks', line: index, value: remarks})
            }
        })
        if (salary.problems.length > 0) {
            showmessage(form, message.Type.ERROR, 'Cannot pay this journal', salary.problems.join('<br>'))
        } else {
            form.addSubmitButton({label: 'Make Payment'})
        }
        return form
    }

    function submitpayment(context) {
        const request = context.request
        const journal = record.load({type: record.Type.JOURNAL_ENTRY, id: request.parameters.custpage_journal})
        const form = serverWidget.createForm({title: 'Salary Payment'})
        // Re-check on submit: the form may have been opened twice or submitted twice
        const blockReason = getblockreason(journal)
        if (blockReason && blockReason.activeTran) {
            redirect.toRecord({type: 'customrecord_nchl_transaction', id: blockReason.activeTran.id})
            return null
        }
        if (blockReason) {
            showmessage(form, message.Type.WARNING, blockReason.title, blockReason.message)
            return form
        }
        const payType = getpaytype(request.parameters.custpage_ptype)
        const salary = getsalarypayment(journal, payType)
        const chosen = {}
        for (let x = 0; x < request.getLineCount({group: 'custpage_lines'}); x++) {
            const formValue = name => request.getSublistValue({group: 'custpage_lines', name: name, line: x})
            chosen[formValue('custpage_line')] = {account: formValue('custpage_cr_account'), remarks: formValue('custpage_remarks')}
        }
        const tranId = journal.getValue('tranid')
        const instructions = []
        salary.lines.forEach(line => {
            const choice = chosen[String(line.line)] || {}
            // only an active, verified account of this line's employee is accepted
            const account = line.accounts.find(a => a.id === choice.account)
            if (!account) {
                salary.problems.push(`Line ${line.line}: choose a verified bank account of ${line.employeeName}`)
                return
            }
            instructions.push({
                endtoendid: `${tranId}-${line.line}`.replace(/\s/g, ''),
                crbank: account.bank.value,
                crbankbranch: account.branch.value,
                craccountname: account.accountName,
                craccount: account.accountNumber,
                amount: line.amount,
                remarks: choice.remarks || line.memo || tranId
            })
        })
        if (salary.problems.length > 0) {
            showmessage(form, message.Type.ERROR, 'Cannot pay this journal', salary.problems.join('<br>'))
            return form
        }
        const debtor = salary.debtorBank
        const params = {
            paymenttype: payType,
            amount: salary.total,
            purpose: getpurpose(request.parameters.custpage_category_purpose),
            drbank: JSON.parse(debtor.custrecord_rdnchl_bank_prop).value,
            drbankbranch: JSON.parse(debtor.custrecord_rdnchl_bank_branch_prop).value,
            draccountname: debtor.custrecord_rdnchl_account_name,
            draccount: debtor.custrecord_rdnchl_account_number,
            remarks: request.parameters.custpage_memo || tranId,
            instructions: instructions
        }
        const nchlTranRecord = rdmod.savenchltran({
            relrecord: JSON.stringify({type: journal.type, id: journal.id}),
            params: params
        })
        // post*batch returns a string when the request itself failed
        const nchlResponse = payType === 'CIPS' ? rdmod.postcipsbatch(nchlTranRecord) : rdmod.postipsbatch(nchlTranRecord)
        // Save the response first so it is never lost, even if NCHL rejected the batch.
        // Journals have no paid-online field: this NCHL transaction is what blocks a second payment.
        rdmod.updaterelrecord({
            type: 'customrecord_nchl_transaction',
            id: nchlTranRecord,
            values: {custrecord_nchl_tran_response: typeof nchlResponse === 'string' ? nchlResponse : nchlResponse.body}
        })
        redirect.toRecord({type: 'customrecord_nchl_transaction', id: nchlTranRecord})
        return null
    }

    return {
        onRequest: context => {
            let form
            try {
                if (context.request.method === 'GET') {
                    form = writepage(context, record.load({type: record.Type.JOURNAL_ENTRY, id: context.request.parameters.recordid}))
                } else {
                    form = submitpayment(context)
                }
            } catch (e) {
                log.error('SALARY_PAYMENT_ERROR', e)
                form = serverWidget.createForm({title: 'Salary Payment'})
                showmessage(form, message.Type.ERROR, 'ERROR', e.message || JSON.stringify(e))
            }
            if (form) {
                context.response.writePage({pageObject: form})
            }
        }
    }
})
