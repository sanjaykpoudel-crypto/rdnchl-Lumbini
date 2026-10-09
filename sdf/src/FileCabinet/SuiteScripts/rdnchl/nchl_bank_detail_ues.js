/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', './rdmodule', 'N/error'], function (serverWidget, rdmodu, error) {
    const ACCOUNT_FIELDS = ['custrecord_rdnchl_bank_prop', 'custrecord_rdnchl_account_number', 'custrecord_rdnchl_account_name']

    /**
     * Server-side NCHL account check, so the verified flag cannot be ticked by hand or skipped by
     * imports and scripts. Runs when the account details change or the record is not verified yet.
     */
    function verifyaccount(context) {
        const rec = context.newRecord
        const old = context.oldRecord
        const changed = !old || ACCOUNT_FIELDS.some(fieldId => String(old.getValue(fieldId)) !== String(rec.getValue(fieldId)))
        if (!changed && old.getValue('custrecord_nchl_account_verified')) {
            return
        }
        const bankProp = JSON.parse(rec.getValue('custrecord_rdnchl_bank_prop') || '{}')
        const accountNumber = rec.getValue('custrecord_rdnchl_account_number')
        const accountName = rec.getValue('custrecord_rdnchl_account_name')
        const result = rdmodu.verifyaccount({bankId: bankProp.value, accountNumber: accountNumber, accountName: accountName})
        log.audit('NCHL_ACCOUNT_VERIFY', {account: accountNumber, match: result.matchPercentate})
        if (result.matchPercentate !== 100) {
            throw error.create({
                name: 'NCHL_ACCOUNT_NOT_VERIFIED',
                message: `NCHL could not verify account ${accountNumber} (${accountName}) at ${bankProp.text}: ` +
                    (result.responseMessage || `name match ${result.matchPercentate}%`),
                notifyOff: true
            })
        }
        rec.setValue({fieldId: 'custrecord_nchl_account_verified', value: true})
    }

    return {
        beforeLoad: context => {
            const form = context.form
          // const verifybtn = form.addButton({
          //       id: 'custpage_verify_btn',
          //       label: 'verify',
          //       functionName: 'verifyaccount'
          //     })
          //form.clientScriptModulePath = './nchl_bank_detail_csdep.js'
            if (context.type === 'create') {
                const nameField = form.getField({id: 'name'})
                nameField.updateDisplayType({displayType: serverWidget.FieldDisplayType.DISABLED})
                nameField.defaultValue = 'To Be Generated'
                nameField.label = 'Record Name'
            }
            if (context.type === 'create' || context.type === 'edit') {
                if (context.hasOwnProperty('request') && context.request) {
                    //log.debug({title: 'from_console', details: context.request})
                    const requestParam = context.request.parameters
                    form.addField({
                        id: 'custpage_trigger_events',
                        label: 'trigger events',
                        type: serverWidget.FieldType.CHECKBOX
                    })
                        .updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN})
                        .defaultValue = requestParam.target === 'main:custrecord_rdnchl_coa_bank_detail' ? 'F' : 'T'
                    //log.debug({title: 'req_param', details: requestParam})
                    /*if (requestParam.hasOwnProperty('target')) {
                        context.newRecord.setValue({
                            fieldId: 'custrecord_nchl_account_verified',
                            value: requestParam.target === 'main:custrecord_rdnchl_coa_bank_detail' || requestParam.target === 'main:custrecord_ips_bank'
                        })
                    }*/
                }
                const bankTypeField = form.addField({
                    id: 'custpage_nchl_bank_type',
                    label: 'Bank Type',
                    type: serverWidget.FieldType.SELECT
                })
                form.insertField({
                    field: bankTypeField,
                    nextfield: 'name'
                })
                bankTypeField.addSelectOption({value: '', text: ''})
                bankTypeField.addSelectOption({value: 'CIPS', text: 'Real Time'})
                bankTypeField.addSelectOption({value: 'IPS', text: 'Non Real Time'})
                const bankField = form.addField({
                    id: 'custpage_nchl_bank',
                    label: 'NCHL BANK',
                    type: serverWidget.FieldType.SELECT
                })
                form.insertField({
                    field: bankField,
                    nextfield: 'name'
                })
                bankField.isMandatory = true
                const bankBranchField = form.addField({
                    id: 'custpage_nchl_bank_branch',
                    label: 'Branch',
                    type: 'select'
                })
                form.insertField({
                    field: bankBranchField,
                    nextfield: 'name'
                })
                //bankBranchField.isMandatory = true
                if (context.type === 'edit') {
                    const selectedBankType = context.newRecord.getValue('custrecord_nchl_bank_type')
                    bankTypeField.defaultValue = selectedBankType
                    const selectedBank = JSON.parse(context.newRecord.getValue('custrecord_rdnchl_bank_prop'))
                    const banks = rdmodu.getbanklist({type: selectedBankType})
                    if (banks.length > 0) {
                        banks.forEach(bank => {
                            bankField.addSelectOption({
                                value: bank.bankId,
                                text: bank.bankName,
                                isSelected: bank.bankId === selectedBank.value
                            })
                        })
                    }
                    const selectedBranch = JSON.parse(context.newRecord.getValue('custrecord_rdnchl_bank_branch_prop'))
                    const bankBranches = rdmodu.getbankbranchlist({bankId: selectedBank.value})
                    if (bankBranches.length > 0) {
                        bankBranches.forEach(branch => {
                            bankBranchField.addSelectOption({
                                value: branch.branchId,
                                text: branch.branchName,
                                isSelected: branch.branchId === selectedBranch.value
                            })
                        })
                    }
                }
            } else if (context.type === 'view') {
                const bankNameField = form.addField({
                    id: 'custpage_bank',
                    label: 'bank',
                    type: serverWidget.FieldType.TEXT
                })
                form.insertField({
                    field: bankNameField,
                    nextfield: 'name'
                })
                const bankProp = JSON.parse(context.newRecord.getValue('custrecord_rdnchl_bank_prop'))
                bankNameField.defaultValue = bankProp.text
                const branchNameField = form.addField({
                    id: 'custpage_bank_branch',
                    label: 'branch',
                    type: serverWidget.FieldType.TEXT
                })
                form.insertField({
                    field: branchNameField,
                    nextfield: 'name'
                })
                const branchProp = JSON.parse(context.newRecord.getValue('custrecord_rdnchl_bank_branch_prop'))
                branchNameField.defaultValue = branchProp.text
            }
        },
        beforeSubmit: context => {
            if (context.type === 'create' || context.type === 'edit') { //fixme: edit mode execution allowed only for development, in production only allow create mode
                try {
                    const bankType = context.newRecord.getValue('custrecord_nchl_bank_type')
                    const accountName = context.newRecord.getValue('custrecord_rdnchl_account_name')
                    const bankProp = JSON.parse(context.newRecord.getValue('custrecord_rdnchl_bank_prop'))
                    const recordName = `${bankProp.text} (${bankType}) ${accountName}`
                    log.debug('RECORD_NAME', recordName)
                    context.newRecord.setValue({fieldId: 'name', value: recordName})
                } catch (e) {
                    log.error({title: e.name, details: e.message})
                }
                verifyaccount(context)
            } else if (context.type === 'xedit') {
                // inline edits only carry the changed fields: account details and the flag need the full form
                const editedFields = context.newRecord.getFields()
                if (ACCOUNT_FIELDS.concat('custrecord_nchl_account_verified').some(fieldId => editedFields.includes(fieldId))) {
                    throw error.create({
                        name: 'NCHL_ACCOUNT_EDIT',
                        message: 'Change NCHL bank account details in the full bank detail form so NCHL can verify them.',
                        notifyOff: true
                    })
                }
            }
        }
    }
})