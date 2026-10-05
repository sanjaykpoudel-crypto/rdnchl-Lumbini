/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define(['N/url'], function (url) {
    return {
        beforeLoad: context => {
            if(context.type === 'view') {
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