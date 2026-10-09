/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['./rdmodule', 'N/record'], function (rdmodu, record) {
    return {
        beforeLoad: context => {
            if (context.newRecord.type === 'vendor') {
                const form = context.form
                const vendorTypeField = form.addField({
                    id: 'custpage_vendor_type',
                    label: 'vendor type',
                    type: 'select'
                })
                const vendorSubTypeField = form.addField({
                    id: 'custpage_vendor_sub_type',
                    label: 'vendor subtype',
                    type: 'select'
                })
                const vendorDepartField = form.addField({
                    id: 'custpage_vendor_depart',
                    label: 'vendor department',
                    type: 'select'
                })
                form.insertField({
                    field: vendorTypeField,
                    nextfield: 'entityid'
                })
                form.insertField({
                    field: vendorSubTypeField,
                    nextfield: 'entityid'
                })
                form.insertField({
                    field: vendorDepartField,
                    nextfield: 'entityid'
                })
                vendorTypeField.addSelectOption({value: '', text: ''})
                vendorTypeField.addSelectOption({value: 'GOVT', text: 'Government Payment'})
                vendorTypeField.addSelectOption({value: 'INSU', text: 'Insurance Company'})
                if (context.type === 'create') {
                } else if (context.type === 'edit') {
                    const ventypeVal = context.newRecord.getValue('custentity_rec_vendor_type')
                    /*context.form.addField({
                        id: 'custpage_temphtml',
                        label: 'temp html',
                        type: 'inlinehtml'
                    }).defaultValue = `<script>console.log('${typeoption.value !== ''}')</script>`*/
                    if (ventypeVal) {
                        const subtypeval = context.newRecord.getValue('custentity_rec_vendor_subtype')
                        const compval = context.newRecord.getValue('custentity_rec_vendor_department')
                        const typeoption = JSON.parse(ventypeVal)
                        const vensubtypeVal = subtypeval ? JSON.parse(subtypeval) : [{value: '', text: ''}]
                        const vendepartVal = compval ? JSON.parse(compval) : [{value: '', text: ''}]
                        if (typeoption.value) {
                            vendorTypeField.defaultValue = typeoption.value
                            const subtypes = rdmodu.getbillertypes(typeoption.value)
                            const isApp = subtypes.filter(subtype => subtype.type === 'APP')
                            const tempArray = []
                            if (isApp.length > 0) {
                                vendorSubTypeField.updateDisplayType({displayType: 'disabled'})
                                vendorDepartField.addSelectOption({value: '', text: ''})
                                subtypes.forEach(elm => {
                                    tempArray.push({
                                        value: elm.code,
                                        text: elm.labelText,
                                        isSelected: elm.code === vendepartVal.value && elm.labelText === vendepartVal.text
                                    })
                                    vendorDepartField.addSelectOption({
                                        value: elm.code,
                                        text: elm.labelText,
                                        isSelected: elm.labelText === 'IRD'
                                    })
                                })
                            } else {
                                vendorSubTypeField.addSelectOption({value: '', text: ''})
                                subtypes.forEach(elm => {
                                    vendorSubTypeField.addSelectOption({
                                        value: elm.code,
                                        text: elm.labelText,
                                        isSelected: vensubtypeVal.value === elm.code
                                    })
                                })
                                const departments = rdmodu.getbillertypes(vensubtypeVal.value)
                                vendorDepartField.addSelectOption({value: '', text: ''})
                                /*departments.forEach(elm => {
                                    vendorDepartField.addSelectOption({
                                        value: elm.code,
                                        text: elm.labelText,
                                        isSelected: elm.code === vendepartVal.value
                                    })
                                })*/
                            }
                            form.addField({
                                id: 'custpage_temphtml',
                                label: 'temphtml',
                                type: 'inlinehtml'
                            }).defaultValue = `<script>console.log('${JSON.stringify(tempArray)}')</script>`
                        }
                    }
                } else if (context.type === 'view') {
                    const ventypeVal = context.newRecord.getValue('custentity_rec_vendor_type')
                    if (ventypeVal) {
                        const typeoption = JSON.parse(ventypeVal)
                        vendorTypeField.defaultValue = typeoption.value
                    }
                    const vensubtypeVal = context.newRecord.getValue('custentity_rec_vendor_subtype')
                    if (vensubtypeVal) {
                        const subtypeoption = JSON.parse(vensubtypeVal)
                        subtypeoption.isSelected = true
                        vendorSubTypeField.addSelectOption(subtypeoption)
                    }
                    const vendepartVal = context.newRecord.getValue('custentity_rec_vendor_department')
                    if (vendepartVal) {
                        const vendepoption = JSON.parse(vendepartVal)
                        vendepoption.isSelected = true
                        vendorDepartField.addSelectOption(vendepoption)
                    }
                }
            }
        },
        beforeSubmit: context => {
            if (context.type === 'edit') {
                const selectedType = context.newRecord.getValue('custpage_vendor_type')
                const recordVendType = context.newRecord.getValue('custentity_rec_vendor_type')
                if (recordVendType && selectedType === '') {
                    context.newRecord.setValue({fieldId: 'custentity_rec_vendor_type', value: ''})
                }
                const selectedSubType = context.newRecord.getValue('custpage_vendor_sub_type')
                const recordVendSubType = context.newRecord.getValue('custentity_rec_vendor_subtype')
                if (recordVendSubType && selectedSubType === '') {
                    context.newRecord.setValue({fieldId: 'custentity_rec_vendor_subtype', value: ''})
                }
                const selectedCompany = context.newRecord.getValue('custpage_vendor_depart')
                const recordVendCompany = context.newRecord.getValue('custentity_rec_vendor_department')
                if (recordVendCompany && selectedCompany === '') {
                    context.newRecord.setValue({fieldId: 'custentity_rec_vendor_department', value: ''})
                }
            }
        },
        afterSubmit: context => {
            try {
                const nchlBankRecord = context.newRecord.getValue('custentity_entity_bank_detail')
                if (nchlBankRecord) {
                    nchlBankRecord.forEach(entityBank => {
                        log.debug('ENTITY_REL_NCHL_BANK', entityBank)
                        record.submitFields({
                            type: 'customrecord_rd_nchl_bank_detail',
                            id: entityBank,
                            values: {
                                'custrecord_nchl_bank_entity': context.newRecord.id
                            }
                        })
                    })

                }

            } catch (e) {
                log.error('error__', e)
            }
        }
    }
})