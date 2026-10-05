/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/search', './rdmodule'], function (search, rdmodu) {
    return {
        beforeLoad: context => {
            if (context.type === 'create' || context.type === 'edit') {
                const entity = context.newRecord.getValue('entity')
                if (entity) {
                    const vendet = search.lookupFields({
                        type: search.Type.VENDOR,
                        id: entity,
                        columns: ['custentity_rec_vendor_department']
                    })
                    if (vendet.custentity_rec_vendor_department !== '') {
                        const vendDepDet = JSON.parse(vendet.custentity_rec_vendor_department)
                        if (vendDepDet.value !== '' && vendDepDet.value === 'DOC-FORM') {
                            context.form.clientScriptModulePath = './get_ird_detail_cs.js'
                            const docOfficeField = context.form.addField({
                                id: 'custpage_doc_office',
                                label: 'DOC Office',
                                type: 'select'
                            })
                            docOfficeField.addSelectOption({value: '', text: ''})
                            const docOfficeList = rdmodu.getdocofficelist(vendDepDet.value)
                            log.debug('DOC_LIST', docOfficeList)
                            docOfficeList.forEach(docOffice => {
                                docOfficeField.addSelectOption({
                                    value: docOffice.value,
                                    text: docOffice.option
                                })
                            })
                            context.form.insertField({
                                field: docOfficeField,
                                nextfield: 'account'
                            })
                            const bankAccField = context.form.addField({
                                id: 'custpage_nchl_bank_ac',
                                label: 'Bank Account',
                                type: 'select',
                            })
                            bankAccField.addSelectOption({value: '', text: ''})
                            context.form.insertField({
                                field: bankAccField,
                                nextfield: 'account'
                            })
                            search.create({
                                type: search.Type.ACCOUNT,
                                filters: ['type', 'anyof', 'Bank'],
                                columns: ['displayname']
                            }).run().each(result => {
                                bankAccField.addSelectOption({value: result.id, text: result.getValue('displayname')})
                                return true
                            })

                            context.form.addButton({
                                id: 'custpage_get_ird_det',
                                label: 'DOC Detail',
                                functionName: 'getirdpaymentdetail'
                            })
                        }
                    }
                }
            } else if (context.type === 'view') {
                const docOfficeVal = context.newRecord.getValue('custbody_doc_office')
                if (docOfficeVal) {
                    const docOfficeField = context.form.addField({
                        id: 'custpage_doc_office',
                        label: 'DOC Office',
                        type: 'select'
                    })
                    const docOfficeOption = JSON.parse(docOfficeVal)
                    docOfficeOption.isSelected = true
                    docOfficeField.addSelectOption(docOfficeOption)
                    context.form.insertField({
                        field: docOfficeField,
                        nextfield: 'account'
                    })
                }
            }
        },
        beforeSubmit: context => {
            const docOfficeValue = context.newRecord.getValue('custpage_doc_office')
            if (docOfficeValue) {
                const docOffice = {
                    value: docOfficeValue,
                    text: context.newRecord.getText('custpage_doc_office')
                }
                log.debug('TEMP_FIELD_VAL', docOffice)
                context.newRecord.setValue({fieldId: 'custbody_doc_office', value: JSON.stringify(docOffice)})
            }
        }
    }
})