/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', './rdmodule', 'N/record', 'N/search', 'N/ui/message'], function (serverWidget, rdmodu, record, search, message) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({title: 'Payment Detail', hideNavBar: true})
            const appIdField = form.addField({
                id: 'custpage_appid',
                label: 'APP ID',
                type: serverWidget.FieldType.TEXT
            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
            const memoField = form.addField({
                id: 'custpage_memo',
                label: 'memo',
                type: serverWidget.FieldType.TEXT
            })
            const bankField = form.addField({
                id: 'custpage_bank',
                label: 'Bank',
                type: serverWidget.FieldType.SELECT
            })
            const bankBranchField = form.addField({
                id: 'custpage_bank_branch',
                label: 'Bank Branch',
                type: serverWidget.FieldType.SELECT
            })
            const bankAcNameField = form.addField({
                id: 'custpage_bank_ac_name',
                label: 'Account Name',
                type: serverWidget.FieldType.TEXT
            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
            const bankAcNoField = form.addField({
                id: 'custpage_bank_ac_no',
                label: 'Account Number',
                type: serverWidget.FieldType.TEXT
            }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
            const registrationNoField = form.addField({
                id: 'custpage_doc_reg_no',
                label: 'Registration number',
                type: serverWidget.FieldType.TEXT
            })
            const serialField = form.addField({
                id: 'custpage_doc_reg_serial',
                label: 'Registration serial',
                type: serverWidget.FieldType.SELECT
            })
            let selectedM = false, selectedX = false
            if (context.request.parameters.hasOwnProperty('custpage_doc_reg_serial')) {
                context.request.parameters.custpage_doc_reg_serial === 'X' ? selectedX = true : selectedM = true
            }
            serialField.addSelectOption({value: 'M', text: 'M', isSelected: selectedM})
            serialField.addSelectOption({value: 'X', text: 'X', isSelected: selectedX})
            const registrationYear = form.addField({
                id: 'custpage_doc_reg_year',
                label: 'Registration Year',
                type: serverWidget.FieldType.TEXT
            })
            if (context.request.method === 'GET') {
                /*const entityRecord = search.lookupFields({
                    type: search.Type.VENDOR,
                    id: context.request.parameters.entityId,
                    columns: 'custentity_rec_vendor_department'
                })
                const vendDepart = JSON.parse(entityRecord.custentity_rec_vendor_department)*/
                appIdField.defaultValue = context.request.parameters.appid
                memoField.defaultValue = context.request.parameters.recmemo
                bankField.addSelectOption(JSON.parse(context.request.parameters.bankProp))
                bankBranchField.addSelectOption(JSON.parse(context.request.parameters.bankBranchProp))
                bankAcNameField.defaultValue = context.request.parameters.accountName
                bankAcNoField.defaultValue = context.request.parameters.accountNumber
                form.addSubmitButton({label: 'Continue'})
                context.response.writePage(form)
            } else if (context.request.method === 'POST') {
                if (context.request.parameters.hasOwnProperty('custpage_instance_id') && context.request.parameters.hasOwnProperty('custpage_post_entry_no')) {
                    let dooer = '<script>'
                    dooer += `window.opener.nlapiSetFieldValue("custbody_npi_request_body",${JSON.stringify(context.request.parameters.custpage_npi_request_body)});`
                    dooer += `window.opener.nlapiSetCurrentLineItemValue("expense","amount", ${context.request.parameters.custpage_tax_amount});`
                    dooer += `window.close();`
                    dooer += '</script>'
                    context.response.write({output: dooer});
                } else {
                    const nowDate = new Date()
                    const batchId = nowDate.getTime()
                    const params = {
                        batchid: batchId,
                        purpose: 'ECPG',
                        drbank: context.request.parameters.custpage_bank,
                        drbankbranch: context.request.parameters.custpage_bank_branch,
                        draccountname: context.request.parameters.custpage_bank_ac_name,
                        draccount: context.request.parameters.custpage_bank_ac_no,
                        etoeid: context.request.parameters.custpage_memo,
                        appId: context.request.parameters.custpage_appid,
                        refId: context.request.parameters.custpage_doc_reg_no,
                        addenda3: context.request.parameters.custpage_doc_reg_year,
                        freeText1: context.request.parameters.custpage_doc_reg_serial,
                        freeText2: '',
                        freeCode1: '',
                        freeCode2: ''
                    }
                    const docDetail = rdmodu.getdocdetail(params)
                    // getdocdetail returns a plain string when the request could not be made
                    const docError = typeof docDetail === 'string' || !docDetail.data
                        ? (typeof docDetail === 'string' ? docDetail : JSON.stringify(docDetail))
                        : (docDetail.data.responseCode === '015' ? docDetail.data.responseDescription : '')
                    if (docError) {
                        // message.show() only works in the browser; on the server the message is added to the page
                        form.addPageInitMessage({
                            message: message.create({
                                type: message.Type.ERROR,
                                title: 'DOC detail not available',
                                message: docError
                            })
                        })
                        context.response.writePage(form)
                        return
                    }
                    appIdField.defaultValue = context.request.parameters.custpage_appid
                    memoField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE}).defaultValue = context.request.parameters.custpage_memo
                    bankField.addSelectOption({
                        value: context.request.parameters.custpage_bank,
                        text: context.request.parameters.inpt_custpage_bank
                    })
                    bankBranchField.addSelectOption({
                        value: context.request.parameters.custpage_bank_branch,
                        text: context.request.parameters.inpt_custpage_bank_branch,
                    })
                    serialField.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                    bankAcNameField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE}).defaultValue = context.request.parameters.custpage_bank_ac_name
                    bankAcNoField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE}).defaultValue = context.request.parameters.custpage_bank_ac_no
                    registrationNoField.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE}).defaultValue = context.request.parameters.custpage_doc_reg_no
                    registrationYear.updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE}).defaultValue = context.request.parameters.custpage_doc_reg_year
                    form.addField({
                        id: 'custpage_company_code',
                        label: 'company code',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = docDetail.data.companyCode
                    form.addField({
                        id: 'custpage_company_name',
                        label: 'company name',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = docDetail.data.companyName
                    form.addField({
                        id: 'custpage_saddetail',
                        label: 'SAD Detail',
                        type: serverWidget.FieldType.TEXT
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = `${docDetail.data.officeCode}${docDetail.data.regYear}${docDetail.data.regSerial}${docDetail.data.regNumber}`
                    form.addField({
                        id: 'custpage_instance_id',
                        label: 'instance id',
                        type: serverWidget.FieldType.TEXT
                    })
                        //.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                        .defaultValue = docDetail.data.instanceId
                    form.addField({
                        id: 'custpage_post_entry_no',
                        label: 'post entry no',
                        type: serverWidget.FieldType.TEXT
                    })
                        //.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                        .defaultValue = docDetail.data.postEntryNo
                    form.addField({
                        id: 'custpage_tax_amount',
                        label: 'payable tax amount',
                        type: serverWidget.FieldType.CURRENCY
                    }).updateDisplayType({displayType: serverWidget.FieldDisplayType.INLINE})
                        .defaultValue = docDetail.data.amountToBePaid
                    params.freeText2 = docDetail.data.companyCode
                    params.freeCode1 = docDetail.data.instanceId.toString()
                    params.freeCode2 = docDetail.data.postEntryNo
                    form.addField({
                        id: 'custpage_npi_request_body',
                        label: 'npi request body',
                        type: serverWidget.FieldType.LONGTEXT
                    }).defaultValue = JSON.stringify(params)
                    form.addSubtab({id: 'custpage_tax_detail', label: 'TAX DETAIL'})
                    const taxSublist = form.addSublist({
                        id: 'custpage_tax_list',
                        label: 'tax list',
                        type: serverWidget.SublistType.LIST,
                        tab: 'custpage_tax_detail'
                    })
                    taxSublist.addField({
                        id: 'taxcode',
                        label: 'tax code',
                        type: serverWidget.FieldType.TEXT
                    })
                    taxSublist.addField({
                        id: 'taxname',
                        label: 'tax name',
                        type: serverWidget.FieldType.TEXT
                    })
                    taxSublist.addField({
                        id: 'taxamount',
                        label: 'tax amount',
                        type: serverWidget.FieldType.CURRENCY
                    })
                    docDetail.data.taxes.forEach((tax, index) => {
                        taxSublist.setSublistValue({id: 'taxcode', value: tax.members.taxCode, line: index})
                        taxSublist.setSublistValue({id: 'taxname', value: tax.members.taxName, line: index})
                        taxSublist.setSublistValue({id: 'taxamount', value: tax.members.taxAmount, line: index})
                    })
                    form.addSubmitButton({label: 'Done'})
                    /*form.addField({
                        id: 'custpage_xyd',
                        label: 'dfadf',
                        type: 'longtext'
                    }).defaultValue = JSON.stringify(docDetail)*/
                    context.response.writePage(form)
                }
            }
        }
    }
})