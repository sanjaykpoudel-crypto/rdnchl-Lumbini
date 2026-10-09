/**
 * @NApiVersion 2.1
 * @NScriptType Clientscript
 */
define([], function () {
    const SALARY_ACCOUNT_COLUMNS = ['custpage_cr_bank', 'custpage_cr_branch', 'custpage_cr_ac_number', 'custpage_cr_ac_name']

    return {
        pageInit: function () {
            // salary page: the account detail columns are inputs only so they can be redrawn; nobody should type in them
            SALARY_ACCOUNT_COLUMNS.forEach(function (fieldId) {
                document.querySelectorAll('input[name^="' + fieldId + '"]').forEach(function (input) {
                    input.readOnly = true
                    input.tabIndex = -1
                    input.style.border = 'none'
                    input.style.background = 'transparent'
                })
            })
        },
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
            } else if (context.sublistId === 'custpage_lines' && context.fieldId === 'custpage_cr_account') {
                // salary page, display only: show the chosen account's details in the row; the Suitelet reads the account again on submit
                // list sublist lines are only read and written reliably through the 1.0 API
                const accountId = nlapiGetLineItemValue('custpage_lines', 'custpage_cr_account', context.line + 1)
                const details = JSON.parse(context.currentRecord.getValue('custpage_lines_accounts') || '{}')[accountId] || {}
                SALARY_ACCOUNT_COLUMNS.forEach(function (fieldId) {
                    nlapiSetLineItemValue('custpage_lines', fieldId, context.line + 1, details[fieldId] || '')
                })
            }
        }
    }
})
