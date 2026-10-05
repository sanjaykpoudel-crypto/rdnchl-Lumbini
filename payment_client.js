/**
 * @NApiVersion 2.x
 * @NScriptType Clientscript
 */
define(['./rdmoduleclient'], function (rdmodc) {
    return {
        fieldChanged: function (context) {
            if (context.fieldId === 'custbody_nchl_payment_type') {
                const paymentType = context.currentRecord.getValue(context.fieldId)
                const type = paymentType === '1' ? 'CIPS' : 'IPS'
                const entityBankField = context.currentRecord.getField({fieldId: 'custpage_entity_bank'})
                const entityId = context.currentRecord.getValue('entity')
                var selectOptions = rdmodc.getentitybanks(entityId, type)
                entityBankField.removeSelectOption({value: null})
                selectOptions.forEach(function (selectoption) {
                    entityBankField.insertSelectOption(selectoption)
                })
            } else if (context.fieldId === 'custpage_entity_bank') {
                const selectedBank = context.currentRecord.getValue(context.fieldId)
                context.currentRecord.setValue({
                    fieldId: 'custbody_rdnchl_bank',
                    value: selectedBank
                })
            }
        }
    }
})