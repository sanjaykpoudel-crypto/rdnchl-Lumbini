/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/url', 'N/encode'], function (url, encode) {
    return {
        beforeLoad: context => {
            if (context.type === 'view') {
                const jvRec = context.newRecord
                const allow = jvRec.getValue('approvalstatus') === '2'
                if (allow) {
                    const form = context.form
                    const slUrl = url.resolveScript({
                        scriptId: 'customscript_nchl_process_jrnl_payment',
                        deploymentId: 'customdeploy_nchl_process_jrnl_payment',
                        params: {
                            recordparam: encode.convert({
                                string: JSON.stringify({
                                    type: jvRec.type,
                                    id: jvRec.id
                                }),
                                inputEncoding: encode.Encoding.UTF_8,
                                outputEncoding: encode.Encoding.BASE_64_URL_SAFE
                            })
                        }
                    })
                    form.addButton({
                        id: 'custpage_btn_payonline',
                        label: 'Online Payment',
                        functionName: 'window.open("' + slUrl + '")'
                    })
                }
            }
        }
    }
})