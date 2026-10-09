/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
// Pay Online button on approved salary journals: debit lines for employees, one credit line on the paying bank
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
            if (!hasemployeedebit(journal) || rdmodu.getactivenchltran(journal.id)) {
                return
            }
            const pageUrl = url.resolveScript({
                scriptId: 'customscript_lc_salary_jrnl_pay',
                deploymentId: 'customdeploy_lc_salary_jrnl_pay',
                params: {recordid: journal.id}
            })
            context.form.addButton({
                id: 'custpage_btn_payment',
                label: 'Pay Online',
                functionName: `window.open('${pageUrl}')`
            })
        }
    }
})
