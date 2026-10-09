/**
 * @NApiVersion 2.1
 * @NScriptType Clientscript
 */
define([], function () {
    return {
        fieldChanged: function (context) {
            if (context.fieldId === 'custpage_ptype' && !context.sublistId) {
                // salary page: the paying bank and employee accounts depend on the payment type, so rebuild the page
                const pageUrl = new URL(window.location.href)
                pageUrl.searchParams.set('ptype', context.currentRecord.getValue(context.fieldId))
                window.onbeforeunload = null
                window.location.href = pageUrl.toString()
            } else if (context.fieldId === 'custpage_cr_account' && !context.sublistId) {
                // display only: the Suitelet reads the chosen account again on submit
                const accountId = context.currentRecord.getValue(context.fieldId)
                const accounts = JSON.parse(context.currentRecord.getValue('custpage_cr_accounts') || '[]')
                const account = accounts.find(function (a) {
                    return a.id === accountId
                }) || {bank: {}, branch: {}}
                const values = {
                    custpage_cr_bank: account.bank.text,
                    custpage_cr_bank_branch: account.branch.text,
                    custpage_cr_bank_ac_name: account.accountName,
                    custpage_cr_bank_ac_number: account.accountNumber
                }
                Object.keys(values).forEach(function (fieldId) {
                    context.currentRecord.setValue({fieldId: fieldId, value: values[fieldId] || ''})
                })
            }
        }
    }
})
