/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/record', './rdmodule', 'N/search', 'N/config', 'N/redirect', 'N/ui/message', 'N/error'], function (serverWidget, record, rdmodu, search, config, redirect, message, error) {
    // This page runs as administrator, so it only pays the record types its Pay Online button is deployed on
    const PAYABLE_TYPES = ['vendorpayment', 'vendorprepayment']

    function loadpayable(type, id) {
        if (!PAYABLE_TYPES.includes(type)) {
            throw error.create({name: 'NCHL_RECORD_TYPE', message: `Online payment is not available for ${type}`, notifyOff: true})
        }
        return record.load({type: type, id: id})
    }

    function getpaytype(tranRecord) {
        return tranRecord.getValue('custbody_nchl_payment_type') === '2' ? 'IPS' : 'CIPS'
    }

    function getpayamount(tranRecord) {
        return tranRecord.type === 'vendorpayment' ? tranRecord.getValue('total') : tranRecord.getValue('payment')
    }

    /**
     * Same conditions as the Pay Online button, checked again because this page can be opened or submitted directly
     * @returns {{title: string, message: string, activeTran: Object}|null} why the record cannot be paid
     */
    function getblockreason(tranRecord) {
        const activeTran = rdmodu.getactivenchltran(tranRecord.id)
        if (activeTran) {
            return {
                title: 'Payment already submitted',
                message: `NCHL transaction ${activeTran.name} for this record is ${activeTran.status}. Check its status instead of paying again.`,
                activeTran: activeTran
            }
        }
        if (tranRecord.getValue('custbody_rdnchl_paid_online')) {
            return {title: 'Payment already submitted', message: 'This record is already marked as paid online.'}
        }
        if (tranRecord.getValue('approvalstatus') !== '2') {
            return {title: 'Not approved', message: 'Only approved payments can be paid online.'}
        }
        return null
    }

    function writemessage(context, form, title, text) {
        form.addPageInitMessage({message: message.create({type: message.Type.WARNING, title: title, message: text})})
        context.response.writePage({pageObject: form})
    }

    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Confirm Payment Detail'})
            form.clientScriptModulePath = './suitelet_client.js'
            if (context.request.method === 'GET') {
                const tranRecord = loadpayable(context.request.parameters.recordtype, context.request.parameters.recordid)
                const blockReason = getblockreason(tranRecord)
                if (blockReason) {
                    writemessage(context, form, blockReason.title, blockReason.message)
                    return
                }
                const payType = getpaytype(tranRecord)
                form.addField({
                    id: 'custpage_parentrecord',
                    label: 'parent record',
                    type: serverWidget.FieldType.LONGTEXT,
                }).updateDisplayType({displayType: 'hidden'}).defaultValue = JSON.stringify({
                    type: tranRecord.type,
                    id: tranRecord.id
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
                    isSelected: payType === 'IPS'
                })
                ptypeField.addSelectOption({
                    value: 'CIPS',
                    text: 'Realtime Payment',
                    isSelected: payType === 'CIPS'
                })
                form.addFieldGroup({id: 'primaryinformation', label: 'PRIMARY INFORMATION'})
                // inline select on the transaction list renders as a link to the payment
                const createdFromField = form.addField({
                    id: 'custpage_created_from',
                    label: 'Created From',
                    type: serverWidget.FieldType.SELECT,
                    source: 'transaction',
                    container: 'primaryinformation'
                })
                createdFromField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                createdFromField.defaultValue = tranRecord.id
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
                    type: serverWidget.FieldType.SELECT,
                    container: 'primaryinformation'
                })
                categoryPurposeField.isMandatory = true
                Object.keys(rdmodu.categorypurposes).forEach(code => categoryPurposeField.addSelectOption({
                    value: code,
                    text: `${code} - ${rdmodu.categorypurposes[code]}`,
                    isSelected: code === 'CUST'
                }))
                form.addField({
                    id: 'custpage_amount',
                    label: 'amount',
                    type: serverWidget.FieldType.CURRENCY,
                    container: 'primaryinformation'
                }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                    .defaultValue = getpayamount(tranRecord)
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
                const bankDetailRecord = rdmodu.getcoabankdetail(coaid, payType)
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
                // The payee account is chosen here; the server reads its details again on submit (see POST)
                let canPay = true
                const isBillerPayment = tranRecord.getValue('custbody_ird_voucher_no') || tranRecord.getValue('custbody_npi_request_body')
                if (!isBillerPayment) {
                    const payeeAccounts = rdmodu.getpayeeaccounts(tranRecord.getValue('entity'), payType)
                    if (payeeAccounts.length === 0) {
                        canPay = false
                        form.addPageInitMessage({
                            message: message.create({
                                type: message.Type.WARNING,
                                title: 'No verified bank account',
                                message: `${tranRecord.getText('entity')} has no NCHL-verified ${payType === 'CIPS' ? 'real time' : 'non real time'} ` +
                                    'bank account. Add one (or open and save the existing one so NCHL verifies it), then pay again.'
                            })
                        })
                    }
                    const savedAccountId = String(tranRecord.getValue('custbody_rdnchl_bank') || '')
                    const selected = payeeAccounts.find(account => account.id === savedAccountId) ||
                        (payeeAccounts.length === 1 ? payeeAccounts[0] : null)
                    const crAccountField = form.addField({
                        id: 'custpage_cr_account',
                        label: 'Pay To Account',
                        type: serverWidget.FieldType.SELECT,
                        container: 'creditor'
                    })
                    crAccountField.isMandatory = true
                    crAccountField.addSelectOption({value: '', text: ''})
                    payeeAccounts.forEach(account => crAccountField.addSelectOption({
                        value: account.id,
                        text: `${account.bank.text} - ${account.accountNumber} (${account.accountName})`,
                        isSelected: !!selected && account.id === selected.id
                    }))
                    // read by suitelet_client.js to show the chosen account's details
                    form.addField({
                        id: 'custpage_cr_accounts',
                        label: 'payee accounts',
                        type: serverWidget.FieldType.LONGTEXT
                    }).updateDisplayType({displayType: 'hidden'}).defaultValue = JSON.stringify(payeeAccounts)
                    const crDetail = {
                        custpage_cr_bank: ['Bank', selected ? selected.bank.text : ''],
                        custpage_cr_bank_branch: ['Bank Branch', selected ? selected.branch.text : ''],
                        custpage_cr_bank_ac_name: ['Bank Account Name', selected ? selected.accountName : ''],
                        custpage_cr_bank_ac_number: ['Bank Account Number', selected ? selected.accountNumber : '']
                    }
                    Object.keys(crDetail).forEach(fieldId => {
                        form.addField({
                            id: fieldId,
                            label: crDetail[fieldId][0],
                            type: serverWidget.FieldType.TEXT,
                            container: 'creditor'
                        }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                            .defaultValue = crDetail[fieldId][1]
                    })
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
                if (canPay) {
                    form.addSubmitButton({label: 'Make Payment'})
                }
            } else if (context.request.method === 'POST') {
                const requestParams = context.request.parameters
                const parentProp = JSON.parse(requestParams.custpage_parentrecord)
                const tranRecord = loadpayable(parentProp.type, parentProp.id)
                // Re-check on submit: the form may have been opened twice or submitted twice
                const blockReason = getblockreason(tranRecord)
                if (blockReason && blockReason.activeTran) {
                    redirect.toRecord({
                        type: 'customrecord_nchl_transaction',
                        id: blockReason.activeTran.id
                    })
                    return
                }
                if (blockReason) {
                    writemessage(context, form, blockReason.title, blockReason.message)
                    return
                }
                // Amount and bank accounts come from NetSuite, not from the submitted form, so they cannot be altered in the browser
                const payType = getpaytype(tranRecord)
                const debitBank = rdmodu.getcoabankdetail(tranRecord.getValue('account'), payType)
                const purpose = rdmodu.categorypurposes.hasOwnProperty(requestParams.custpage_category_purpose)
                    ? requestParams.custpage_category_purpose : 'CUST'
                const params = {
                    paymenttype: payType,
                    amount: getpayamount(tranRecord),
                    purpose: purpose,
                    drbank: JSON.parse(debitBank.custrecord_rdnchl_bank_prop).value,
                    drbankbranch: JSON.parse(debitBank.custrecord_rdnchl_bank_branch_prop).value,
                    draccountname: debitBank.custrecord_rdnchl_account_name,
                    draccount: debitBank.custrecord_rdnchl_account_number,
                    remarks: requestParams.custpage_memo
                }
                let payeeAccount = null
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
                    // only an active, verified account of this payee and payment type is accepted
                    payeeAccount = rdmodu.getpayeeaccounts(tranRecord.getValue('entity'), payType)
                        .find(account => account.id === requestParams.custpage_cr_account)
                    if (!payeeAccount) {
                        writemessage(context, form, 'Choose a bank account',
                            'The selected account is not a verified bank account of this payee. Go back and choose another.')
                        return
                    }
                    params.crbank = payeeAccount.bank.value
                    params.crbankbranch = payeeAccount.branch.value
                    params.craccountname = payeeAccount.accountName
                    params.craccount = payeeAccount.accountNumber
                    params.endtoendid = (tranRecord.getValue('tranid') + tranRecord.getText('entity')).replace(/\s/g, '')
                }
                const relRecProp = {type: tranRecord.type, id: tranRecord.id}
                const nchlTranRecord = rdmodu.savenchltran({
                    relrecord: JSON.stringify(relRecProp),
                    params: params
                })
                if (nchlTranRecord && payeeAccount) {
                    // keep the paid-to account on the payment for audit
                    rdmodu.updaterelrecord({
                        type: relRecProp.type,
                        id: relRecProp.id,
                        values: {custbody_rdnchl_bank: payeeAccount.id}
                    })
                }
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