/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', './mpmod', 'N/task', 'N/url'], function (serverWidget, mpmod, task, url) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({
                title: 'Select Records for Payment'
            })
            const sublist = form.addSublist({
                id: 'paymentlist',
                label: 'Payment List',
                type: serverWidget.SublistType.LIST
            })
            sublist.addMarkAllButtons()
            sublist.addField({
                id: 'marked',
                label: ' ',
                type: serverWidget.FieldType.CHECKBOX
            })
            sublist.addField({
                id: 'recordid',
                label: 'record id',
                type: serverWidget.FieldType.TEXT
            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
            sublist.addField({
                id: 'recordtype',
                label: 'record type',
                type: serverWidget.FieldType.TEXT
            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
            sublist.addField({
                id: 'custcol_trandate',
                label: 'date',
                type: serverWidget.FieldType.DATE
            })
            sublist.addField({
                id: 'custcol_doc_no',
                label: 'Document Number',
                type: serverWidget.FieldType.TEXT
            })
            sublist.addField({
                id: 'custcol_entity',
                label: 'Entity',
                type: serverWidget.FieldType.TEXT
            })
            sublist.addField({
                id: 'custcol_amount',
                label: 'Amount',
                type: serverWidget.FieldType.CURRENCY
            })
            const list = mpmod.getpaymentlist()
            list.forEach((tran, index) => {
                sublist.setSublistValue({
                    id: 'recordid',
                    value: tran.id,
                    line: index
                })
                sublist.setSublistValue({
                    id: 'recordtype',
                    value: tran.type,
                    line: index
                })
                sublist.setSublistValue({
                    id: 'custcol_trandate',
                    value: tran.trandate,
                    line: index
                })
                sublist.setSublistValue({
                    id: 'custcol_doc_no',
                    value: tran.tranid,
                    line: index
                })
                sublist.setSublistValue({
                    id: 'custcol_entity',
                    value: tran.entity,
                    line: index
                })
                sublist.setSublistValue({
                    id: 'custcol_amount',
                    value: tran.amount,
                    line: index
                })
            })
            form.addSubmitButton({label: 'Continue'})
            if (context.request.method === 'POST') {
                const lines = context.request.getLineCount({
                    group: 'paymentlist'
                })
                const paymentList = []
                for (let x = 0; x < lines; x++) {
                    const isChecked = context.request.getSublistValue({group: 'paymentlist', name: 'marked', line: x})
                    if (isChecked === 'T') {
                        paymentList.push({
                            recordid: context.request.getSublistValue({
                                group: 'paymentlist',
                                name: 'recordid',
                                line: x
                            }),
                            recordtype: context.request.getSublistValue({
                                group: 'paymentlist',
                                name: 'recordtype',
                                line: x
                            }),
                            selected: isChecked,
                            tranid: context.request.getSublistValue({
                                group: 'paymentlist',
                                name: 'custcol_doc_no',
                                line: x
                            }),
                            entity: context.request.getSublistValue({
                                group: 'paymentlist',
                                name: 'custcol_entity',
                                line: x
                            }),
                            amount: context.request.getSublistValue({
                                group: 'paymentlist',
                                name: 'custcol_amount',
                                line: x
                            })
                        })
                    }
                }
                form.addField({
                    id: 'custpage_temp',
                    label: 'temp',
                    type: serverWidget.FieldType.LONGTEXT
                }).defaultValue = JSON.stringify(paymentList)
                if (paymentList.length > 0) {
                    const scheduletask = task.create({
                        taskType: task.TaskType.SCHEDULED_SCRIPT,
                        scriptId: 'customscript_process_payment_schedule',
                        deploymentId: 'customdeploy_process_payment_schedule',
                        // script parameters are strings; the scheduled script expects {type, records}
                        params: {custscript_nchl_script_params: JSON.stringify({type: 'payment', records: paymentList})}
                    })
                    const taskId = scheduletask.submit()
                }
            }
            const backUrl = url.resolveScript({
                scriptId: 'customscript_process_multi_pmt',
                deploymentId: 'customdeploy_process_multi_pmt'
            })
            form.addButton({
                id: 'custpage_goback',
                label: 'Back',
                functionName: "window.open('" + backUrl + "', '_self')"
            })
            context.response.writePage(form)
        }
    }
})