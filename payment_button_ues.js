/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/url', './rdmodule', 'N/record', 'N/runtime'], function (url, rdmodu, record, runtime) {
    return {
        beforeLoad: context => {
            const form = context.form
            const isips = context.newRecord.getValue('custbody_nchl_payment_type')
            const bankactype = isips === '2' ? 'IPS' : 'CIPS'
            if (context.type === 'view') {
                form.getField({id: 'custbody_rdnchl_bank'})
                    .updateDisplayType({displayType: 'normal'})
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
                const entity = context.newRecord.getValue('entity')
                form.addField({
                    id: 'custpage_dev_field',
                    label: 'dev field',
                    type: 'text',
                }).defaultValue = entity ? entity : 'No Entity Set'
                const entityBankField = form.addField({
                    id: 'custpage_entity_bank',
                    label: 'entity Bank (nchl)',
                    type: 'select',
                    container: 'custom'
                })
                if (entity) {
                    const selectedBank = context.newRecord.getValue('custbody_rdnchl_bank')
                    const bankoptionlist = rdmodu.getentitybanks(entity, bankactype)
                    bankoptionlist.forEach(bankoption => {
                        bankoption.isSelected = bankoption.value === selectedBank
                        entityBankField.addSelectOption(bankoption)
                    })
                }
            }
            if (context.type === 'view') {
                if (context.newRecord.getValue('approvalstatus') === '2' && !context.newRecord.getValue('custbody_rdnchl_paid_online')
                    && !rdmodu.getactivenchltran(context.newRecord.id)) {
                    const targetUrl = url.resolveScript({
                        scriptId: 'customscript_payment_detail_confirm_sl',
                        deploymentId: 'customdeploy_payment_detail_confirm_sl',
                        params: {
                            recordtype: context.newRecord.type,
                            recordid: context.newRecord.id,
                            ptype: bankactype
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