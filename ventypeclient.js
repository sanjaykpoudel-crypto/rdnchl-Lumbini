/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['./rdmoduleclient'], function (rdmodc) {
    return {
        fieldChanged: function (context) {
            console.log(context.fieldId)
            const subTypeList = []
            if (context.fieldId === 'custpage_vendor_type') {
                var subTypeField = context.currentRecord.getField({fieldId: 'custpage_vendor_sub_type'})
                subTypeField.removeSelectOption({value: null})
                subTypeField.insertSelectOption({value: '', text: ''})
                var departField = context.currentRecord.getField({fieldId: 'custpage_vendor_depart'})
                departField.removeSelectOption({value: null})
                departField.insertSelectOption({value: '', text: ''})
                var vendorType = context.currentRecord.getValue(context.fieldId)
                console.log('Type = ', vendorType)
                context.currentRecord.setValue({
                    fieldId: 'custentity_rec_vendor_type',
                    value: JSON.stringify({
                        value: vendorType,
                        text: context.currentRecord.getText(context.fieldId)
                    })
                })
                var subTypes = rdmodc.getbillers(vendorType)
                console.log(subTypes)
                const isAppList = subTypes.filter(function (subtype){
                    return subtype.type === 'APP'
                })
                if (isAppList.length > 0) {
                    //subTypeField.isDisabled = true
                    const venDeprtField = context.currentRecord.getField({fieldId: 'custpage_vendor_depart'})
                    venDeprtField.removeSelectOption({value: null})
                    venDeprtField.insertSelectOption({value: '', text: ''})
                    subTypes.forEach(function (subtype) {
                        venDeprtField.insertSelectOption({
                            value: subtype.code,
                            text: subtype.labelText
                        })
                    })
                } else {
                    //subTypeField.isDisabled = !subTypeField.isDisabled
                    subTypes.forEach(function (subtype) {
                        subTypeField.insertSelectOption({
                            value: subtype.code,
                            text: subtype.labelText
                        })
                    })
                }
            } else if (context.fieldId === 'custpage_vendor_sub_type') {
                var subtypeval = context.currentRecord.getValue(context.fieldId)
                console.log(subtypeval)
                if (subtypeval) {
                    context.currentRecord.setValue({
                        fieldId: 'custentity_rec_vendor_subtype',
                        value: JSON.stringify({
                            value: context.currentRecord.getValue(context.fieldId),
                            text: context.currentRecord.getText(context.fieldId)
                        })
                    })
                    departments = rdmodc.getbillers(subtypeval)
                    const comField = context.currentRecord.getField({fieldId: 'custpage_vendor_depart'})
                    comField.removeSelectOption({value: null})
                    comField.insertSelectOption({value: '', text: ''})
                    departments.forEach(function (department) {
                        comField.insertSelectOption({
                            value: department.code,
                            text: department.labelText
                        })
                    })
                }
            } else if (context.fieldId === 'custpage_vendor_depart') {
                context.currentRecord.setValue({
                    fieldId: 'companyname',
                    value: context.currentRecord.getText(context.fieldId)
                })
                context.currentRecord.setValue({
                    fieldId: 'custentity_rec_vendor_department',
                    value: JSON.stringify({
                        value: context.currentRecord.getValue(context.fieldId),
                        text: context.currentRecord.getText(context.fieldId)
                    })
                })
            }
        }
    }
})