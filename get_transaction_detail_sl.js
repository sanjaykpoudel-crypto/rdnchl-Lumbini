/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule'], function (serverWidget, record, rdmod) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'NCHL Transaction Detail'})

            const tranRec = record.load({
                type: context.request.parameters.rectype,
                id: context.request.parameters.recid
            })
            const batch = JSON.parse(tranRec.getValue('custrecord_nchl_tran_batch'))
            // const instructions = tranRec.getValue('custrecord_nchl_tran_instruction')
            // const tranResp = JSON.parse(tranRec.getValue('custrecord_nchl_tran_response'))
            const detailResponse = rdmod.getipstrandetail({batchid: batch.batchId, token: context.request.parameters.token})

            const instructionSublist = form.addSublist({
                id: 'instructions',
                label: 'instructions',
                type:  serverWidget.SublistType.LIST
            })
            instructionSublist.addField({
                id: 'custpage_ac_name',
                label: 'Account Name',
                type: serverWidget.FieldType.TEXT
            })
            instructionSublist.addField({
                id: 'custpage_ac_number',
                label: 'Account Number',
                type: serverWidget.FieldType.TEXT
            })
            instructionSublist.addField({
                id: 'custpage_amount',
                label: 'Amount',
                type: serverWidget.FieldType.TEXT
            })
            instructionSublist.addField({
                id: 'custpage_status',
                label: 'Status',
                type: serverWidget.FieldType.TEXT
            })
            const responseBody = JSON.parse(detailResponse.body)
            responseBody.nchlIpsTransactionDetailList.forEach((inst, line) => {
                instructionSublist.setSublistValue({
                    id: 'custpage_ac_name',
                    value: inst.creditorName,
                    line: line
                })
                instructionSublist.setSublistValue({
                    id: 'custpage_ac_number',
                    value: inst.creditorAccount,
                    line: line
                })
                instructionSublist.setSublistValue({
                    id: 'custpage_amount',
                    value: inst.amount,
                    line: line
                })
                instructionSublist.setSublistValue({
                    id: 'custpage_status',
                    value: inst.creditStatus,
                    line: line
                })
            })
            /*form.addField({
                id: 'custpgae_mt_dev',
                label: 'MT DEV',
                type: serverWidget.FieldType.LONGTEXT
            }).defaultValue = detailResponse.body*/
            context.response.writePage({pageObject: form})
        }
    }
})