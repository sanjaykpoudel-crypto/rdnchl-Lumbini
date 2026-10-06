/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/url', './rdmodule'], function (url, rdmodu) {
    return {
        beforeLoad: context => {
            if (context.type === 'view') {
                const tranStat = context.newRecord.getValue('transtatus')
                // custbody_rdnchl_paid_online is not applied to contra vouchers, so an earlier NCHL
                // transaction (successful, in progress or unknown) is what hides the button
                const paidOnline = context.newRecord.getValue('custbody_rdnchl_paid_online')
                if (tranStat === 'B' && !paidOnline && !rdmodu.getactivenchltran(context.newRecord.id)) {
                    const pageUrl = url.resolveScript({
                        scriptId: 'customscript_lc_contra_pmt_confirm',
                        deploymentId: 'customdeploy_lc_contra_pmt_confirm',
                        params: {
                            recordtype: context.newRecord.type,
                            recordid: context.newRecord.id
                        }
                    })
                    context.form.addButton({
                        id: 'custpage_nchl_payment',
                        label: 'Pay Online',
                        functionName: `window.open('${pageUrl}', "_self")`
                    })
                }
            }
        }
    }
})
