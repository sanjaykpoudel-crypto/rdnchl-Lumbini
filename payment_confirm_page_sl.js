/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/search', 'N/config', 'N/redirect', 'N/ui/message'], function (serverWidget, record, rdmodu, search, config, redirect, message) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Confirm Payment Detail'})
            form.clientScriptModulePath = './suitelet_client.js'
            if (context.request.method === 'GET') {
                const tranRecord = record.load({
                    type: context.request.parameters.recordtype,
                    id: context.request.parameters.recordid
                })
                const activeTran = rdmodu.getactivenchltran(context.request.parameters.recordid)
                if (tranRecord.getValue('custbody_rdnchl_paid_online') || activeTran) {
                    form.addPageInitMessage({
                        message: message.create({
                            type: message.Type.WARNING,
                            title: 'Payment already submitted',
                            message: activeTran
                                ? `NCHL transaction ${activeTran.name} for this record is ${activeTran.status}. Check its status instead of paying again.`
                                : 'This record is already marked as paid online.'
                        })
                    })
                    context.response.writePage({pageObject: form})
                    return
                }
                form.addField({
                    id: 'custpage_parentrecord',
                    label: 'parent record',
                    type: serverWidget.FieldType.LONGTEXT,
                }).updateDisplayType({displayType: 'hidden'}).defaultValue = JSON.stringify({
                    type: context.request.parameters.recordtype,
                    id: context.request.parameters.recordid
                })
                const ptypeField = form.addField({
                    id: 'custpage_ptype',
                    label: 'Payment Type',
                    type: serverWidget.FieldType.SELECT
                })
                ptypeField.updateLayoutType({layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE})
                ptypeField.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                ptypeField.addSelectOption({
                    value: 'IPS',
                    text: 'Non-Realtime Payment',
                    isSelected: context.request.parameters.ptype === 'IPS'
                })
                ptypeField.addSelectOption({
                    value: 'CIPS',
                    text: 'Realtime Payment',
                    isSelected: context.request.parameters.ptype === 'CIPS'
                })
                form.addFieldGroup({id: 'primaryinformation', label: 'PRIMARY INFORMATION'})
                form.addField({
                    id: 'custpage_document_number',
                    label: 'document number',
                    type: serverWidget.FieldType.TEXT,
                    container: 'primaryinformation'
                }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    .defaultValue = tranRecord.getValue('tranid')
                form.addField({
                    id: 'custpage_entity',
                    label: 'Entity',
                    type: serverWidget.FieldType.TEXT,
                    container: 'primaryinformation'
                }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    .defaultValue = tranRecord.getText('entity')
                form.addField({
                    id: 'custpage_memo',
                    label: 'memo',
                    type: serverWidget.FieldType.TEXT,
                    container: 'primaryinformation'
                }).defaultValue = tranRecord.getValue('memo')
                const categoryPurposeField = form.addField({
                    id: 'custpage_category_purpose',
                    label: 'category purpose',
                    type: serverWidget.FieldType.TEXT,
                    container: 'primaryinformation'
                })
                categoryPurposeField.defaultValue = 'CUST'
                form.addField({
                    id: 'custpage_amount',
                    label: 'amount',
                    type: serverWidget.FieldType.CURRENCY,
                    container: 'primaryinformation'
                }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    .defaultValue = context.request.parameters.recordtype === 'vendorpayment' ? tranRecord.getValue('total') : tranRecord.getValue('payment')
                const coaid = tranRecord.getValue('account')
                /*const coaBank = search.lookupFields({
                    type: search.Type.ACCOUNT,
                    id: coaid,
                    columns: ['custrecord_rdnchl_coa_bank_detail']
                })
                const bankRecordId = coaBank.custrecord_rdnchl_coa_bank_detail[0].value
                const bankDetailRecord = search.lookupFields({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: bankRecordId,
                    columns: [
                        'custrecord_nchl_bank_type',
                        'custrecord_rdnchl_bank_prop',
                        'custrecord_rdnchl_bank_branch_prop',
                        'custrecord_rdnchl_account_name',
                        'custrecord_rdnchl_account_number'
                    ]
                })*/
                const bankType = context.request.parameters.ptype
                const bankDetailRecord = rdmodu.getcoabankdetail(coaid, bankType)
                form.addFieldGroup({
                    id: 'debtor',
                    label: 'DEBIT DETAIL'
                })
                const drBankField = form.addField({
                    id: 'custpage_dr_bank',
                    label: 'Debit Bank',
                    type: serverWidget.FieldType.SELECT,
                    container: 'debtor'
                })
                drBankField.addSelectOption(JSON.parse(bankDetailRecord.custrecord_rdnchl_bank_prop))
                const drBankBranchField = form.addField({
                    id: 'custpage_dr_bank_branch',
                    label: 'Bank Branch',
                    type: serverWidget.FieldType.SELECT,
                    container: 'debtor'
                })
                drBankBranchField.addSelectOption(JSON.parse(bankDetailRecord.custrecord_rdnchl_bank_branch_prop))
                const drBankAccountNameField = form.addField({
                    id: 'custpage_dr_bank_ac_name',
                    label: 'Bank Account Name',
                    type: serverWidget.FieldType.TEXT,
                    container: 'debtor'
                })
                drBankAccountNameField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                drBankAccountNameField.defaultValue = bankDetailRecord.custrecord_rdnchl_account_name
                const drBankAccountNumberField = form.addField({
                    id: 'custpage_dr_bank_ac_number',
                    label: 'Bank Account Number',
                    type: serverWidget.FieldType.TEXT,
                    container: 'debtor'
                })
                drBankAccountNumberField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                drBankAccountNumberField.defaultValue = bankDetailRecord.custrecord_rdnchl_account_number
                form.addFieldGroup({
                    id: 'creditor',
                    label: 'CREDIT DETAIL'
                })
                const crBankRecordId = tranRecord.getValue('custbody_rdnchl_bank')
                if (crBankRecordId) {
                    const crBankDetail = rdmodu.getbankdetail(crBankRecordId)
                    const crBankField = form.addField({
                        id: 'custpage_cr_bank',
                        label: 'credit bank',
                        type: serverWidget.FieldType.SELECT,
                        container: 'creditor'
                    })
                    crBankField.addSelectOption(JSON.parse(crBankDetail.custrecord_rdnchl_bank_prop))
                    const crBankBranchField = form.addField({
                        id: 'custpage_cr_bank_branch',
                        label: 'Bank Branch',
                        type: serverWidget.FieldType.SELECT,
                        container: 'creditor'
                    })
                    crBankBranchField.addSelectOption(JSON.parse(crBankDetail.custrecord_rdnchl_bank_branch_prop))
                    form.addField({
                        id: 'custpage_cr_bank_ac_name',
                        label: 'Bank Account Name',
                        type: serverWidget.FieldType.TEXT,
                        container: 'creditor'
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = crBankDetail.custrecord_rdnchl_account_name
                    form.addField({
                        id: 'custpage_cr_bank_ac_number',
                        label: 'bank account number',
                        type: serverWidget.FieldType.TEXT,
                        container: 'creditor'
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = crBankDetail.custrecord_rdnchl_account_number
                }
                const irdVoucher = tranRecord.getValue({fieldId: 'custbody_ird_voucher_no'})
                const docReqBody = tranRecord.getValue({fieldId: 'custbody_npi_request_body'})
                const appId = rdmodu.getappid(tranRecord.getValue('entity'))
                if (irdVoucher || docReqBody) {
                    try {
                        let docDetail
                        if (docReqBody) {
                            form.addField({
                                id: 'custpage_doc_detail',
                                label: 'doc detail',
                                type: serverWidget.FieldType.LONGTEXT
                            })
                                //.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                                .defaultValue = docReqBody
                            docDetail = JSON.parse(docReqBody)
                            form.addField({
                                id: 'custpage_reg_year',
                                label: 'registration year',
                                type: serverWidget.FieldType.TEXT,
                                container: 'creditor'
                            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                                .defaultValue = docDetail.addenda3
                            form.addField({
                                id: 'custpage_reg_serial',
                                label: 'registration serial',
                                type: serverWidget.FieldType.TEXT,
                                container: 'creditor'
                            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                                .defaultValue = docDetail.freeText1
                            form.addField({
                                id: 'custpage_company_code',
                                label: 'company code',
                                type: serverWidget.FieldType.TEXT,
                                container: 'creditor'
                            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                                .defaultValue = docDetail.freeText2
                        }
                        form.addField({
                            id: 'custpage_refid',
                            label: irdVoucher ? 'Voucher No' : 'registration number',
                            type: 'text',
                            container: 'creditor'
                        }).updateDisplayType({displayType: 'inline'})
                            .defaultValue = irdVoucher ? irdVoucher : docDetail.refId
                        form.addField({
                            id: 'custpage_appid',
                            label: 'app id',
                            type: 'text',
                            container: 'creditor',
                        }).updateDisplayType({displayType: 'inline'})
                            .defaultValue = irdVoucher ? appId : docDetail.appId
                        if (irdVoucher) {
                            const companyInformation = config.load({
                                type: config.Type.COMPANY_INFORMATION
                            })
                            form.addField({
                                id: 'custpage_particulars',
                                label: 'Tax Payer Name',
                                type: 'text',
                                container: 'creditor'
                            }).updateDisplayType({displayType: 'inline'}).defaultValue = companyInformation.getValue('legalname')
                        }
                    } catch (e) {
                        log.error({title: 'ERROR', details: e})
                    }
                }
                form.addSubmitButton({label: 'Make Payment'})
            } else if (context.request.method === 'POST') {
                const requestParams = context.request.parameters
                // Re-check on submit: the form may have been opened twice or submitted twice
                const activeTran = rdmodu.getactivenchltran(JSON.parse(requestParams.custpage_parentrecord).id)
                if (activeTran) {
                    redirect.toRecord({
                        type: 'customrecord_nchl_transaction',
                        id: activeTran.id
                    })
                    return
                }
                const params = {
                    paymenttype: requestParams.custpage_ptype,
                    amount: requestParams.custpage_amount,
                    purpose: requestParams.custpage_category_purpose,
                    drbank: requestParams.custpage_dr_bank,
                    drbankbranch: requestParams.custpage_dr_bank_branch,
                    draccountname: requestParams.custpage_dr_bank_ac_name,
                    draccount: requestParams.custpage_dr_bank_ac_number,
                    remarks: requestParams.custpage_memo
                }
                if (requestParams.hasOwnProperty('custpage_appid') && requestParams.hasOwnProperty('custpage_particulars')) {
                    params.billertype = 'IRD' //Inland Revenue Department
                    params.appId = requestParams.custpage_appid
                    params.refId = requestParams.custpage_refid
                    params.particulars = requestParams.custpage_particulars
                } else if (requestParams.hasOwnProperty('custpage_appid') && requestParams.hasOwnProperty('custpage_doc_detail')) {
                    const docDetail = JSON.parse(requestParams.custpage_doc_detail)
                    params.billertype = 'DOC' //Department of Custom
                    params.appId = requestParams.custpage_appid
                    params.refId = requestParams.custpage_refid
                    params.addenda3 = docDetail.addenda3
                    params.freeText1 = docDetail.freeText1
                    params.freeText2 = docDetail.freeText2
                    params.freeCode1 = docDetail.freeCode1
                    params.freeCode2 = docDetail.freeCode2
                } else {
                    params.crbank = requestParams.custpage_cr_bank
                    params.crbankbranch = requestParams.custpage_cr_bank_branch
                    params.craccountname = requestParams.custpage_cr_bank_ac_name
                    params.craccount = requestParams.custpage_cr_bank_ac_number
                  params.endtoendid = (requestParams.custpage_document_number + requestParams.custpage_entity).replace(/\s/g, '')
                }
                const nchlTranRecord = rdmodu.savenchltran({
                    relrecord: requestParams.custpage_parentrecord,
                    params: params
                })
                const relRecProp = JSON.parse(requestParams.custpage_parentrecord)
                if (nchlTranRecord && params.hasOwnProperty('refId') && params.hasOwnProperty('appId')) {
                    const lodgeResponse = rdmodu.processbill({nchltranrecid: nchlTranRecord, reqtype: 'lodge'})
                    const devhtmlfield = form.addField({
                        id: 'custpage_dev_html',
                        label: 'dev html field',
                        type: serverWidget.FieldType.INLINEHTML
                    })

                    const lodgeAccepted = lodgeResponse.processconfirm ||
                        (lodgeResponse.responseResult && lodgeResponse.responseResult.responseCode === '000')
                    // confirmbillpay.do must be called only once per lodged bill
                    const billResponse = lodgeAccepted
                        ? rdmodu.processbill({nchltranrecid: nchlTranRecord, reqtype: 'confirm'})
                        : lodgeResponse
                    devhtmlfield.defaultValue = `<p>${JSON.stringify(billResponse)}</p>`
                    rdmodu.updaterelrecord({
                        type: 'customrecord_nchl_transaction',
                        id: nchlTranRecord,
                        values: {custrecord_nchl_tran_response: JSON.stringify(billResponse)}
                    })
                    if (lodgeAccepted && billResponse.responseResult && billResponse.responseResult.responseCode === '000') {
                        relRecProp.values = {custbody_rdnchl_paid_online: true}
                        rdmodu.updaterelrecord(relRecProp)
                    }
                } else if (nchlTranRecord) {
                    let response = {type: 'nothing', resp: null}
                    if (params.paymenttype === 'CIPS') {
                        const cipsResponse = rdmodu.postcipsbatch(nchlTranRecord)
                        response.type = 'CIPS'
                        response.resp = cipsResponse
                        // postcipsbatch returns a string when the request itself failed
                        const responseText = typeof cipsResponse === 'string' ? cipsResponse : cipsResponse.body
                        // Save the response first so it is never lost, even if NCHL rejected the batch
                        rdmodu.updaterelrecord({
                            type: 'customrecord_nchl_transaction',
                            id: nchlTranRecord,
                            values: {custrecord_nchl_tran_response: responseText}
                        })
                        if (rdmodu.gettranstatus(responseText).status === 'SUCCESS') {
                            relRecProp.values = {custbody_rdnchl_paid_online: true}
                            rdmodu.updaterelrecord(relRecProp)
                        }
                    } else if (params.paymenttype === 'IPS') {
                        const ipsResponse = rdmodu.postipsbatch(nchlTranRecord)
                        response.type = 'ISP'
                        response.resp = ipsResponse
                        rdmodu.updaterelrecord({
                            type: 'customrecord_nchl_transaction',
                            id: nchlTranRecord,
                            values: {custrecord_nchl_tran_response: typeof ipsResponse === 'string' ? ipsResponse : ipsResponse.body}
                        })
                    }
                }
                if (nchlTranRecord) {
                    redirect.toRecord({
                        type: 'customrecord_nchl_transaction',
                        id: nchlTranRecord
                    })
                }
                /*form.addField({
                    id: 'rdtempresult',
                    label: 'temp result field',
                    type: serverWidget.FieldType.LONGTEXT
                }).defaultValue = JSON.stringify(params)*/
                /*if (nchlTranRecord) {
                    rdmodu.postipsbatch(nchlTranRecord)
                }*/
            }
            context.response.writePage({pageObject: form})
        }
    }
})