/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/ui/message', 'N/redirect'], function (serverWidget, record, rdmod, message, redirect) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Bulk Payment'})
            form.addField({
                id: 'test_result',
                label: 'result',
                type: serverWidget.FieldType.LONGTEXT
            }).defaultValue = rdmod.generatetoken()
            context.response.writePage({pageObject: form})
        }
    }
})