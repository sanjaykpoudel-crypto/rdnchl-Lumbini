/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record'], function (record) {
    return {
        afterSubmit: context => {
            const nchlBankRecord = context.newRecord.getValue('custrecord_rdnchl_coa_bank_detail')
            const ipsBankRecord = context.newRecord.getValue('custrecord_ips_bank')
            if (nchlBankRecord) {
                record.submitFields({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: nchlBankRecord,
                    values: {
                        'custrecord_nchl_bank_coa': context.newRecord.id
                    }
                })
            }
            if(ipsBankRecord) {
                record.submitFields({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: ipsBankRecord,
                    values: {
                        'custrecord_nchl_bank_coa': context.newRecord.id
                    }
                })
            }
        }
    }
})