/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/encode', 'N/record'], function (serverWidget, encode, record) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Payments details'})
            const recParam = encode.convert({
                string: context.request.parameters.recordparam,
                inputEncoding: encode.Encoding.BASE_64_URL_SAFE,
                outputEncoding: encode.Encoding.UTF_8
            })
            const journalRecord = record.load(JSON.parse(recParam))
            const lineCount = journalRecord.getLineCount({sublistId: 'line'})
            form.addField({
                id: 'custpage_temp_html_dev',
                label: 'dev note',
                type: serverWidget.FieldType.LONGTEXT
            }).defaultValue = typeof lineCount
            context.response.writePage(form)
        }
    }
})