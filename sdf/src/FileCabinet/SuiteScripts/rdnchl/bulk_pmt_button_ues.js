/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
// Pay Online button on approved journals:
// - government payments (NCHL Government Payment set): one bill, paid from the credit (bank) line
// - salary: debit lines for employees, one credit line on the paying bank
define(['N/url', './rdmodule'], function (url, rdmodu) {
    function hasemployeedebit(journal) {
        const entityIds = []
        for (let i = 0; i < journal.getLineCount({sublistId: 'line'}); i++) {
            const entity = journal.getSublistValue({sublistId: 'line', fieldId: 'entity', line: i})
            if (entity && journal.getSublistValue({sublistId: 'line', fieldId: 'debit', line: i})) {
                entityIds.push(entity)
            }
        }
        return rdmodu.getemployeeids(entityIds).size > 0
    }

    return {
        beforeLoad: context => {
            const journal = context.newRecord
            if (context.type !== 'view' || journal.getValue('approvalstatus') !== '2') {
                return
            }
            // an NCHL transaction that succeeded, is in progress or is unknown blocks a second payment
            if (rdmodu.getactivenchltran(journal.id)) {
                return
            }
            let page
            if (journal.getValue('custbody_lc_nchl_gov_biller')) {
                page = {scriptId: 'customscript_lc_gov_pay', deploymentId: 'customdeploy_lc_gov_pay'}
            } else if (hasemployeedebit(journal)) {
                page = {scriptId: 'customscript_lc_salary_jrnl_pay', deploymentId: 'customdeploy_lc_salary_jrnl_pay'}
            } else {
                return
            }
            const pageUrl = url.resolveScript(Object.assign(page, {params: {recordid: journal.id}}))
            context.form.addButton({
                id: 'custpage_btn_payment',
                label: 'Pay Online',
                functionName: `window.open('${pageUrl}')`
            })
        }
    }
})
