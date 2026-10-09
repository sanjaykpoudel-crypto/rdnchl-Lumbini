/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/url', './rdmodule', 'N/record', 'N/runtime'], function (url, rdmodu, record, runtime) {
    return {
        beforeLoad: context => {
            const form = context.form
            // The payee account is chosen on the Pay Online page, which records it here
            const paidToField = form.getField({id: 'custbody_rdnchl_bank'})
            if (paidToField) {
                paidToField.updateDisplayType({displayType: 'inline'})
            }
            if (context.type === 'create' || context.type === 'edit') { //TODO: Upload this changes or might not be useful
                if (runtime.executionContext === runtime.ContextType.USER_INTERFACE) {
                    if (context.request.parameters.hasOwnProperty('bill')) {
                        const billRecord = record.load({
                            type: record.Type.VENDOR_BILL,
                            id: context.request.parameters.bill
                        })
                        const npiReqBody = billRecord.getValue('custbody_npi_request_body')
                        if (npiReqBody) {
                            context.newRecord.setValue({
                                fieldId: 'custbody_npi_request_body',
                                value: npiReqBody
                            })
                        } else {
                            context.newRecord.setValue({
                                fieldId: 'custbody_ird_voucher_no',
                                value: billRecord.getValue('custbody_ird_voucher_no')
                            })
                        }
                    }
                }
            }
            if (context.type === 'view') {
                if (context.newRecord.getValue('approvalstatus') === '2' && !context.newRecord.getValue('custbody_rdnchl_paid_online')
                    && !rdmodu.getactivenchltran(context.newRecord.id)) {
                    const targetUrl = url.resolveScript({
                        scriptId: 'customscript_lc_payment_confirm_sl',
                        deploymentId: 'customdeploy_lc_payment_confirm_sl',
                        params: {
                            recordtype: context.newRecord.type,
                            recordid: context.newRecord.id
                        }
                    })
                    form.addButton({
                        id: 'custpage_npi_pay_btn',
                        label: 'Pay Online',
                        functionName: `window.open('${targetUrl}')`
                    })
                }
            }
        }
    }
})