/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
// Bulk vendor payment: pick approved vendor payments / prepayments and the account each vendor is paid to;
// the scheduled script pays them one NCHL transaction per record
define(['N/ui/serverWidget', './mpmod', './rdmodule', 'N/task', 'N/ui/message'], function (serverWidget, mpmod, rdmodu, task, message) {
    const PAYABLE_TYPES = ['vendorpayment', 'vendorprepayment']

    function writelist(form) {
        const purposeField = form.addField({id: 'custpage_category_purpose', label: 'Category Purpose', type: serverWidget.FieldType.SELECT})
        purposeField.isMandatory = true
        Object.keys(rdmodu.categorypurposes).forEach(code => purposeField.addSelectOption({
            value: code,
            text: `${code} - ${rdmodu.categorypurposes[code]}`,
            isSelected: code === 'CUST'
        }))
        const sublist = form.addSublist({id: 'paymentlist', label: 'Payment List', type: serverWidget.SublistType.LIST})
        sublist.addMarkAllButtons()
        sublist.addField({id: 'marked', label: ' ', type: serverWidget.FieldType.CHECKBOX})
        sublist.addField({id: 'recordid', label: 'record id', type: serverWidget.FieldType.TEXT})
            .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
        sublist.addField({id: 'recordtype', label: 'record type', type: serverWidget.FieldType.TEXT})
            .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
        // inline select on the transaction list renders as a link to the payment
        sublist.addField({id: 'custcol_payment', label: 'Payment', type: serverWidget.FieldType.SELECT, source: 'transaction'})
            .updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
        sublist.addField({id: 'custcol_trandate', label: 'Date', type: serverWidget.FieldType.DATE})
        sublist.addField({id: 'custcol_entity', label: 'Vendor', type: serverWidget.FieldType.TEXT})
        sublist.addField({id: 'custcol_paytype', label: 'Payment Type', type: serverWidget.FieldType.TEXT})
        // one option list is shared by all rows, so each option names its vendor; the scheduled script rejects another vendor's account
        const accountField = sublist.addField({id: 'custcol_cr_account', label: 'Pay To Account', type: serverWidget.FieldType.SELECT})
        accountField.updateDisplayType({displayType: serverWidget.FieldDisplayType.ENTRY})
        accountField.addSelectOption({value: '', text: ''})
        sublist.addField({id: 'custcol_amount', label: 'Amount', type: serverWidget.FieldType.CURRENCY})

        const list = mpmod.getpaymentlist()
        const accountMap = mpmod.getpayeeaccountmap([...new Set(list.map(tran => tran.entityId).filter(id => id))])
        const added = new Set()
        list.forEach((tran, index) => {
            const accounts = (accountMap[String(tran.entityId)] || {})[tran.payType] || []
            accounts.forEach(account => {
                if (!added.has(account.id)) {
                    added.add(account.id)
                    accountField.addSelectOption({
                        value: account.id,
                        text: `${tran.entity}: ${account.bank.text} - ${account.accountNumber} (${account.accountName})`
                    })
                }
            })
            const setValue = (id, value) => {
                if (value !== '' && value !== null && value !== undefined) {
                    sublist.setSublistValue({id: id, line: index, value: String(value)})
                }
            }
            setValue('recordid', tran.id)
            setValue('recordtype', tran.type)
            setValue('custcol_payment', tran.id)
            setValue('custcol_trandate', tran.trandate)
            setValue('custcol_entity', tran.entity)
            setValue('custcol_paytype', tran.payType === 'CIPS' ? 'Real-Time' : 'Non-Real-Time')
            if (accounts.length === 1) {
                setValue('custcol_cr_account', accounts[0].id)
            }
            setValue('custcol_amount', tran.amount)
        })
        if (list.length === 0) {
            form.addPageInitMessage({message: message.create({type: message.Type.INFORMATION, title: 'Nothing to pay',
                message: 'No approved vendor payment or prepayment is waiting to be paid online.'})})
        } else {
            form.addSubmitButton({label: 'Pay Selected'})
        }
    }

    function submitlist(context, form) {
        const request = context.request
        const records = []
        const problems = []
        for (let x = 0; x < request.getLineCount({group: 'paymentlist'}); x++) {
            const value = name => request.getSublistValue({group: 'paymentlist', name: name, line: x})
            if (value('marked') !== 'T') {
                continue
            }
            if (!PAYABLE_TYPES.includes(value('recordtype'))) {
                continue
            }
            if (!value('custcol_cr_account')) {
                problems.push(`Row ${x + 1} (${value('custcol_entity')}): choose the account to pay to`)
                continue
            }
            records.push({recordid: value('recordid'), recordtype: value('recordtype'), payeeaccount: value('custcol_cr_account')})
        }
        if (problems.length > 0 || records.length === 0) {
            form.addPageInitMessage({message: message.create({type: message.Type.ERROR, title: 'Nothing was paid',
                message: problems.length > 0 ? problems.join('<br>') : 'Select at least one payment.'})})
            writelist(form)
            return
        }
        const purpose = rdmodu.categorypurposes.hasOwnProperty(request.parameters.custpage_category_purpose)
            ? request.parameters.custpage_category_purpose : 'CUST'
        task.create({
            taskType: task.TaskType.SCHEDULED_SCRIPT,
            scriptId: 'customscript_lc_process_pmt_schedule',
            deploymentId: 'customdeploy_lc_process_pmt_schedule',
            // script parameters are strings; the scheduled script expects {type, purpose, records}
            params: {custscript_lc_nchl_script_params: JSON.stringify({type: 'payment', purpose: purpose, records: records})}
        }).submit()
        form.addPageInitMessage({message: message.create({type: message.Type.CONFIRMATION, title: 'Payments queued',
            message: `${records.length} payment(s) are being sent to NCHL in the background. ` +
                'Each one gets its own NCHL transaction; reload this page to see what is still waiting.'})})
        writelist(form)
    }

    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Bulk Vendor Payment'})
            try {
                if (context.request.method === 'POST') {
                    submitlist(context, form)
                } else {
                    writelist(form)
                }
            } catch (e) {
                log.error('BULK_PAYMENT_ERROR', e)
                form.addPageInitMessage({message: message.create({type: message.Type.ERROR, title: 'ERROR', message: e.message || JSON.stringify(e)})})
            }
            context.response.writePage(form)
        }
    }
})
