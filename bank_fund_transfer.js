/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/search', 'N/task'], function (serverWidget, search, task) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Bank Fund Transfer'})
            try {
                if (context.request.method === 'GET') {
                    const dateCol = search.createColumn({
                        name: 'trandate',
                        sort: 'DESC'
                    })
                    const transferSearch = search.create({
                        type: "transfer",
                        filters: [],
                        columns: [dateCol, "transactionnumber", "tranid", "memo", 'account', 'amount']
                    })
                    const jres = []
                    transferSearch.run().each(result => {
                        const tranamount = result.getValue('amount')
                        const elm = {
                            id: result.id,
                            recordtype: result.recordType,
                            trannum: result.getValue('transactionnumber'),
                            trandate: result.getValue(dateCol),
                            //tranid: result.getValue('tranid'),
                            //memo: result.getValue('memo'),
                            tacct: tranamount > 0 ? result.getValue('account') : '',
                            facct: tranamount < 0 ? result.getValue('account') : '',
                            amount: tranamount,
                        }
                        const elmin = jres.findIndex(jr => jr.id === result.id)
                        if (elmin < 0) {
                            jres.push(elm)
                        } else {
                            if (jres[elmin].facct) {
                                jres[elmin].tacct = elm.tacct
                                jres[elmin].amount = elm.amount
                            } else {
                                jres[elmin].facct = elm.facct
                            }
                        }
                        return true
                    })
                    const bankTrans = form.addSublist({
                        id: 'banktransfer',
                        label: 'Bank Transfer List',
                        type: serverWidget.SublistType.LIST
                    })
                    bankTrans.addMarkAllButtons()
                    bankTrans.addField({id: 'marked', label: 'mark', type: serverWidget.FieldType.CHECKBOX})
                    bankTrans.addField({
                        id: 'recid',
                        label: 'record id',
                        type: serverWidget.FieldType.INTEGER
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                    bankTrans.addField({
                        id: 'rectype',
                        label: 'record type',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                    bankTrans.addField({id: 'trandate', label: 'Date', type: serverWidget.FieldType.DATE})
                    bankTrans.addField({id: 'trannum', label: 'Transaction Number', type: serverWidget.FieldType.TEXT})
                    bankTrans.addField({
                        id: 'fromacct',
                        label: 'From Account',
                        type: serverWidget.FieldType.SELECT,
                        source: 'account'
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    bankTrans.addField({
                        id: 'toacct',
                        label: 'To Account',
                        type: serverWidget.FieldType.SELECT,
                        source: 'account'
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    bankTrans.addField({id: 'amount', label: 'Amount', type: serverWidget.FieldType.CURRENCY})
                    jres.forEach((jrs, index) => {
                        bankTrans.setSublistValue({id: 'recid', line: index, value: jrs.id})
                        bankTrans.setSublistValue({id: 'rectype', line: index, value: jrs.recordtype})
                        bankTrans.setSublistValue({id: 'trandate', line: index, value: jrs.trandate})
                        bankTrans.setSublistValue({id: 'trannum', line: index, value: jrs.trannum})
                        bankTrans.setSublistValue({id: 'fromacct', line: index, value: jrs.facct})
                        bankTrans.setSublistValue({id: 'toacct', line: index, value: jrs.tacct})
                        bankTrans.setSublistValue({id: 'amount', line: index, value: jrs.amount})
                    })
                    form.addSubmitButton({label: 'Continue'})
                } else if (context.request.method === 'POST') {
                    const count = context.request.getLineCount({group: 'banktransfer'})
                    const selectedTrans = []
                    for (let i = 0; i < count; i++) {
                        const isSelected = context.request.getSublistValue({
                            group: 'banktransfer',
                            name: 'marked',
                            line: i
                        })
                        if (isSelected === 'T') {
                            selectedTrans.push({
                                recordid: context.request.getSublistValue({
                                    group: 'banktransfer',
                                    name: 'recid',
                                    line: i
                                }),
                                recordtype: context.request.getSublistValue({
                                    group: 'banktransfer',
                                    name: 'rectype',
                                    line: i
                                })
                            })
                        }
                    }
                    form.addField({
                        id: 'temp_res',
                        label: 'temp res',
                        type: serverWidget.FieldType.LONGTEXT
                    }).defaultValue = JSON.stringify({type: 'transfer', records: selectedTrans})
                    if (selectedTrans.length > 0) {
                        const scheduletask = task.create({
                            taskType: task.TaskType.SCHEDULED_SCRIPT,
                            scriptId: 'customscript_process_payment_schedule',
                            deploymentId: 'customdeploy_process_payment_schedule',
                            params: {custscript_nchl_script_params: {type: 'transfer', records: selectedTrans}}
                        })
                        const taskId = scheduletask.submit()
                    }
                }
            } catch (e) {
                log.error('error', e)
                form.addField({
                    id: 'html',
                    label: 'html',
                    type: 'inlinehtml'
                }).defaultValue = '<h3 style="color: red">' + JSON.stringify(e) + '</h3>'
            }
            context.response.writePage(form)
        }
    }
})