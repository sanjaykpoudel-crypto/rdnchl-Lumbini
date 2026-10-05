/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define(['N/url', './rdmodule'], function (url, rdmodu) {
    return {
        beforeLoad: context => {
            if(context.type === 'view' && !context.newRecord.getValue('custbody_rdnchl_paid_online')
                && !rdmodu.getactivenchltran(context.newRecord.id)) {
                const form = context.form
                const pageUrl = url.resolveScript({
                    scriptId: 'customscript_bulk_payment_page',
                    deploymentId: 'customdeploy_bulk_payment_page',
                    params: {
                        recordid: context.newRecord.id,
                        recordtype: context.newRecord.type
                    }
                })
                form.addButton({
                    id: 'custpage_btn_payment',
                    label: 'Pay Online',
                    functionName: `window.open('${[pageUrl]}')`
                })
            }
        }
    }
})