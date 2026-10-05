/**
 * @NApiVersion 2.x
 * @NScriptType Clientscript
 */
define(['N/search'], function (search) {
    return {
        fieldChanged: function (context) {
            console.log(context.fieldId)
            if(context.fieldId === 'custpage_cr_account') {
                const recordid = context.currentRecord.getValue(context.fieldId)
                const bankRecord = search.lookupFields({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: recordid,
                    columns: ['custrecord_rdnchl_bank_prop', 'custrecord_rdnchl_bank_branch_prop', 'custrecord_rdnchl_account_name', 'custrecord_rdnchl_account_number']
                })
                const bankField = context.currentRecord.getField({fieldId: 'custpage_cr_bank'})
                bankField.removeSelectOption({value: null})
                bankField.insertSelectOption(JSON.parse(bankRecord.custrecord_rdnchl_bank_prop))
                const bankBranchField = context.currentRecord.getField({fieldId: 'custpage_cr_bank_branch'})
                bankBranchField.removeSelectOption({value: null})
                bankBranchField.insertSelectOption(JSON.parse(bankRecord.custrecord_rdnchl_bank_branch_prop))
                context.currentRecord.setValue({
                    fieldId: 'custpage_cr_bank_ac_name',
                    value: bankRecord.custrecord_rdnchl_account_name
                })
                context.currentRecord.setValue({
                    fieldId: 'custpage_cr_bank_ac_number',
                    value: bankRecord.custrecord_rdnchl_account_number
                })
            }
        }
    }
})