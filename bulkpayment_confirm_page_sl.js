/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/ui/message', 'N/redirect'], function (serverWidget, record, rdmod, message, redirect) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Bulk Payment'})
            if (context.request.method === 'GET') {
                try {
                    const paymentRecord = record.load({
                        type: context.request.parameters.recordtype,
                        id: context.request.parameters.recordid
                    })
                    const pmtType = paymentRecord.getValue('custbody_nchl_payment_type')
                    const paymentTypeField = form.addField({
                        id: 'custpage_payment_type',
                        label: 'Payment Type',
                        type: serverWidget.FieldType.SELECT
                    })
                    paymentTypeField.addSelectOption({value: 'CIPS', text: 'Real-Time', isSelected: pmtType === '1'})
                    paymentTypeField.addSelectOption({value: 'IPS', text: 'Non-Real-Time', isSelected: pmtType === '2'})
                    paymentTypeField.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                    const debtorBankField = form.addField({
                        id: 'custpage_dr_bank',
                        label: 'Bank',
                        type: serverWidget.FieldType.SELECT
                    })
                    const lineCount = paymentRecord.getLineCount({sublistId: 'line'})
                    let messageBox = {}, creditTotal = 0, creditLines = [], messageText = ''
                    const formSublist = form.addSublist({
                        id: 'batch_transaction',
                        label: 'Batch Transaction',
                        type: serverWidget.SublistType.LIST
                    })
                    form.addField({
                        id: 'custpage_relrecord',
                        label: 'related record',
                        type: serverWidget.FieldType.TEXT
                    })
                        .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                        .defaultValue = JSON.stringify({
                        type: context.request.parameters.recordtype,
                        id: context.request.parameters.recordid
                    })
                    formSublist.addField({
                        id: 'custpage_selected',
                        label: 'select',
                        type: serverWidget.FieldType.CHECKBOX
                    })
                        .updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                        .defaultValue = 'T'
                    const bankField = formSublist.addField({
                        id: 'custpage_bank',
                        label: 'Bank',
                        type: serverWidget.FieldType.SELECT
                    })
                    const bankBranchField = formSublist.addField({
                        id: 'custpage_branch',
                        label: 'Bank Branch',
                        type: serverWidget.FieldType.SELECT
                    })
                    formSublist.addField({
                        id: 'custpage_ac_name',
                        label: 'Account Name',
                        type: serverWidget.FieldType.TEXT
                    })
                    formSublist.addField({
                        id: 'custpage_ac_number',
                        label: 'Account Number',
                        type: serverWidget.FieldType.TEXT
                    })
                    formSublist.addField({
                        id: 'custpage_linememo',
                        label: 'line memo',
                        type: serverWidget.FieldType.TEXT
                    })
                    formSublist.addField({
                        id: 'custpage_amount',
                        label: 'Amount',
                        type: serverWidget.FieldType.CURRENCY
                    })
                    let debtorBankDetails = ''
                    for (let i = 0; i < lineCount; i++) {
                        const debit = paymentRecord.getSublistValue({sublistId: 'line', fieldId: 'debit', line: i})
                        const credit = paymentRecord.getSublistValue({sublistId: 'line', fieldId: 'credit', line: i})
                        const bankRecord = paymentRecord.getSublistValue({
                            sublistId: 'line',
                            fieldId: 'custcol_col_entity_bank',
                            line: i
                        })
                        if (debit) {
                            const coaId = paymentRecord.getSublistValue({
                                sublistId: 'line',
                                fieldId: 'account',
                                line: i
                            })
                            log.debug('COA_ID', coaId)
                            if (coaId) {
                                const bankType = pmtType === '1' ? 'CIPS' : 'IPS'
                                debtorBankDetails = rdmod.getcoabankdetail(coaId, bankType)
                                log.debug('COA_BANk', debtorBankDetails)
                                /*messageBox = {
                                    type: message.Type.INFORMATION,
                                    message: JSON.stringify(debtorBankDetails)
                                }*/
                            } else {
                                messageBox = {
                                    type: message.Type.ERROR,
                                    message: 'Debtor Bank Detail not available'
                                }
                            }

                        }
                        if (!bankRecord && credit) {
                            messageText += `line ${i + 1} doesn't have bank account selected\n`
                        } else if (bankRecord && credit) {
                            const lineMemo = paymentRecord.getSublistValue({
                                sublistId: 'line',
                                fieldId: 'memo',
                                line: i
                            })
                            const bankDetails = rdmod.getbankdetail(bankRecord)
                            bankDetails.amount = credit
                            bankDetails.linememo = lineMemo ? lineMemo : 'empty'
                            creditLines.push(bankDetails)
                            //messageBox = JSON.stringify(bankDetails)
                            creditTotal += parseFloat(credit)
                        }
                    }
                    if (messageText) {
                        messageBox = {
                            type: message.Type.ERROR,
                            message: messageText
                        }
                    }
                    //log.debug('DEBTOR_BANK_DETAIL', debtorBankDetails.custrecord_rdnchl_bank_prop)
                    debtorBankField.addSelectOption(JSON.parse(debtorBankDetails.custrecord_rdnchl_bank_prop))
                    const drBankBranchField = form.addField({
                        id: 'custpage_dr_bank_branch',
                        label: 'Bank Branch',
                        type: serverWidget.FieldType.SELECT
                    })
                    drBankBranchField.addSelectOption(JSON.parse(debtorBankDetails.custrecord_rdnchl_bank_branch_prop))
                    form.addField({
                        id: 'custpage_dr_bank_ac_name',
                        label: 'Account Name',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = debtorBankDetails.custrecord_rdnchl_account_name
                    form.addField({
                        id: 'custpage_dr_bank_ac_number',
                        label: 'Account Number',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = debtorBankDetails.custrecord_rdnchl_account_number
                    form.addField({
                        id: 'custpage_category_purpose',
                        label: 'category purpose',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = 'CUST'
                    form.addField({
                        id: 'custpage_batch_amount',
                        label: 'total amount',
                        type: serverWidget.FieldType.CURRENCY
                    }).defaultValue = creditTotal
                    form.addField({
                        id: 'custpage_memo',
                        label: 'memo',
                        type: serverWidget.FieldType.TEXT
                    }).defaultValue = paymentRecord.getValue('memo')
                    creditLines.forEach((creditLine, index) => {
                        const bankOption = JSON.parse(creditLine.custrecord_rdnchl_bank_prop)
                        const bankBranchOption = JSON.parse(creditLine.custrecord_rdnchl_bank_branch_prop)
                        bankField.addSelectOption(bankOption)
                        bankBranchField.addSelectOption(bankBranchOption)
                        formSublist.setSublistValue({
                            id: 'custpage_bank',
                            value: bankOption.value,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_branch',
                            value: bankBranchOption.value,
                            line: index
                        })
                        bankField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        bankBranchField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        formSublist.setSublistValue({
                            id: 'custpage_ac_name',
                            value: creditLine.custrecord_rdnchl_account_name,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_ac_number',
                            value: creditLine.custrecord_rdnchl_account_number,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_linememo',
                            value: creditLine.linememo === 'empty' ? paymentRecord.getValue('memo') + (index + 1) : creditLine.linememo,
                            line: index
                        })
                        formSublist.setSublistValue({
                            id: 'custpage_amount',
                            value: creditLine.amount,
                            line: index
                        })
                    })
                    form.addSubmitButton({label: 'Okay'})
                    //formSublist.setSublistValue({id: 'custpage_bank', line})
                    if (messageBox.hasOwnProperty('type') && messageBox.hasOwnProperty('message')) {
                        const msg = message.create(messageBox)
                        form.addPageInitMessage({message: msg})
                    } else {
                        form.addField({
                            id: 'devhtml',
                            label: 'devhtml',
                            type: serverWidget.FieldType.INLINEHTML
                        }).defaultValue = `<script>console.log('${messageBox}')</script>`
                    }
                } catch (e) {
                    log.error('GET_ERROR', e)
                }
            } else {
                try {
                    const requestParams = context.request
                    const lineCount = requestParams.getLineCount({group: 'batch_transaction'})
                    const params = {
                        paymenttype: requestParams.parameters.custpage_payment_type,
                        amount: requestParams.parameters.custpage_batch_amount,
                        purpose: requestParams.parameters.custpage_category_purpose,
                        drbank: requestParams.parameters.custpage_dr_bank,
                        drbankbranch: requestParams.parameters.custpage_dr_bank_branch,
                        draccountname: requestParams.parameters.custpage_dr_bank_ac_name,
                        draccount: requestParams.parameters.custpage_dr_bank_ac_number,
                        remarks: requestParams.parameters.custpage_memo
                    }
                    const instructions = []
                    for (let x = 0; x < lineCount; x++) {
                        instructions.push({
                            crbank: requestParams.getSublistValue({
                                group: 'batch_transaction',
                                name: 'custpage_bank',
                                line: x
                            }),
                            crbankbranch: requestParams.getSublistValue({
                                group: 'batch_transaction',
                                name: 'custpage_branch',
                                line: x
                            }),
                            craccountname: requestParams.getSublistValue({
                                group: 'batch_transaction',
                                name: 'custpage_ac_name',
                                line: x
                            }),
                            craccount: requestParams.getSublistValue({
                                group: 'batch_transaction',
                                name: 'custpage_ac_number',
                                line: x
                            }),
                            amount: requestParams.getSublistValue({
                                group: 'batch_transaction',
                                name: 'custpage_amount',
                                line: x
                            }),
                            remarks: requestParams.getSublistValue({
                                group: 'batch_transaction',
                                name: 'custpage_linememo',
                                line: x
                            })
                        })
                    }
                    params.instructions = instructions
                    const nchlTranRecord = rdmod.savenchltran({
                        relrecord: requestParams.parameters.custpage_relrecord,
                        params: params
                    })
                    if (nchlTranRecord) {
                        let tranRecord = null
                        if (requestParams.parameters.custpage_payment_type === 'CIPS') {
                            const cipsResponse = rdmod.postcipsbatch(nchlTranRecord)
                            log.debug('POSTCIPS_RESP', cipsResponse)
                            tranRecord = rdmod.updaterelrecord({
                                type: 'customrecord_nchl_transaction',
                                id: nchlTranRecord,
                                values: {custrecord_nchl_tran_response: cipsResponse.body}
                            })
                            log.debug('NCHL_TRAN_RECORD', `Record updated with response record id = ${tranRecord}`)
                        } else if (requestParams.parameters.custpage_payment_type === 'IPS') {
                            const ipsResponse = rdmod.postipsbatch(nchlTranRecord)
                            log.debug('POSTIPS_RESP', ipsResponse)
                            tranRecord = rdmod.updaterelrecord({
                                type: 'customrecord_nchl_transaction',
                                id: nchlTranRecord,
                                values: {custrecord_nchl_tran_response: ipsResponse.body}
                            })
                            log.debug('NCHL_TRAN_RECORD', `Record updated with response record id = ${tranRecord}`)
                        }

                        if(tranRecord) {
                            record.submitFields({
                                type: 'customrecord_nchl_transaction',
                                id: nchlTranRecord,
                                values: {
                                    custbody_rdnchl_paid_online: true
                                }
                            })
                            redirect.toRecord({
                                type: 'customrecord_nchl_transaction',
                                id: tranRecord
                            })
                        }
                    }

                    /*const response = rdmod.postcipsbatch('992')
                    log.debug('POSTCIPS_RESP', response)
                    form.addField({
                        id: 'custpage_dev_field',
                        label: 'dev field',
                        type: 'longtext'
                    }).defaultValue = JSON.stringify(requestParams)*/
                } catch (e) {
                    log.debug('POST_ERROR', e)
                    form.addPageInitMessage({
                        message: message.create({
                            type: message.Type.ERROR,
                            title: 'ERROR',
                            message: JSON.stringify(e)
                        })
                    })
                }
            }
            context.response.writePage({pageObject: form})
        }
    }
})